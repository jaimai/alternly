"""Abonnement individuel (Stripe) : statut d'accès et synchronisation webhook.

Chaque parent a son propre abonnement (39 € / an). Essai gratuit sans carte de
`settings.trial_days` jours à l'inscription. Facturation désactivée (clés Stripe
absentes ou PAYWALL_MODE=off) → accès complet pour tous.
"""
import logging
import math
from datetime import datetime, timezone

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Notification, User, utcnow

PAYWALL_DETAIL = "Votre essai est terminé : abonnez-vous pour continuer à modifier le calendrier."

# Statuts Stripe donnant accès. `trialing` côté Stripe = abonnement souscrit
# pendant l'essai (trial_end reporté) : c'est un abonnement en place → « active ».
_STRIPE_ACTIVE = {"active", "trialing"}
READ_METHODS = {"GET", "HEAD", "OPTIONS"}


def compute_status(user: User, now: datetime | None = None) -> str:
    """trialing | active | past_due | canceled | expired."""
    now = now or utcnow()
    sub = user.subscription_status
    if sub in _STRIPE_ACTIVE:
        return "active"
    if sub == "past_due":
        return "past_due"  # période de grâce : accès conservé pendant les relances Stripe
    if user.trial_ends_at is not None and now < user.trial_ends_at:
        return "trialing"
    if sub is not None or user.stripe_subscription_id:
        return "canceled"  # a eu un abonnement (résilié, impayé, incomplet…)
    return "expired"


def has_access(user: User, now: datetime | None = None) -> bool:
    if not settings.billing_enabled:
        return True
    return compute_status(user, now) in {"active", "past_due", "trialing"}


def status_payload(user: User) -> dict:
    now = utcnow()
    status = compute_status(user, now)
    enabled = settings.billing_enabled
    access = has_access(user, now)
    days_left = None
    if status == "trialing" and user.trial_ends_at is not None:
        days_left = max(0, math.ceil((user.trial_ends_at - now).total_seconds() / 86400))
    return {
        "enabled": enabled,
        "status": status,
        "has_access": access,
        "read_only": enabled and not access and settings.paywall_mode == "read_only",
        "trial_ends_at": user.trial_ends_at,
        "current_period_end": user.current_period_end,
        "cancel_at_period_end": bool(user.cancel_at_period_end),
        "days_left": days_left,
        "price_label": settings.billing_price_label,
    }


def paywall_blocks(user: User, method: str) -> bool:
    """True si la requête (méthode HTTP) doit être refusée en 402."""
    if has_access(user):
        return False
    if settings.paywall_mode == "block":
        return True
    return method.upper() not in READ_METHODS  # read_only


# ---------- webhook ----------

def _ts(value) -> datetime | None:
    if not value:
        return None
    return datetime.fromtimestamp(int(value), tz=timezone.utc).replace(tzinfo=None)


def _user_from_metadata(db: Session, obj: dict) -> User | None:
    raw = (obj.get("metadata") or {}).get("user_id") or obj.get("client_reference_id")
    try:
        return db.get(User, int(raw)) if raw else None
    except (TypeError, ValueError):
        return None


def _user_for(db: Session, obj: dict) -> User | None:
    customer = obj.get("customer")
    if isinstance(customer, dict):
        customer = customer.get("id")
    if customer:
        user = db.scalar(select(User).where(User.stripe_customer_id == customer))
        if user is not None:
            return user
    user = _user_from_metadata(db, obj)
    if user is not None and customer and not user.stripe_customer_id:
        user.stripe_customer_id = customer
    return user


def _period_end(sub: dict) -> datetime | None:
    # Versions récentes de l'API : current_period_end porté par les items.
    if sub.get("current_period_end"):
        return _ts(sub["current_period_end"])
    items = (sub.get("items") or {}).get("data") or []
    ends = [i.get("current_period_end") for i in items if i.get("current_period_end")]
    return _ts(max(ends)) if ends else None


def _sync_subscription(db: Session, sub: dict, deleted: bool) -> None:
    user = _user_for(db, sub)
    if user is None:
        return
    # Événement tardif d'un ancien abonnement remplacé : ne pas écraser l'actuel.
    if deleted and user.stripe_subscription_id and user.stripe_subscription_id != sub.get("id"):
        return
    user.stripe_subscription_id = sub.get("id")
    user.subscription_status = "canceled" if deleted else sub.get("status")
    user.cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
    user.current_period_end = _period_end(sub)


def _checkout_completed(db: Session, session: dict) -> None:
    user = _user_from_metadata(db, session) or _user_for(db, session)
    if user is None:
        return
    customer = session.get("customer")
    if isinstance(customer, str) and customer:
        user.stripe_customer_id = customer
    subscription = session.get("subscription")
    if isinstance(subscription, dict):
        subscription = subscription.get("id")
    if subscription:
        user.stripe_subscription_id = subscription
    # Le statut exact arrive par customer.subscription.* ; en attendant (ordre
    # d'arrivée non garanti), un checkout terminé donne accès.
    if session.get("status") == "complete" and user.subscription_status not in {"active", "trialing", "past_due"}:
        user.subscription_status = "active"


def _payment_failed(db: Session, invoice: dict) -> None:
    user = _user_for(db, invoice)
    if user is None:
        return
    if user.subscription_status in {"active", "trialing", None} or user.stripe_subscription_id:
        user.subscription_status = "past_due"
    db.add(Notification(user_id=user.id, type="payment_failed", payload={}))


HANDLED_EVENTS = {
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
}


def handle_event(db: Session, event: dict) -> None:
    """Applique un événement Stripe (sans commit)."""
    type_ = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    if type_ == "checkout.session.completed":
        _checkout_completed(db, obj)
    elif type_ in {"customer.subscription.created", "customer.subscription.updated"}:
        _sync_subscription(db, obj, deleted=False)
    elif type_ == "customer.subscription.deleted":
        _sync_subscription(db, obj, deleted=True)
    elif type_ == "invoice.payment_failed":
        _payment_failed(db, obj)


def cancel_for_deleted_account(user: User) -> None:
    """Suppression de compte : résilie immédiatement l'abonnement Stripe en cours
    (sinon il serait encore prélevé). Au mieux : une erreur Stripe n'empêche pas
    la suppression (journalisée pour traitement manuel)."""
    if not settings.stripe_secret_key or not user.stripe_subscription_id:
        return
    if user.subscription_status in {"canceled", "incomplete_expired"}:
        return
    try:
        stripe.Subscription.cancel(user.stripe_subscription_id, api_key=settings.stripe_secret_key)
    except stripe.StripeError:
        logging.getLogger("coparent").exception(
            "Résiliation Stripe impossible à la suppression du compte %s (abonnement %s)",
            user.id, user.stripe_subscription_id,
        )
