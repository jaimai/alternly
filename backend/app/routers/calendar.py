from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, household_members
from ..models import Household, HouseholdMember, User
from ..schemas import CalendarDay, CalendarResponse, LabeledDate, LabeledPeriod, MemberOut, PendingExchange
from ..services.calendar_service import NoCustodyRule, build_calendar

router = APIRouter(prefix="/api/households/{household_id}", tags=["calendar"])

MAX_RANGE_DAYS = 550  # ~18 mois


@router.get("/calendar", response_model=CalendarResponse)
def get_calendar(
    start: date = Query(...),
    end: date = Query(...),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if end < start:
        raise HTTPException(status_code=422, detail="end doit suivre start")
    if (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Plage limitée à {MAX_RANGE_DAYS} jours")

    household = db.get(Household, member.household_id)
    try:
        data = build_calendar(db, household, start, end)
    except NoCustodyRule:
        raise HTTPException(status_code=409, detail="Aucune règle de garde définie")

    members_out = []
    for m in household_members(db, member.household_id):
        user = db.get(User, m.user_id)
        members_out.append(
            MemberOut(id=user.id, display_name=user.display_name, color=user.color, role=m.role)
        )

    return CalendarResponse(
        days=[CalendarDay(date=a.day, parent_id=int(a.parent), source=a.source) for a in data.days],
        public_holidays=[
            LabeledDate(date=d, label=label)
            for d, label in sorted(data.public_holidays.items())
            if start <= d <= end
        ],
        school_holidays=[
            LabeledPeriod(label=p.label, start=p.start, end=p.end)
            for p in data.school_periods
            if p.end >= start and p.start <= end
        ],
        school_holidays_loaded=data.school_holidays_loaded,
        handover_day=data.rule.handover_day,
        handover_time=data.rule.handover_time,
        members=members_out,
        pending_exchanges=[
            PendingExchange(
                id=e.id,
                date_start=e.date_start,
                date_end=e.date_end,
                proposed_parent_id=e.parent_id,
                proposed_by=e.created_by,
                note=e.note,
            )
            for e in data.pending_exchanges
        ],
    )
