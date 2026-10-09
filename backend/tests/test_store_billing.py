"""Achats intégrés (App Store / Google Play via RevenueCat) : webhook, accès par foyer,
cohabitation avec Paddle, resynchronisation."""
import time
from datetime import timedelta

import pytest

from app.config import settings
from app.models import StoreSubscription, User, utcnow
from app.services import store_billing
from tests.test_rules import setup_family

SECRET = "Bearer rc_test_secret"
DAY_MS = 24 * 3600 * 1000


@pytest.fixture(autouse=True)
def webhook_enabled(monkeypatch):
    monkeypatch.setattr(settings, "revenuecat_webhook_secret", SECRET)


def now_ms() -> int:
    return int(time.time() * 1000)


def send(client, user_id, etype, *, event_id=None, store="APP_STORE", at=None, expires_in_days=30, **extra):
    at = at if at is not None else now_ms()
    event = {
        "id": event_id or f"evt-{etype}-{at}",
        "type": etype,
        "app_user_id": str(user_id),
        "store": store,
        "product_id": "premium_annual",
        "event_timestamp_ms": at,
        "expiration_at_ms": at + expires_in_days * DAY_MS,
        "period_type": "NORMAL",
        **extra,
    }
    return client.post("/api/billing/revenuecat-webhook", json={"event": event}, headers={"Authorization": SECRET})


def status(client, headers):
    return client.get("/api/billing/status", headers=headers).json()


def test_purchase_gives_premium_to_the_whole_household(client, auth_headers):
    headers1, user1, headers2, _, _ = setup_family(client, auth_headers)
    assert status(client, headers2)["access"] is False
    assert send(client, user1["id"], "INITIAL_PURCHASE").status_code == 200
    s1, s2 = status(client, headers1), status(client, headers2)
    assert s1["access"] is True and s2["access"] is True
    assert s1["source"] == "app_store" and s1["is_payer"] is True
    assert s1["manage_url"] == "https://apps.apple.com/account/subscriptions"
    assert s2["source"] == "app_store" and s2["is_payer"] is False


def test_cancellation_keeps_access_until_period_end_then_expiration_cuts_it(client, auth_headers, db_session):
    headers, user = auth_headers()
    t0 = now_ms()
    send(client, user["id"], "INITIAL_PURCHASE", at=t0)
    send(client, user["id"], "CANCELLATION", at=t0 + 1000, cancel_reason="UNSUBSCRIBE")
    assert status(client, headers)["access"] is True
    sub = db_session.query(StoreSubscription).one()
    assert sub.status == "canceled"
    send(client, user["id"], "EXPIRATION", at=t0 + 2000, expires_in_days=0)
    assert status(client, headers)["access"] is False


def test_refund_cuts_access_immediately(client, auth_headers):
    headers, user = auth_headers()
    t0 = now_ms()
    send(client, user["id"], "INITIAL_PURCHASE", at=t0)
    send(client, user["id"], "CANCELLATION", at=t0 + 1000, cancel_reason="CUSTOMER_SUPPORT")
    assert status(client, headers)["access"] is False


def test_billing_issue_keeps_access_during_grace(client, auth_headers):
    headers, user = auth_headers()
    t0 = now_ms()
    send(client, user["id"], "INITIAL_PURCHASE", at=t0)
    send(client, user["id"], "BILLING_ISSUE", at=t0 + 1000, expires_in_days=-1, grace_period_expiration_at_ms=t0 + 3 * DAY_MS)
    assert status(client, headers)["access"] is True


def test_out_of_order_and_replayed_events_are_ignored(client, auth_headers, db_session):
    headers, user = auth_headers()
    t0 = now_ms()
    send(client, user["id"], "EXPIRATION", at=t0, expires_in_days=0, event_id="e2")
    # RENEWAL plus ancien, livré après : ignoré.
    send(client, user["id"], "RENEWAL", at=t0 - 60_000, event_id="e1")
    assert status(client, headers)["access"] is False
    # Rejeu du même événement : sans effet.
    assert send(client, user["id"], "EXPIRATION", at=t0, event_id="e2").json()["duplicate"] is True


def test_paddle_cancellation_does_not_cut_an_active_store_subscription(client, auth_headers, db_session):
    headers, user = auth_headers()
    send(client, user["id"], "INITIAL_PURCHASE")
    u = db_session.get(User, user["id"])
    u.subscription_status = "canceled"
    u.subscription_ends_at = utcnow() - timedelta(days=1)
    db_session.commit()
    assert status(client, headers)["access"] is True


def test_play_store_and_unknown_user(client, auth_headers):
    headers, user = auth_headers()
    send(client, user["id"], "INITIAL_PURCHASE", store="PLAY_STORE")
    assert status(client, headers)["source"] == "play_store"
    # Achat anonyme (avant logIn) ou store hors périmètre : accepté mais sans effet.
    assert send(client, "$RCAnonymousID:abc", "INITIAL_PURCHASE").status_code == 200
    assert send(client, user["id"], "INITIAL_PURCHASE", store="PROMOTIONAL", event_id="promo").status_code == 200


def test_webhook_requires_the_shared_secret(client, auth_headers, monkeypatch):
    _, user = auth_headers()
    event = {"event": {"id": "x", "type": "INITIAL_PURCHASE", "app_user_id": str(user["id"]), "store": "APP_STORE"}}
    assert client.post("/api/billing/revenuecat-webhook", json=event, headers={"Authorization": "Bearer nope"}).status_code == 403
    assert client.post("/api/billing/revenuecat-webhook", json=event).status_code == 403
    monkeypatch.setattr(settings, "revenuecat_webhook_secret", "")
    assert client.post("/api/billing/revenuecat-webhook", json=event, headers={"Authorization": SECRET}).status_code == 503


def test_store_sync_reads_revenuecat(client, auth_headers, monkeypatch):
    headers, _ = auth_headers()
    monkeypatch.setattr(settings, "revenuecat_api_key", "sk_test")
    future = (utcnow() + timedelta(days=30)).isoformat() + "Z"
    monkeypatch.setattr(
        store_billing,
        "fetch_subscriber",
        lambda app_user_id: {"subscriptions": {"premium_monthly": {"store": "APP_STORE", "expires_date": future, "period_type": "normal"}}},
    )
    s = client.post("/api/billing/store-sync", headers=headers).json()
    assert s["access"] is True and s["source"] == "app_store"


def test_store_sync_survives_revenuecat_outage(client, auth_headers, monkeypatch):
    headers, _ = auth_headers()
    monkeypatch.setattr(settings, "revenuecat_api_key", "sk_test")

    def boom(_):
        raise RuntimeError("down")

    monkeypatch.setattr(store_billing, "fetch_subscriber", boom)
    assert client.post("/api/billing/store-sync", headers=headers).json()["access"] is False


def test_account_deletion_removes_store_rows(client, auth_headers, db_session):
    headers, user = auth_headers()
    send(client, user["id"], "INITIAL_PURCHASE")
    assert client.delete("/api/auth/me", headers=headers).status_code == 204
    assert db_session.query(StoreSubscription).count() == 0
