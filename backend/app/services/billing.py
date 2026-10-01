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
        # Fin d'essai inconnue (ancien webhook) : on s'appuie sur la fin de période Paddle.
        end = trial_ends_at or subscription_ends_at
        return end is not None and now < end
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


# ---------------------------------------------------------------- offres affichées

_TRIAL_UNIT_DAYS = {"day": 1, "week": 7, "month": 30, "year": 365}
_plans_cache: dict = {"at": 0.0, "value": None}
PLANS_TTL = 3600  # secondes


def _trial_days(price_id: str) -> int | None:
    """Durée d'essai configurée sur le prix Paddle (None si inconnue)."""
    from . import paddle_api

    if not price_id:
        return None
    try:
        trial = (paddle_api.get_price(price_id) or {}).get("trial_period")
    except paddle_api.PaddleUnavailable:
        return None
    if not trial:
        return 0
    return int(trial.get("frequency") or 0) * _TRIAL_UNIT_DAYS.get(trial.get("interval"), 0)


def plans(now: float | None = None) -> dict:
    """Offres proposées (price_id + jours d'essai), mises en cache une heure.

    La durée d'essai vient du prix Paddle lui-même : l'app n'annonce jamais un
    essai que Paddle n'appliquerait pas. Repli : ANNUAL_TRIAL_DAYS.
    """
    import time

    from ..config import settings

    now = time.time() if now is None else now
    cached = _plans_cache["value"]
    if cached is not None and now - _plans_cache["at"] < PLANS_TTL:
        return cached
    annual_trial = _trial_days(settings.paddle_price_annual)
    monthly_trial = _trial_days(settings.paddle_price_monthly)
    value = {
        "annual": {
            "price_id": settings.paddle_price_annual or None,
            "trial_days": settings.annual_trial_days if annual_trial is None else annual_trial,
        },
        "monthly": {
            "price_id": settings.paddle_price_monthly or None,
            "trial_days": monthly_trial or 0,
        },
    }
    _plans_cache.update(at=now, value=value)
    return value


def reset_plans_cache() -> None:
    _plans_cache.update(at=0.0, value=None)
