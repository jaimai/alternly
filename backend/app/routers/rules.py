from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, notify, other_parent_id
from ..models import ChangeRequest, HouseholdMember, ScheduleException, User, utcnow
from ..services import audit
from ..services.audit import fr_range
from ..services import change_requests as cr_service
from ..services import email as email_service
from ..ratelimit import DAY, rate_limit
from ..schemas import (
    ChangeRequestOut,
    CustodyRuleIn,
    CustodyRuleOut,
    ExceptionIn,
    ExceptionOut,
    ExchangeResponseIn,
    SpecialDayRulesIn,
    SpecialDayRuleOut,
    VacationRuleIn,
    VacationRuleOut,
)

router = APIRouter(prefix="/api/households/{household_id}", tags=["rules"])


def _pending_response(cr: ChangeRequest) -> JSONResponse:
    """202 : la modification attend l'accord de l'autre parent."""
    return JSONResponse(
        status_code=202,
        content=jsonable_encoder({"change_request": ChangeRequestOut.model_validate(cr)}),
    )


@router.put("/custody-rule", response_model=CustodyRuleOut)
def upsert_custody_rule(
    data: CustodyRuleIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    hid = member.household_id
    new = cr_service.validate_custody(db, hid, data)
    rule = cr_service.get_custody(db, hid)
    old = cr_service.custody_snapshot(rule)
    if old == new:
        return rule  # aucune modification
    if rule is not None and cr_service.needs_consent(db, member):
        summary = f"Rythme de garde : {cr_service.custody_detail(db, old, new)}"
        cr = cr_service.create_request(db, member, "custody_rule", new, summary)
        db.commit()
        return _pending_response(cr)
    rule = cr_service.apply_custody(db, hid, new, member.user_id)
    notify(db, other_parent_id(db, hid, member.user_id), "rule_changed", {"what": "custody"})
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/vacation-rule", response_model=VacationRuleOut)
def upsert_vacation_rule(
    data: VacationRuleIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    hid = member.household_id
    new = cr_service.validate_vacation(db, hid, data)
    rule = cr_service.get_vacation(db, hid)
    old = cr_service.vacation_snapshot(rule)
    if old == new:
        return rule
    if rule is not None and cr_service.needs_consent(db, member):
        summary = f"Vacances : {cr_service.vacation_detail(db, old, new)}"
        cr = cr_service.create_request(db, member, "vacation_rule", new, summary)
        db.commit()
        return _pending_response(cr)
    rule = cr_service.apply_vacation(db, hid, new, member.user_id)
    notify(db, other_parent_id(db, hid, member.user_id), "rule_changed", {"what": "vacation"})
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/special-day-rules", response_model=list[SpecialDayRuleOut])
def upsert_special_day_rules(
    data: SpecialDayRulesIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    hid = member.household_id
    items = cr_service.validate_special(db, hid, data)
    rules = cr_service.get_special(db, hid)
    current = cr_service.special_snapshot(rules)
    if not cr_service.special_changed(current, items):
        return rules
    if rules and cr_service.needs_consent(db, member):
        summary = f"Jours de fête : {cr_service.special_detail(db, current, items)}"
        cr = cr_service.create_request(db, member, "special_day_rules", {"items": items}, summary)
        db.commit()
        return _pending_response(cr)
    cr_service.apply_special(db, hid, items, member.user_id)
    notify(db, other_parent_id(db, hid, member.user_id), "rule_changed", {"what": "special_days"})
    db.commit()
    return cr_service.get_special(db, hid)


def _is_expired(exc: ScheduleException) -> bool:
    """Une proposition non traitée dont la date de début est passée est expirée
    (calcul paresseux, jamais persisté)."""
    return exc.status == "pending" and exc.date_start < date.today()


def _get_exchange(db: Session, member: HouseholdMember, exception_id: int) -> ScheduleException:
    exc = db.get(ScheduleException, exception_id)
    if exc is None or exc.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Échange introuvable")
    return exc


def _exchange_payload(exc: ScheduleException) -> dict:
    return {
        "id": exc.id,
        "date_start": exc.date_start.isoformat(),
        "date_end": exc.date_end.isoformat(),
        "note": exc.note,
    }


@router.get("/exceptions", response_model=list[ExceptionOut])
def list_exceptions(
    status: str | None = Query(None),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(ScheduleException)
        .where(ScheduleException.household_id == member.household_id)
        .order_by(ScheduleException.date_start)
    ).all()
    if status == "pending":
        rows = [e for e in rows if e.status == "pending" and not _is_expired(e)]
    elif status in {"accepted", "refused", "withdrawn"}:
        rows = [e for e in rows if e.status == status]
    return rows


@router.post(
    "/exceptions",
    response_model=ExceptionOut,
    status_code=201,
    dependencies=[Depends(rate_limit("exceptions", 30, DAY, by="household"))],
)
def create_exception(
    data: ExceptionIn,
    background: BackgroundTasks,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.date_end < data.date_start:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")
    cr_service.check_parent(db, member.household_id, data.parent_id)
    if data.replaces_id is not None:
        _get_exchange(db, member, data.replaces_id)  # doit exister dans le foyer

    recipient_id = other_parent_id(db, member.household_id, member.user_id)
    solo = recipient_id is None
    exc = ScheduleException(
        household_id=member.household_id,
        date_start=data.date_start,
        date_end=data.date_end,
        parent_id=data.parent_id,
        note=data.note,
        created_by=member.user_id,
        replaces_id=data.replaces_id,
        # solo : personne pour accepter → l'échange s'applique directement
        status="accepted" if solo else "pending",
        resolved_by=member.user_id if solo else None,
        resolved_at=utcnow() if solo else None,
    )
    db.add(exc)
    db.flush()  # pour disposer de exc.id dans la notification
    verb = "a ajouté un échange" if solo else "a proposé un échange"
    audit.record(
        db, member.household_id, member.user_id, "exchange.propose", "exception", exc.id,
        f"{verb} : {cr_service.exchange_label(db, exc)}", {"after": cr_service.exchange_snapshot(exc)},
    )
    if not solo:
        payload = _exchange_payload(exc)
        notify(db, recipient_id, "exchange_proposed", payload)
        recipient = db.get(User, recipient_id)
        if recipient is not None and recipient.email_opt_in:
            subject, html = email_service.exchange_proposed_email(payload)
            # Envoyé après la réponse (donc après le commit) : jamais d'e-mail pour
            # une proposition non enregistrée, ni de latence Resend dans la requête.
            background.add_task(email_service.send_email, recipient.email, subject, html)
    db.commit()
    db.refresh(exc)
    return exc


def _resolve(
    db: Session, member: HouseholdMember, exc: ScheduleException, new_status: str, note: str
) -> None:
    exc.status = new_status
    exc.resolved_by = member.user_id
    exc.resolved_at = utcnow()
    exc.response_note = note


@router.post("/exceptions/{exception_id}/accept", response_model=ExceptionOut)
def accept_exchange(
    exception_id: int,
    data: ExchangeResponseIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exc = _get_exchange(db, member, exception_id)
    if member.user_id == exc.created_by:
        raise HTTPException(status_code=403, detail="Le proposeur ne peut pas accepter sa propre proposition")
    if exc.status != "pending" or _is_expired(exc):
        raise HTTPException(status_code=409, detail="Cette proposition n'est plus en attente")
    _resolve(db, member, exc, "accepted", data.response_note)
    audit.record(
        db, member.household_id, member.user_id, "exchange.accept", "exception", exc.id,
        f"a accepté l'échange : {cr_service.exchange_label(db, exc)}",
    )
    notify(db, exc.created_by, "exchange_accepted", _exchange_payload(exc))
    db.commit()
    db.refresh(exc)
    return exc


@router.post("/exceptions/{exception_id}/refuse", response_model=ExceptionOut)
def refuse_exchange(
    exception_id: int,
    data: ExchangeResponseIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exc = _get_exchange(db, member, exception_id)
    if member.user_id == exc.created_by:
        raise HTTPException(status_code=403, detail="Le proposeur ne peut pas refuser sa propre proposition")
    if exc.status != "pending" or _is_expired(exc):
        raise HTTPException(status_code=409, detail="Cette proposition n'est plus en attente")
    _resolve(db, member, exc, "refused", data.response_note)
    audit.record(
        db, member.household_id, member.user_id, "exchange.refuse", "exception", exc.id,
        f"a refusé l'échange : {cr_service.exchange_label(db, exc)}",
    )
    notify(db, exc.created_by, "exchange_refused", _exchange_payload(exc))
    db.commit()
    db.refresh(exc)
    return exc


@router.post("/exceptions/{exception_id}/withdraw", response_model=ExceptionOut)
def withdraw_exchange(
    exception_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exc = _get_exchange(db, member, exception_id)
    if member.user_id != exc.created_by:
        raise HTTPException(status_code=403, detail="Seul le proposeur peut retirer sa proposition")
    if exc.status != "pending" or _is_expired(exc):
        raise HTTPException(status_code=409, detail="Cette proposition n'est plus en attente")
    exc.status = "withdrawn"
    exc.resolved_at = utcnow()
    audit.record(
        db, member.household_id, member.user_id, "exchange.withdraw", "exception", exc.id,
        f"a retiré sa proposition d'échange : {cr_service.exchange_label(db, exc)}",
    )
    notify(db, other_parent_id(db, member.household_id, member.user_id), "exchange_withdrawn", _exchange_payload(exc))
    db.commit()
    db.refresh(exc)
    return exc


@router.delete("/exceptions/{exception_id}", status_code=204)
def delete_exception(
    exception_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exc = _get_exchange(db, member, exception_id)
    if exc.status == "pending" and member.user_id != exc.created_by:
        # Une proposition en attente se refuse, elle ne se supprime pas.
        raise HTTPException(status_code=403, detail="Seul le proposeur peut supprimer sa proposition")
    if exc.status == "accepted" and cr_service.needs_consent(db, member):
        # Annuler un échange convenu engage les deux parents.
        summary = f"Annuler l'échange du {fr_range(exc.date_start, exc.date_end)} (chez {_parent_name(db, exc)})"
        cr = cr_service.create_request(db, member, "cancel_exchange", {"exception_id": exc.id}, summary)
        db.commit()
        return _pending_response(cr)
    notify(
        db,
        other_parent_id(db, member.household_id, member.user_id),
        "exception_deleted",
        {"date_start": exc.date_start.isoformat(), "date_end": exc.date_end.isoformat()},
    )
    cr_service.delete_exchange(db, exc, member.user_id)
    db.commit()


def _parent_name(db: Session, exc: ScheduleException) -> str:
    user = db.get(User, exc.parent_id)
    return user.display_name if user is not None else "un parent"
