"""Logique d'abonnement Paddle : accès, essai, vérification des webhooks.

Fonctions pures (pas d'I/O) pour être testables sans réseau ni base.
"""
import hashlib
import hmac
from datetime import datetime, timezone

from ..config import settings  # noqa: F401 — point d'ancrage pour les tests/monkeypatch

# Paddle → statut interne.
_STATUS_MAP = {
    "active": "active",
    "trialing": "trialing",
    "past_due": "past_due",
    "paused": "past_due",
    "canceled": "canceled",
}


def map_status(paddle_status: str) -> str:
    return _STATUS_MAP.get(paddle_status, "none")


def has_access(status: str, trial_ends_at, subscription_ends_at, now: datetime) -> bool:
    """L'utilisateur a-t-il accès à l'app ?"""
    if status == "active":
        return True
    if status == "trialing":
        return trial_ends_at is not None and now < trial_ends_at
    if status in ("canceled", "past_due"):
        # accès conservé jusqu'à la fin de la période déjà payée
        return subscription_ends_at is not None and now < subscription_ends_at
    return False


def trial_days_left(status: str, trial_ends_at, now: datetime) -> int | None:
    """Jours d'essai restants (arrondi au jour supérieur), ou None hors essai."""
    if status != "trialing" or trial_ends_at is None:
        return None
    delta = trial_ends_at - now
    if delta.total_seconds() <= 0:
        return 0
    return -(-delta.days) if delta.seconds == 0 else delta.days + 1


def verify_signature(raw_body: bytes, signature_header: str | None, secret: str) -> bool:
    """Vérifie l'en-tête `Paddle-Signature: ts=..;h1=..` (HMAC-SHA256 de `ts:body`)."""
    if not secret or not signature_header:
        return False
    parts = dict(
        p.split("=", 1) for p in signature_header.split(";") if "=" in p
    )
    ts, h1 = parts.get("ts"), parts.get("h1")
    if not ts or not h1:
        return False
    signed = f"{ts}:".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, h1)


def parse_iso(value: str | None) -> datetime | None:
    """Parse un instant ISO 8601 Paddle → datetime naïf UTC (cohérent avec le modèle)."""
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt
