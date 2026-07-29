"""Abonnement Paddle : statut d'accès + réception des webhooks."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..deps import household_members, user_has_premium
from ..models import HouseholdMember, User, utcnow
from ..schemas import ChangePlanIn
from ..services import billing, paddle_api

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _subscriber(db: Session, user: User) -> User | None:
    """Le membre du foyer qui porte l'abonnement Paddle (le payeur)."""
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is None:
        return user if user.paddle_subscription_id else None
    for m in household_members(db, member.household_id):
        u = db.get(User, m.user_id)
        if u is not None and u.paddle_subscription_id:
            return u
    return None


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


@router.get("/subscription")
def my_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Détail de l'abonnement du foyer, pour la page de gestion (Réglages)."""
    sub = _subscriber(db, user)
    if sub is None or not sub.paddle_subscription_id:
        return {"manageable": False}
    base = {"manageable": True, "is_payer": sub.id == user.id, "status": sub.subscription_status}
    try:
        data = paddle_api.get_subscription(sub.paddle_subscription_id)
    except paddle_api.PaddleUnavailable:
        return {**base, "plan": None, "next_billed_at": None, "scheduled_change": None}
    price_id = ((data.get("items") or [{}])[0].get("price") or {}).get("id")
    plan = (
        "annual" if price_id == settings.paddle_price_annual
        else "monthly" if price_id == settings.paddle_price_monthly
        else None
    )
    return {
        **base,
        "status": data.get("status", sub.subscription_status),
        "plan": plan,
        "next_billed_at": data.get("next_billed_at"),
        "scheduled_change": data.get("scheduled_change"),
    }


@router.post("/cancel")
def cancel_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Résilie l'abonnement du foyer (fin de période payée)."""
    sub = _subscriber(db, user)
    if sub is None or not sub.paddle_subscription_id:
        raise HTTPException(status_code=404, detail="Aucun abonnement à résilier")
    try:
        paddle_api.cancel_subscription(sub.paddle_subscription_id)
    except paddle_api.PaddleUnavailable:
        raise HTTPException(status_code=502, detail="Résiliation indisponible pour le moment")
    return {"ok": True}


@router.post("/change-plan")
def change_plan(
    data: ChangePlanIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Bascule entre l'offre annuelle et mensuelle (prorata immédiat)."""
    price_map = {"annual": settings.paddle_price_annual, "monthly": settings.paddle_price_monthly}
    price_id = price_map.get(data.plan)
    if not price_id:
        raise HTTPException(status_code=422, detail="Offre inconnue ou non configurée")
    sub = _subscriber(db, user)
    if sub is None or not sub.paddle_subscription_id:
        raise HTTPException(status_code=404, detail="Aucun abonnement à modifier")
    try:
        paddle_api.change_price(sub.paddle_subscription_id, price_id)
    except paddle_api.PaddleUnavailable:
        raise HTTPException(status_code=502, detail="Changement d'offre indisponible pour le moment")
    return {"ok": True}


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
