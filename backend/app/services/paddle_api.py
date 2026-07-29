"""Appels serveur à l'API Paddle Billing (gestion d'abonnement).

Nécessite `PADDLE_API_KEY`. Base sandbox/production selon `PADDLE_ENV`.
Fonctions fines, faciles à mocker dans les tests.
"""
import httpx

from ..config import settings


class PaddleUnavailable(Exception):
    pass


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.paddle_api_key}", "Content-Type": "application/json"}


def _request(method: str, path: str, json: dict | None = None) -> dict:
    if not settings.paddle_api_key:
        raise PaddleUnavailable("clé API Paddle absente")
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.request(method, f"{settings.paddle_api_base}{path}", headers=_headers(), json=json)
            resp.raise_for_status()
            return resp.json().get("data", {})
    except httpx.HTTPError as e:
        raise PaddleUnavailable(f"appel Paddle échoué : {e}") from e


def get_subscription(subscription_id: str) -> dict:
    return _request("GET", f"/subscriptions/{subscription_id}")


def cancel_subscription(subscription_id: str) -> dict:
    """Résiliation en fin de période payée (l'accès est conservé jusque-là)."""
    return _request(
        "POST", f"/subscriptions/{subscription_id}/cancel", {"effective_from": "next_billing_period"}
    )


def change_price(subscription_id: str, price_id: str) -> dict:
    """Change l'offre (annuel ↔ mensuel), facturation au prorata immédiate."""
    return _request(
        "PATCH",
        f"/subscriptions/{subscription_id}",
        {
            "items": [{"price_id": price_id, "quantity": 1}],
            "proration_billing_mode": "prorated_immediately",
        },
    )
