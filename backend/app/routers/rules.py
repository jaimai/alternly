from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, household_members, notify, other_parent_id
from ..models import CustodyRule, HouseholdMember, ScheduleException, SpecialDayRule, VacationRule
from ..schemas import (
    PATTERNS,
    SPECIAL_KINDS,
    VACATION_MODES,
    CustodyRuleIn,
    CustodyRuleOut,
    ExceptionIn,
    ExceptionOut,
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


@router.get("/exceptions", response_model=list[ExceptionOut])
def list_exceptions(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    return db.scalars(
        select(ScheduleException)
        .where(ScheduleException.household_id == member.household_id)
        .order_by(ScheduleException.date_start)
    ).all()


@router.post("/exceptions", response_model=ExceptionOut, status_code=201)
def create_exception(
    data: ExceptionIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.date_end < data.date_start:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")
    _check_parent(db, member, data.parent_id)
    exc = ScheduleException(
        household_id=member.household_id,
        date_start=data.date_start,
        date_end=data.date_end,
        parent_id=data.parent_id,
        note=data.note,
        created_by=member.user_id,
    )
    db.add(exc)
    notify(
        db,
        other_parent_id(db, member.household_id, member.user_id),
        "exception_created",
        {"date_start": data.date_start.isoformat(), "date_end": data.date_end.isoformat(), "note": data.note},
    )
    db.commit()
    db.refresh(exc)
    return exc


@router.delete("/exceptions/{exception_id}", status_code=204)
def delete_exception(
    exception_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exc = db.get(ScheduleException, exception_id)
    if exc is None or exc.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Exception introuvable")
    notify(
        db,
        other_parent_id(db, member.household_id, member.user_id),
        "exception_deleted",
        {"date_start": exc.date_start.isoformat(), "date_end": exc.date_end.isoformat()},
    )
    db.delete(exc)
    db.commit()
