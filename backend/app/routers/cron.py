"""Tâches déclenchées par un planificateur externe (pas de scheduler interne).

Protégées par l'en-tête `X-Cron-Key` comparé à `settings.cron_secret`. Si le
secret n'est pas configuré, l'endpoint est désactivé (403).
"""
import hmac
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import is_premium, other_parent_id
from ..models import ScheduleException, User, utcnow
from ..services import email as email_service
from ..services import handover_reminders, invite_reminders, lifecycle, paddle_api

router = APIRouter(prefix="/api/cron", tags=["cron"])


def _authorize(key: str | None) -> None:
    if not settings.cron_secret:
        raise HTTPException(status_code=403, detail="Endpoint cron désactivé")
    # comparaison à temps constant (pas de fuite du secret par chronométrage)
    if key is None or not hmac.compare_digest(key.encode(), settings.cron_secret.encode()):
        raise HTTPException(status_code=401, detail="Clé cron invalide")


@router.post("/email-check")
def email_check(x_cron_key: str | None = Header(default=None)):
    """Diagnostic e-mail : configuration vue par le serveur + envoi test vers
    FEEDBACK_EMAIL (seul destinataire possible, pour éviter tout abus)."""
    _authorize(x_cron_key)
    return email_service.diagnose(settings.feedback_email or None)


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
        if recipient is None or not recipient.email_opt_in or not is_premium(db, recipient):
            continue
        subject, html = email_service.exchange_reminder_email(
            {"date_start": exc.date_start.isoformat(), "date_end": exc.date_end.isoformat()},
            recipient.locale,
        )
        if email_service.send_email(recipient.email, subject, html):
            sent += 1
    db.commit()
    return {"sent": sent}


@router.post("/invite-reminders")
def invite_reminders_job(
    x_cron_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Relances de la boucle d'invitation (inviteur J+2/J+5, invité J+3, nudge onboarding)."""
    _authorize(x_cron_key)
    return invite_reminders.run(db)


@router.post("/lifecycle")
def lifecycle_job(
    x_cron_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """E-mails de cycle de vie : rappels de vacances scolaires puis séquence J1/J3/J7.
    Idempotent (email_log) ; au plus un e-mail par utilisateur et par jour."""
    _authorize(x_cron_key)
    return lifecycle.run(db)


@router.post("/handover-reminders")
def handover_reminders_job(
    x_cron_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Push la veille d'un changement de parent (lancé le soir). Idempotent (email_log)."""
    _authorize(x_cron_key)
    return handover_reminders.run(db)


@router.post("/paddle-sync")
def paddle_sync(
    x_cron_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Relit tous les abonnements chez Paddle et met les comptes à jour (rattrapage
    des webhooks manqués, ex. destination configurée après des paiements)."""
    _authorize(x_cron_key)
    from .billing import _apply_subscription, _find_user, _track_billing  # import local : évite le cycle

    try:
        subs = paddle_api.list_subscriptions()
    except paddle_api.PaddleUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    updated, unmatched, tracked = [], [], []
    for sub in subs:
        user = _find_user(db, sub)
        if user is None:
            unmatched.append(sub.get("id"))
            continue
        before = user.subscription_status
        tracked.extend(_apply_subscription(db, user, sub, canceled=sub.get("status") == "canceled"))
        if user.subscription_status != before:
            updated.append({"user_id": user.id, "before": before, "after": user.subscription_status})
    db.commit()
    for u, name, payload in tracked:
        _track_billing(db, u, name, payload)
    return {"subscriptions": len(subs), "updated": updated, "unmatched": unmatched}
