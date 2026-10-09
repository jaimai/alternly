"""Achats intégrés (App Store / Google Play) reçus de RevenueCat : accès et événements.

Le backend reste la seule source de vérité : le webhook RevenueCat (et la
resynchronisation à la demande) alimentent `StoreSubscription`, et l'accès Premium du
foyer combine Paddle et stores (cf. deps.user_has_premium). Conception :
docs/mobile/architecture-technique.md §7.3.
"""
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import StoreSubscription, User, utcnow

REVENUECAT_API = "https://api.revenuecat.com/v1"

# Pages d'abonnement des stores : un achat Apple se résilie chez Apple, pas chez nous.
MANAGE_URLS = {
    "app_store": "https://apps.apple.com/account/subscriptions",
    "play_store": "https://play.google.com/store/account/subscriptions",
}

_STORES = {"APP_STORE": "app_store", "MAC_APP_STORE": "app_store", "PLAY_STORE": "play_store"}
_ACTIVE_EVENTS = {"INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"}


def has_access(sub: StoreSubscription, now: datetime) -> bool:
    """Accès jusqu'à la fin de la période payée (ou de la grâce) ; jamais une fois expiré."""
    if sub.status == "expired":
        return False
    if sub.status == "canceled":
        return sub.ends_at is not None and now < sub.ends_at
    return sub.ends_at is None or now < sub.ends_at


def user_has_store_access(db: Session, user_id: int, now: datetime | None = None) -> bool:
    now = now or utcnow()
    subs = db.scalars(select(StoreSubscription).where(StoreSubscription.user_id == user_id))
    return any(has_access(s, now) for s in subs)


def active_store(db: Session, user_id: int, now: datetime | None = None) -> str | None:
    """Store qui donne accès à ce parent (app_store / play_store), sinon None."""
    now = now or utcnow()
    for s in db.scalars(select(StoreSubscription).where(StoreSubscription.user_id == user_id)):
        if has_access(s, now):
            return s.source
    return None


def _ms(value) -> datetime | None:
    if value in (None, ""):
        return None
    return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc).replace(tzinfo=None)


