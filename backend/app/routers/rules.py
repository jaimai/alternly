from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, is_premium, notify, other_parent_id
from ..models import HouseholdMember, ScheduleException, User, utcnow
from ..ratelimit import DAY, rate_limit
from ..services import analytics, audit
from ..services import change_requests as cr_service
from ..services import email as email_service
from ..services import rules as rules_service
from ..schemas import (
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


@router.put("/custody-rule", response_model=CustodyRuleOut)
def upsert_custody_rule(
    data: CustodyRuleIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    hid = member.household_id
    new = rules_service.validate_custody(db, hid, data)
    rule = rules_service.get_custody(db, hid)
    old = rules_service.custody_snapshot(rule)
    if old == new:
        return rule  # aucune modification
    if rule is not None and cr_service.needs_consent(db, member):
        cr = cr_service.create_request(db, member, "custody_rule", new, {"before": old, "after": new})
        db.commit()
        return cr_service.pending_response(db, member, cr)
    first = rule is None
    rule = rules_service.apply_custody(db, hid, new, member.user_id)
    notify(db, other_parent_id(db, hid, member.user_id), "rule_changed", {"what": "custody"})
    db.commit()
    db.refresh(rule)
    # Fait autorité (compté même sans consentement, en anonyme) : étape « règle posée ».
    analytics.capture_for_member(db, member, "custody_rule_set", {"pattern": rule.pattern, "first": first})
    return rule


@router.put("/vacation-rule", response_model=VacationRuleOut)
def upsert_vacation_rule(
    data: VacationRuleIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    hid = member.household_id
    new = rules_service.validate_vacation(db, hid, data)
    rule = rules_service.get_vacation(db, hid)
    old = rules_service.vacation_snapshot(rule)
    if old == new:
        return rule
    if rule is not None and cr_service.needs_consent(db, member):
        cr = cr_service.create_request(db, member, "vacation_rule", new, {"before": old, "after": new})
        db.commit()
        return cr_service.pending_response(db, member, cr)
    rule = rules_service.apply_vacation(db, hid, new, member.user_id)
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
    items = rules_service.validate_special(db, hid, data)
    rules = rules_service.get_special(db, hid)
    current = rules_service.special_snapshot(rules)
    if not rules_service.special_changed(current, items):
        return rules
    if rules and cr_service.needs_consent(db, member):
        cr = cr_service.create_request(
            db, member, "special_day_rules", {"items": items}, {"before": current, "after": items}
        )
        db.commit()
        return cr_service.pending_response(db, member, cr)
    rules_service.apply_special(db, hid, items, member.user_id)
    notify(db, other_parent_id(db, hid, member.user_id), "rule_changed", {"what": "special_days"})
    db.commit()
    return rules_service.get_special(db, hid)


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
    rules_service.check_parent(db, member.household_id, data.parent_id)
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
    audit.record(
        db, member.household_id, member.user_id, "exchange.propose", "exception", exc.id,
        {"after": rules_service.exchange_snapshot(exc), "solo": solo},
    )
    if not solo:
        payload = _exchange_payload(exc)
        notify(db, recipient_id, "exchange_proposed", payload)
        recipient = db.get(User, recipient_id)
        if recipient is not None and recipient.email_opt_in and is_premium(db, recipient):
            subject, html = email_service.exchange_proposed_email(payload, recipient.locale)
            # Envoyé après la réponse (donc après le commit) : jamais d'e-mail pour
            # une proposition non enregistrée, ni de latence Resend dans la requête.
            background.add_task(email_service.send_email, recipient.email, subject, html)
    db.commit()
    db.refresh(exc)
    analytics.capture_for_member(db, member, "exchange_submitted", {
        "solo": solo,
        "is_counter": data.replaces_id is not None,
        "days": (data.date_end - data.date_start).days + 1,
        "lead_days": (data.date_start - date.today()).days,
    })
    return exc


def _resolve(
    db: Session, member: HouseholdMember, exc: ScheduleException, new_status: str, note: str
) -> None:
    exc.status = new_status
    exc.resolved_by = member.user_id
    exc.resolved_at = utcnow()
    exc.response_note = note


def _track_resolution(db: Session, member: HouseholdMember, exc: ScheduleException) -> None:
    hours = None
    if exc.created_at and exc.resolved_at:
        hours = round((exc.resolved_at - exc.created_at).total_seconds() / 3600, 1)
    analytics.capture_for_member(db, member, "exchange_resolved", {
        "status": exc.status,
        "is_counter": exc.replaces_id is not None,
        "hours_to_resolve": hours,
    })


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
        {"after": rules_service.exchange_snapshot(exc)},
    )
    notify(db, exc.created_by, "exchange_accepted", _exchange_payload(exc))
    db.commit()
    db.refresh(exc)
    _track_resolution(db, member, exc)
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
        {"after": rules_service.exchange_snapshot(exc)},
    )
    notify(db, exc.created_by, "exchange_refused", _exchange_payload(exc))
    db.commit()
    db.refresh(exc)
    _track_resolution(db, member, exc)
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
        {"after": rules_service.exchange_snapshot(exc)},
    )
    notify(db, other_parent_id(db, member.household_id, member.user_id), "exchange_withdrawn", _exchange_payload(exc))
    db.commit()
    db.refresh(exc)
    _track_resolution(db, member, exc)
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
        cr = cr_service.create_request(
            db, member, "cancel_exchange", {"exception_id": exc.id},
            {"date_start": exc.date_start, "date_end": exc.date_end, "parent_id": exc.parent_id},
        )
        db.commit()
        return cr_service.pending_response(db, member, cr)
    notify(
        db,
        other_parent_id(db, member.household_id, member.user_id),
        "exception_deleted",
        {"date_start": exc.date_start.isoformat(), "date_end": exc.date_end.isoformat()},
    )
    rules_service.delete_exchange(db, exc, member.user_id)
    db.commit()
