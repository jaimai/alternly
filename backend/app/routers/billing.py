"""Abonnement Paddle : statut d'accès + réception des webhooks."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..deps import household_members, user_has_premium
from ..models import HouseholdMember, PaddleEvent, User, utcnow
from ..ratelimit import HOUR, rate_limit
from ..schemas import ChangePlanIn
from ..services import analytics, audit, billing, paddle_api

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _journal(db: Session, user: User, action: str, data: dict) -> None:
    """Journalise un changement d'abonnement dans le foyer de l'utilisateur (s'il en a un)."""
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is not None:
        audit.record(db, member.household_id, user.id, action, "subscription", None, data)


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


@router.post("/paywall-seen")
def paywall_seen(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Premier affichage du paywall : sert à proposer l'offre de bienvenue 48 h plus tard."""
    if user.paywall_seen_at is None:
        user.paywall_seen_at = utcnow()
        db.commit()
    return {"ok": True}


@router.get("/plans")
def billing_plans():
    """Offres et essais (public : landing et paywall). Les price_id ne sont pas secrets."""
    return billing.plans()


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


# Appels à l'API Paddle : bornés par IP (le webhook, lui, n'est jamais limité).
@router.post("/cancel", dependencies=[Depends(rate_limit("billing", 10, HOUR))])
def cancel_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Résilie l'abonnement du foyer (fin de période payée)."""
    sub = _subscriber(db, user)
    if sub is None or not sub.paddle_subscription_id:
        raise HTTPException(status_code=404, detail="Aucun abonnement à résilier")
    try:
        paddle_api.cancel_subscription(sub.paddle_subscription_id)
    except paddle_api.PaddleUnavailable:
        raise HTTPException(status_code=502, detail="Résiliation indisponible pour le moment")
    _journal(db, user, "subscription.cancel", {"payer_id": sub.id})
    db.commit()
    return {"ok": True}


@router.post("/change-plan", dependencies=[Depends(rate_limit("billing", 10, HOUR))])
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
    _journal(db, user, "subscription.change_plan", {"plan": data.plan, "payer_id": sub.id})
    db.commit()
    return {"ok": True}


def _plan_of(data: dict) -> str | None:
    """Offre (annual|monthly) d'après le price_id du premier article Paddle."""
    item = (data.get("items") or [{}])[0] or {}
    price_id = (item.get("price") or {}).get("id") or item.get("price_id")
    if not price_id:
        return None
    if price_id == settings.paddle_price_annual:
        return "annual"
    if price_id == settings.paddle_price_monthly:
        return "monthly"
    return "other"


def _amount_of(data: dict) -> float | None:
    """Montant (unité monétaire) : total d'une transaction, sinon prix unitaire de l'abonnement."""
    totals = (data.get("details") or {}).get("totals") or {}
    raw = totals.get("grand_total") or totals.get("total")
    if raw is None:
        item = (data.get("items") or [{}])[0] or {}
        raw = ((item.get("price") or {}).get("unit_price") or {}).get("amount")
    try:
        return int(raw) / 100 if raw is not None else None
    except (TypeError, ValueError):
        return None


def _track_billing(db: Session, user: User, event: str, data: dict) -> None:
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    analytics.capture_for_user(
        user,
        event,
        {"plan": _plan_of(data), "currency": data.get("currency_code"), "amount": _amount_of(data)},
        household_id=member.household_id if member else None,
    )


# Statut interne → événement analytics lors d'une transition.
_STATUS_EVENTS = {
    "active": "subscription_activated",
    "trialing": "subscription_activated",
    "past_due": "subscription_past_due",
    "canceled": "subscription_canceled",
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
    event_id = event.get("event_id")
    occurred_at = billing.parse_iso(event.get("occurred_at"))
    sub_id = data.get("id") if etype.startswith("subscription.") else None

    # Idempotence : Paddle réessaie tant qu'il n'a pas reçu de 2xx.
    if event_id and db.get(PaddleEvent, event_id) is not None:
        return {"ok": True, "duplicate": True}

    # Ordre : un événement antérieur au dernier traité pour cet abonnement est
    # obsolète (ex. « updated: active » livré après « canceled »).
    stale = False
    if sub_id and occurred_at is not None:
        latest = db.scalar(
            select(func.max(PaddleEvent.occurred_at)).where(PaddleEvent.subscription_id == sub_id)
        )
        stale = latest is not None and occurred_at < latest

    tracked: list[tuple[User, str, dict]] = []
    if etype.startswith("subscription.") and not stale:
        user = _find_user(db, data)
        if user is not None:
            user.paddle_subscription_id = data.get("id") or user.paddle_subscription_id
            user.paddle_customer_id = data.get("customer_id") or user.paddle_customer_id
            previous = user.subscription_status
            if etype == "subscription.canceled":
                user.subscription_status = "canceled"
            else:
                user.subscription_status = billing.map_status(data.get("status", ""))
            if user.subscription_status != previous:
                _journal(db, user, "subscription.status", {"before": previous, "after": user.subscription_status})
                event_name = _STATUS_EVENTS.get(user.subscription_status)
                # Une réactivation après impayé n'est pas une nouvelle souscription.
                if event_name and not (event_name == "subscription_activated" and previous in ("active", "trialing", "past_due")):
                    tracked.append((user, event_name, data))
            period = data.get("current_billing_period") or {}
            ends = billing.parse_iso(period.get("ends_at"))
            if ends is not None:
                user.subscription_ends_at = ends
            # Essai Paddle : fin d'essai = trial_dates de l'article, sinon fin de la
            # période en cours (pendant l'essai, la période couvre l'essai).
            if user.subscription_status == "trialing":
                item = (data.get("items") or [{}])[0] or {}
                trial_end = billing.parse_iso((item.get("trial_dates") or {}).get("ends_at")) or ends
                if trial_end is not None:
                    user.trial_ends_at = trial_end

    # Renouvellement : transaction récurrente payée (si la destination Paddle
    # envoie aussi les événements transaction.*).
    if etype == "transaction.completed" and data.get("origin") == "subscription_recurring":
        renewed = _find_user(db, {"custom_data": data.get("custom_data"), "id": data.get("subscription_id")})
        if renewed is not None:
            tracked.append((renewed, "subscription_renewed", data))

    if event_id:
        db.add(PaddleEvent(id=event_id, event_type=etype, subscription_id=sub_id, occurred_at=occurred_at))
    try:
        db.commit()
    except IntegrityError:  # même événement traité en parallèle : déjà pris en compte
        db.rollback()
        return {"ok": True, "duplicate": True}
    for u, name, payload in tracked:
        _track_billing(db, u, name, payload)
    return {"ok": True, "stale": True} if stale else {"ok": True}
