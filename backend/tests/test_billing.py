"""Abonnement Paddle : accès, essai, statut, webhook signé."""
import hashlib
import hmac
import json
from datetime import datetime, timedelta

from app.services import billing


NOW = datetime(2026, 7, 24, 12, 0, 0)


class TestAccess:
    def test_active_always_has_access(self):
        assert billing.has_access("active", None, None, NOW) is True

    def test_trialing_within_trial(self):
        assert billing.has_access("trialing", NOW + timedelta(days=3), None, NOW) is True

    def test_trialing_expired(self):
        assert billing.has_access("trialing", NOW - timedelta(days=1), None, NOW) is False

    def test_canceled_keeps_access_until_period_end(self):
        assert billing.has_access("canceled", None, NOW + timedelta(days=10), NOW) is True
        assert billing.has_access("canceled", None, NOW - timedelta(days=1), NOW) is False

    def test_none_no_access(self):
        assert billing.has_access("none", None, None, NOW) is False

    def test_trial_days_left(self):
        assert billing.trial_days_left("trialing", NOW + timedelta(days=3, hours=1), NOW) == 4
        assert billing.trial_days_left("trialing", NOW - timedelta(days=1), NOW) == 0
        assert billing.trial_days_left("active", None, NOW) is None


class TestSignature:
    def test_valid_signature(self):
        secret = "sk_test"
        body = b'{"a":1}'
        ts = "1720000000"
        h1 = hmac.new(secret.encode(), f"{ts}:".encode() + body, hashlib.sha256).hexdigest()
        assert billing.verify_signature(body, f"ts={ts};h1={h1}", secret) is True

    def test_bad_signature(self):
        assert billing.verify_signature(b"{}", "ts=1;h1=deadbeef", "sk_test") is False

    def test_no_secret(self):
        assert billing.verify_signature(b"{}", "ts=1;h1=x", "") is False


def _signed(body: dict, secret: str) -> tuple[str, bytes]:
    raw = json.dumps(body).encode()
    ts = "1720000000"
    h1 = hmac.new(secret.encode(), f"{ts}:".encode() + raw, hashlib.sha256).hexdigest()
    return f"ts={ts};h1={h1}", raw


class TestBillingApi:
    def test_register_starts_trial(self, client, auth_headers):
        headers, user = auth_headers()
        s = client.get("/api/billing/status", headers=headers).json()
        assert s["status"] == "trialing"
        assert s["access"] is True
        assert 13 <= s["trial_days_left"] <= 14

    def test_webhook_activates_subscription(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        headers, user = auth_headers()
        event = {
            "event_type": "subscription.activated",
            "data": {
                "id": "sub_1",
                "customer_id": "ctm_1",
                "status": "active",
                "current_billing_period": {"ends_at": "2027-07-24T00:00:00Z"},
                "custom_data": {"user_id": str(user["id"])},
            },
        }
        sig, raw = _signed(event, "sk_test")
        r = client.post("/api/billing/webhook", content=raw, headers={"Paddle-Signature": sig})
        assert r.status_code == 200, r.text
        s = client.get("/api/billing/status", headers=headers).json()
        assert s["status"] == "active" and s["access"] is True

    def test_webhook_bad_signature_403(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        r = client.post(
            "/api/billing/webhook",
            content=b'{"event_type":"x"}',
            headers={"Paddle-Signature": "ts=1;h1=bad"},
        )
        assert r.status_code == 403

    def test_webhook_cancel_keeps_access(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        headers, user = auth_headers()
        base = {
            "id": "sub_2",
            "customer_id": "ctm_2",
            "current_billing_period": {"ends_at": "2027-07-24T00:00:00Z"},
            "custom_data": {"user_id": str(user["id"])},
        }
        for etype, status in [("subscription.activated", "active"), ("subscription.canceled", "canceled")]:
            event = {"event_type": etype, "data": {**base, "status": status}}
            sig, raw = _signed(event, "sk_test")
            client.post("/api/billing/webhook", content=raw, headers={"Paddle-Signature": sig})
        s = client.get("/api/billing/status", headers=headers).json()
        assert s["status"] == "canceled"
        assert s["access"] is True  # payé jusqu'à 2027
