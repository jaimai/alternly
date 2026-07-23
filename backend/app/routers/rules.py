from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, household_members, notify, other_parent_id
from ..models import CustodyRule, HouseholdMember, ScheduleException, SpecialDayRule, User, VacationRule, utcnow
from ..services import email as email_service
from ..schemas import (
    PATTERNS,
    SPECIAL_KINDS,
    VACATION_MODES,
    CustodyRuleIn,
    CustodyRuleOut,
    ExceptionIn,
    ExceptionOut,
    ExchangeResponseIn,
    SpecialDayRuleIn,
    SpecialDayRuleOut,
    VacationRuleIn,
    VacationRuleOut,
)

router = APIRouter(prefix="/api/households/{household_id}", tags=["rules"])


def _check_parent(db: Session, member: HouseholdMember, parent_id: int) -> None:
    ids = {m.user_id for m in household_members(db, member.household_id)}
    if parent_id not in ids:
        raise HTTPException(status_code=422, detail="Ce parent n'appartient pas au foyer")


@router.put("/custody-rule", response_model=CustodyRuleOut)
def upsert_custody_rule(
    data: CustodyRuleIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.pattern not in PATTERNS:
        raise HTTPException(status_code=422, detail="Schéma de garde inconnu")
    _check_parent(db, member, data.reference_parent_id)
    if data.pattern == "custom":
        if not data.custom_weeks or len(data.custom_weeks) != 14 or any(
            v not in {"ref", "other"} for v in data.custom_weeks
        ):
            raise HTTPException(status_code=422, detail="custom_weeks doit contenir 14 valeurs ref/other")

    rule = db.scalar(select(CustodyRule).where(CustodyRule.household_id == member.household_id))
    if rule is None:
        rule = CustodyRule(household_id=member.household_id)
        db.add(rule)
    rule.pattern = data.pattern
    rule.start_date = data.start_date
    rule.reference_parent_id = data.reference_parent_id
    rule.handover_day = data.handover_day
    rule.handover_time = data.handover_time
    rule.custom_weeks = data.custom_weeks if data.pattern == "custom" else None
    notify(db, other_parent_id(db, member.household_id, member.user_id), "rule_changed", {"what": "custody"})
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/vacation-rule", response_model=VacationRuleOut)
def upsert_vacation_rule(
    data: VacationRuleIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.mode not in VACATION_MODES:
        raise HTTPException(status_code=422, detail="Mode de partage inconnu")
    if data.even_year_first_half_parent_id is not None:
        _check_parent(db, member, data.even_year_first_half_parent_id)

    rule = db.scalar(select(VacationRule).where(VacationRule.household_id == member.household_id))
    if rule is None:
        rule = VacationRule(household_id=member.household_id)
        db.add(rule)
    rule.mode = data.mode
    rule.even_year_first_half_parent_id = data.even_year_first_half_parent_id
    notify(db, other_parent_id(db, member.household_id, member.user_id), "rule_changed", {"what": "vacation"})
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/special-day-rules", response_model=list[SpecialDayRuleOut])
def upsert_special_day_rules(
    data: list[SpecialDayRuleIn],
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    for item in data:
        if item.kind not in SPECIAL_KINDS:
            raise HTTPException(status_code=422, detail=f"Fête inconnue : {item.kind}")
        if item.parent_mode == "fixed":
            if item.parent_id is None:
                raise HTTPException(status_code=422, detail="parent_id requis en mode fixed")
            _check_parent(db, member, item.parent_id)
        rule = db.scalar(
            select(SpecialDayRule).where(
                SpecialDayRule.household_id == member.household_id,
                SpecialDayRule.kind == item.kind,
            )
        )
        if rule is None:
            rule = SpecialDayRule(household_id=member.household_id, kind=item.kind)
            db.add(rule)
        rule.parent_mode = item.parent_mode
        rule.parent_id = item.parent_id if item.parent_mode == "fixed" else None
        rule.enabled = item.enabled
    notify(db, other_parent_id(db, member.household_id, member.user_id), "rule_changed", {"what": "special_days"})
    db.commit()
    return db.scalars(
        select(SpecialDayRule).where(SpecialDayRule.household_id == member.household_id)
    ).all()


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


@router.post("/exceptions", response_model=ExceptionOut, status_code=201)
def create_exception(
    data: ExceptionIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.date_end < data.date_start:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")
    _check_parent(db, member, data.parent_id)
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
    if not solo:
        payload = _exchange_payload(exc)
        notify(db, recipient_id, "exchange_proposed", payload)
        recipient = db.get(User, recipient_id)
        if recipient is not None and recipient.email_opt_in:
            subject, html = email_service.exchange_proposed_email(payload)
            email_service.send_email(recipient.email, subject, html)
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
    notify(
        db,
        other_parent_id(db, member.household_id, member.user_id),
        "exception_deleted",
        {"date_start": exc.date_start.isoformat(), "date_end": exc.date_end.isoformat()},
    )
    db.delete(exc)
    db.commit()
