from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_premium
from ..models import Household, HouseholdMember, User, new_token
from ..services import analytics
from ..services.calendar_service import NoCustodyRule, build_calendar
from ..services.ical_export import build_ics

router = APIRouter(prefix="/api/ical", tags=["ical"])


@router.get("/{ical_token}.ics")
def ical_feed(ical_token: str, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.ical_token == ical_token))
    if user is None:
        raise HTTPException(status_code=404, detail="Flux introuvable")
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is None:
        raise HTTPException(status_code=404, detail="Aucun foyer")
    household = db.get(Household, member.household_id)

    today = date.today()
    start = today - timedelta(days=90)
    end = today + timedelta(days=365)
    try:
        data = build_calendar(db, household, start, end)
    except NoCustodyRule:
        raise HTTPException(status_code=409, detail="Aucune règle de garde définie")
    if not data.school_holidays_loaded:
        # Données publiques FR (vacances/fériés) injoignables : le calendrier serait
        # faux. Les clients d'agenda réessaieront plutôt que d'écraser le bon flux.
        # (Les foyers US utilisent des congés saisis à la main : toujours chargés.)
        raise HTTPException(
            status_code=503,
            detail="Données publiques indisponibles, réessayez plus tard",
            headers={"Retry-After": "3600"},
        )

    names = {}
    for m in db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household.id)):
        u = db.get(User, m.user_id)
        names[str(u.id)] = u.display_name

    ics = build_ics(data.days, names, ical_token[:8])
    # Mesure de l'usage réel de la synchro (1 appel sur 20, anonyme : pas d'utilisateur).
    analytics.capture_sampled("ical_feed_polled", {"country": household.country}, rate=20)
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="alternly.ics"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/link")
def current_link(user: User = Depends(require_premium)):
    """Jeton actuel du flux, sans le changer (l'app mobile l'affiche à chaque visite :
    régénérer couperait les agendas déjà abonnés)."""
    return {"ical_token": user.ical_token}


@router.post("/regenerate")
def regenerate(user: User = Depends(require_premium), db: Session = Depends(get_db)):
    user.ical_token = new_token()
    db.commit()
    return {"ical_token": user.ical_token}
