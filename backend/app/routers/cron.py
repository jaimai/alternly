"""Tâches déclenchées par un planificateur externe (pas de scheduler interne).

Protégées par l'en-tête `X-Cron-Key` comparé à `settings.cron_secret`. Si le
secret n'est pas configuré, l'endpoint est désactivé (403).
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import is_premium, other_parent_id
from ..models import ScheduleException, User, utcnow
from ..services import email as email_service

router = APIRouter(prefix="/api/cron", tags=["cron"])


def _authorize(key: str | None) -> None:
    if not settings.cron_secret:
        raise HTTPException(status_code=403, detail="Endpoint cron désactivé")
    if key != settings.cron_secret:
        raise HTTPException(status_code=401, detail="Clé cron invalide")


@router.post("/exchange-reminders")
def exchange_reminders(
    x_cron_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Rappelle par e-mail les propositions en attente qui expirent demain."""
    _authorize(x_cron_key)
    tomorrow = date.today() + timedelta(days=1)
    pending = db.scalars(
        select(ScheduleException).where(
            ScheduleException.status == "pending",
            ScheduleException.date_start == tomorrow,
            ScheduleException.reminder_sent_at.is_(None),
        )
    ).all()
    sent = 0
    for exc in pending:
        recipient_id = other_parent_id(db, exc.household_id, exc.created_by)
        recipient = db.get(User, recipient_id) if recipient_id else None
        exc.reminder_sent_at = utcnow()  # marqué même si opt-out, pour ne pas repasser dessus
        if recipient is None or not recipient.email_opt_in or not is_premium(recipient):
            continue
        subject, html = email_service.exchange_reminder_email(
            {"date_start": exc.date_start.isoformat(), "date_end": exc.date_end.isoformat()}
        )
        if email_service.send_email(recipient.email, subject, html):
            sent += 1
    db.commit()
    return {"sent": sent}
