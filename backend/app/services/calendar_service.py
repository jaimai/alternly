"""Assemble les données ORM + open data et appelle le moteur pur."""
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import household_members
from ..models import CustodyRule, Household, ScheduleException, SpecialDayRule, User, VacationRule
from . import public_holidays, school_holidays
from .custody_engine import (
    DayAssignment,
    EngineException,
    EngineRule,
    EngineSpecialRule,
    EngineVacationRule,
    Period,
    resolve_calendar,
)
from .public_holidays import PublicDataUnavailable


@dataclass
class CalendarData:
    days: list[DayAssignment]
    public_holidays: dict[date, str]
    school_periods: list[Period]
    school_holidays_loaded: bool
    rule: CustodyRule
    pending_exchanges: list[ScheduleException]


class NoCustodyRule(Exception):
    pass


def _auto_special_parent(kind: str, members: list, users: dict[int, User], fallback_id: int) -> int:
    """Mode auto : fête des mères → parent «mère» non déterminable sans genre ;
    convention MVP : parent1 pour mothers_day, parent2 pour fathers_day (modifiable en mode fixed)."""
    by_role = {m.role: m.user_id for m in members}
    if kind == "mothers_day":
        return by_role.get("parent1", fallback_id)
    if kind == "fathers_day":
        return by_role.get("parent2", by_role.get("parent1", fallback_id))
    return fallback_id


def build_calendar(db: Session, household: Household, start: date, end: date) -> CalendarData:
    rule = db.scalar(select(CustodyRule).where(CustodyRule.household_id == household.id))
    if rule is None:
        raise NoCustodyRule()

    members = household_members(db, household.id)
    users = {m.user_id: db.get(User, m.user_id) for m in members}
    member_ids = [m.user_id for m in members]
    other_id = next((uid for uid in member_ids if uid != rule.reference_parent_id), rule.reference_parent_id)

    engine_rule = EngineRule(
        pattern=rule.pattern,
        start_date=rule.start_date,
        reference_parent=str(rule.reference_parent_id),
        other_parent=str(other_id),
        handover_day=rule.handover_day,
        custom_weeks=rule.custom_weeks,
    )

    vac = db.scalar(select(VacationRule).where(VacationRule.household_id == household.id))
    engine_vac = None
    if vac is not None and vac.even_year_first_half_parent_id is not None and len(member_ids) >= 1:
        engine_vac = EngineVacationRule(
            mode=vac.mode,
            even_year_first_half_parent=str(vac.even_year_first_half_parent_id),
        )

    specials = []
    for sp in db.scalars(select(SpecialDayRule).where(SpecialDayRule.household_id == household.id)):
        if not sp.enabled:
            continue
        if sp.parent_mode == "fixed" and sp.parent_id is not None:
            parent_id = sp.parent_id
        else:
            parent_id = _auto_special_parent(sp.kind, members, users, rule.reference_parent_id)
        specials.append(EngineSpecialRule(kind=sp.kind, parent=str(parent_id), enabled=True))

    all_exceptions = db.scalars(
        select(ScheduleException).where(ScheduleException.household_id == household.id)
    ).all()
    # Seuls les échanges acceptés modifient la garde résolue.
    exceptions = [
        EngineException(start=e.date_start, end=e.date_end, parent=str(e.parent_id))
        for e in all_exceptions
        if e.status == "accepted"
    ]
    # Propositions en attente non expirées, recoupant la plage demandée (overlay provisoire).
    pending_exchanges = [
        e
        for e in all_exceptions
        if e.status == "pending" and e.date_start >= date.today()
        and e.date_start <= end and e.date_end >= start
    ]

    holidays: dict[date, str] = {}
    periods: list[Period] = []
    loaded = True
    try:
        for year in range(start.year, end.year + 1):
            holidays.update(public_holidays.get(db, year))
    except PublicDataUnavailable:
        loaded = False
    try:
        periods = school_holidays.get(
            db, household.school_zone, school_holidays.school_years_for_range(start, end)
        )
    except PublicDataUnavailable:
        loaded = False
        periods = []

    days = resolve_calendar(
        rule=engine_rule,
        vacation_rule=engine_vac,
        special_rules=specials,
        exceptions=exceptions,
        school_periods=periods,
        start=start,
        end=end,
    )
    return CalendarData(
        days=days,
        public_holidays=holidays,
        school_periods=periods,
        school_holidays_loaded=loaded,
        rule=rule,
        pending_exchanges=pending_exchanges,
    )