def _iso(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def find_user(db: Session, event: dict) -> User | None:
    """L'app appelle Purchases.logIn(<id Alternly>) : app_user_id (ou un alias) est notre id."""
    candidates = [event.get("app_user_id"), event.get("original_app_user_id"), *(event.get("aliases") or [])]
    for c in candidates:
        if isinstance(c, str) and c.isdigit():
            user = db.get(User, int(c))
            if user is not None:
                return user
    return None


def _row(db: Session, user: User, source: str) -> StoreSubscription:
    sub = db.scalar(select(StoreSubscription).where(StoreSubscription.user_id == user.id, StoreSubscription.source == source))
    if sub is None:
        sub = StoreSubscription(user_id=user.id, source=source)
        db.add(sub)
    return sub


def _sandbox_ignored(is_sandbox: bool) -> bool:
    return is_sandbox and not settings.revenuecat_allow_sandbox


def _grants_premium(event: dict) -> bool:
    """L'événement concerne-t-il l'entitlement Premium (et pas un autre produit du projet) ?"""
    ids = event.get("entitlement_ids")
    if ids is None and event.get("entitlement_id"):
        ids = [event["entitlement_id"]]
    return settings.revenuecat_entitlement in (ids or [])


def apply_event(db: Session, user: User, event: dict) -> StoreSubscription | None:
    """Applique un événement webhook RevenueCat. Renvoie la ligne modifiée, ou None si ignoré."""
    etype = event.get("type", "")
    source = _STORES.get(event.get("store", ""))
    if source is None:  # promotionnel, Stripe… : hors périmètre
        return None
    if _sandbox_ignored(event.get("environment") == "SANDBOX") or not _grants_premium(event):
        return None
    occurred = _ms(event.get("event_timestamp_ms"))
    sub = _row(db, user, source)
    # Ordre : RevenueCat ne garantit pas l'ordre de livraison.
    if occurred is not None and sub.last_event_at is not None and occurred < sub.last_event_at:
        return None

    expires = _ms(event.get("expiration_at_ms"))
    if etype in _ACTIVE_EVENTS:
        sub.status = "trialing" if event.get("period_type") == "TRIAL" else "active"
        sub.ends_at = expires
    elif etype == "CANCELLATION":
        # Remboursement (support Apple / Google) : accès coupé tout de suite.
        if event.get("cancel_reason") == "CUSTOMER_SUPPORT":
            sub.status, sub.ends_at = "expired", occurred or utcnow()
        else:
            sub.status, sub.ends_at = "canceled", expires
    elif etype == "BILLING_ISSUE":
        sub.status = "grace"
        sub.ends_at = _ms(event.get("grace_period_expiration_at_ms")) or expires
    elif etype == "EXPIRATION":
        sub.status = "expired"
        sub.ends_at = expires or occurred
    else:
        return None
    sub.product_id = event.get("product_id") or sub.product_id
    sub.external_id = event.get("original_transaction_id") or sub.external_id
    sub.last_event_at = occurred or sub.last_event_at
    sub.updated_at = utcnow()
    return sub


def expire_user(db: Session, user: User, at: datetime) -> list[StoreSubscription]:
    """Coupe l'accès store de ce parent (abonnement transféré à un autre compte). Ne commit pas."""
    changed = []
    for sub in db.scalars(select(StoreSubscription).where(StoreSubscription.user_id == user.id)):
        if has_access(sub, at):
            sub.status, sub.ends_at = "expired", at
            sub.last_event_at = at
            sub.updated_at = utcnow()
            changed.append(sub)
    return changed


def fetch_subscriber(app_user_id: str) -> dict:
    with httpx.Client(timeout=10) as client:
        resp = client.get(
            f"{REVENUECAT_API}/subscribers/{app_user_id}",
            headers={"Authorization": f"Bearer {settings.revenuecat_api_key}"},
        )
        resp.raise_for_status()
        return resp.json().get("subscriber", {})


def sync_user(db: Session, user: User) -> None:
    """Resynchronise depuis l'API RevenueCat (webhook perdu, « Restaurer les achats »).

    Pour chaque store, garde l'abonnement Premium qui expire le plus tard. Un store absent
    de la réponse (abonnement transféré à un autre compte, par exemple) perd l'accès.
    Ne commit pas.
    """
    if not settings.revenuecat_api_key:
        return
    subscriber = fetch_subscriber(str(user.id))
    now = utcnow()
    entitlement = (subscriber.get("entitlements") or {}).get(settings.revenuecat_entitlement) or {}
    premium_products = {entitlement.get("product_identifier")} - {None}
    best: dict[str, tuple[datetime | None, str, dict]] = {}
    for product_id, info in (subscriber.get("subscriptions") or {}).items():
        source = _STORES.get(info.get("store", ""))
        if source is None or product_id not in premium_products or _sandbox_ignored(bool(info.get("is_sandbox"))):
            continue
        expires = _iso(info.get("expires_date"))
        current = best.get(source)
        if current is None or (expires or datetime.max) > (current[0] or datetime.max):
            best[source] = (expires, product_id, info)
    for source, (expires, product_id, info) in best.items():
        sub = _row(db, user, source)
        grace = _iso(info.get("grace_period_expires_date"))
        if info.get("refunded_at"):
            sub.status, sub.ends_at = "expired", _iso(info.get("refunded_at"))
        elif expires is not None and expires <= now and not (grace and grace > now):
            sub.status, sub.ends_at = "expired", expires
        elif info.get("billing_issues_detected_at") and grace:
            sub.status, sub.ends_at = "grace", grace
        elif info.get("unsubscribe_detected_at"):
            sub.status, sub.ends_at = "canceled", expires
        else:
            sub.status = "trialing" if info.get("period_type") == "trial" else "active"
            sub.ends_at = expires
        sub.product_id = product_id
        sub.updated_at = now
        # État lu à la source : un webhook plus ancien, livré en retard, ne l'écrase pas.
        sub.last_event_at = now
    for sub in db.scalars(select(StoreSubscription).where(StoreSubscription.user_id == user.id)):
        if sub.source not in best and has_access(sub, now):
            sub.status, sub.ends_at, sub.last_event_at, sub.updated_at = "expired", now, now, now
