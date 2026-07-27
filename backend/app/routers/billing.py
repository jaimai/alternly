"""Abonnement Paddle : statut d'accès + réception des webhooks."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..deps import user_has_premium
from ..models import User, utcnow
from ..services import billing
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/status")
def billing_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = utcnow()
    return {
        "status": user.subscription_status,
        # Accès premium au niveau du foyer : un membre abonné débloque tout le foyer.
        "access": user_has_premium(db, user),
        "trial_days_left": billing.trial_days_left(user.subscription_status, user.trial_ends_at, now),
        "trial_ends_at": user.trial_ends_at.isoformat() if user.trial_ends_at else None,
        "subscription_ends_at": user.subscription_ends_at.isoformat() if user.subscription_ends_at else None,
    }


def _find_user(db: Session, data: dict) -> User | None:
    uid = (data.get("custom_data") or {}).get("user_id")
    if uid:
        try:
            u = db.get(User, int(uid))
            if u is not None:
                return u
        except (ValueError, TypeError):
            pass
    sub_id = data.get("id")
    if sub_id:
        return db.scalar(select(User).where(User.paddle_subscription_id == sub_id))
    return None


@router.post("/webhook")
async def paddle_webhook(
    request: Request,
    paddle_signature: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    raw = await request.body()
    if not billing.verify_signature(raw, paddle_signature, settings.paddle_webhook_secret):
        raise HTTPException(status_code=403, detail="Signature invalide")

    event = await request.json()
    etype = event.get("event_type", "")
    data = event.get("data", {})

    if etype.startswith("subscription."):
        user = _find_user(db, data)
        if user is not None:
            user.paddle_subscription_id = data.get("id") or user.paddle_subscription_id
            user.paddle_customer_id = data.get("customer_id") or user.paddle_customer_id
            if etype == "subscription.canceled":
                user.subscription_status = "canceled"
            else:
                user.subscription_status = billing.map_status(data.get("status", ""))
            period = data.get("current_billing_period") or {}
            ends = billing.parse_iso(period.get("ends_at"))
            if ends is not None:
                user.subscription_ends_at = ends
            db.commit()

    return {"ok": True}
