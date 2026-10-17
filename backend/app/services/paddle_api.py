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


def _request(method: str, path: str, json: dict | None = None, timeout: float = 15) -> dict:
    if not settings.paddle_api_key:
        raise PaddleUnavailable("clé API Paddle absente")
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.request(method, f"{settings.paddle_api_base}{path}", headers=_headers(), json=json)
            resp.raise_for_status()
            return resp.json().get("data", {})
    except httpx.HTTPError as e:
        raise PaddleUnavailable(f"appel Paddle échoué : {e}") from e


def get_subscription(subscription_id: str) -> dict:
    return _request("GET", f"/subscriptions/{subscription_id}")


def list_subscriptions(max_pages: int = 20) -> list[dict]:
    """Tous les abonnements du compte Paddle (pagination par curseur `after`)."""
    if not settings.paddle_api_key:
        raise PaddleUnavailable("clé API Paddle absente")
    out: list[dict] = []
    params: dict[str, str] = {"per_page": "200"}
    try:
        with httpx.Client(timeout=20) as client:
            for _ in range(max_pages):
                resp = client.get(f"{settings.paddle_api_base}/subscriptions", headers=_headers(), params=params)
                resp.raise_for_status()
                body = resp.json()
                page = body.get("data") or []
                out.extend(page)
                pagination = (body.get("meta") or {}).get("pagination") or {}
                if not pagination.get("has_more") or not page:
                    break
                params = {"per_page": "200", "after": page[-1]["id"]}
    except httpx.HTTPError as e:
        raise PaddleUnavailable(f"appel Paddle échoué : {e}") from e
    return out


def get_transaction(transaction_id: str) -> dict:
    """Transaction du checkout (custom_data, subscription_id une fois l'abonnement créé)."""
    return _request("GET", f"/transactions/{transaction_id}", timeout=8)


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


def get_price(price_id: str) -> dict:
    """Prix Paddle (dont `trial_period` : {interval, frequency} ou null)."""
    # Lu au rendu de la landing (cache 1 h) : délai court, repli sur ANNUAL_TRIAL_DAYS.
    return _request("GET", f"/prices/{price_id}", timeout=4)
