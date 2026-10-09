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
    def test_register_is_free_no_premium(self, client, auth_headers):
        headers, user = auth_headers()
        s = client.get("/api/billing/status", headers=headers).json()
        assert s["status"] == "free"
        assert s["access"] is False  # calendrier gratuit, premium bloqué

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


class TestPremiumEnforcement:
    """Les endpoints premium renvoient 402 aux utilisateurs gratuits."""

    def test_free_user_blocked_on_expenses(self, client, auth_headers):
        from tests.test_household import create_household
        headers, user = auth_headers()
        h = create_household(client, headers)
        r = client.get(f"/api/households/{h['id']}/expenses", headers=headers)
        assert r.status_code == 402

    def test_free_user_blocked_on_wall(self, client, auth_headers):
        from tests.test_household import create_household
        headers, user = auth_headers()
        h = create_household(client, headers)
        r = client.get(f"/api/households/{h['id']}/wall", headers=headers)
        assert r.status_code == 402

    def test_free_user_blocked_on_ical_regenerate(self, client, auth_headers):
        headers, user = auth_headers()
        assert client.post("/api/ical/regenerate", headers=headers).status_code == 402
        assert client.get("/api/ical/link", headers=headers).status_code == 402


class TestHouseholdPremium:
    def test_premium_propagates_to_household(self, client, auth_headers, db_session):
        from app.models import User
        from tests.test_rules import setup_family

        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        # seul parent1 paie
        db_session.get(User, user1["id"]).subscription_status = "active"
        db_session.commit()
        # parent2 (non payeur) a quand même accès aux fonctions premium
        assert client.get(f"/api/households/{h['id']}/expenses", headers=headers2).status_code == 200
        assert client.get("/api/billing/status", headers=headers2).json()["access"] is True


class TestWebhookHardening:
    def _send(self, client, event):
        sig, raw = _signed(event, "sk_test")
        return client.post("/api/billing/webhook", content=raw, headers={"Paddle-Signature": sig})

    def _event(self, user, event_id, etype, status, occurred_at, ends="2027-07-24T00:00:00Z"):
        return {
            "event_id": event_id,
            "event_type": etype,
            "occurred_at": occurred_at,
            "data": {
                "id": "sub_9",
                "customer_id": "ctm_9",
                "status": status,
                "current_billing_period": {"ends_at": ends},
                "custom_data": {"user_id": str(user["id"])},
            },
        }

    def test_duplicate_event_processed_once(self, client, auth_headers, db_session, monkeypatch):
        from app.models import PaddleEvent, User

        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        headers, user = auth_headers()
        ev = self._event(user, "evt_1", "subscription.activated", "active", "2026-09-01T10:00:00Z")
        assert self._send(client, ev).json() == {"ok": True}
        # changement manuel entre-temps : un rejeu ne doit pas l'écraser
        db_session.get(User, user["id"]).subscription_status = "past_due"
        db_session.commit()
        assert self._send(client, ev).json() == {"ok": True, "duplicate": True}
        assert db_session.get(User, user["id"]).subscription_status == "past_due"
        assert db_session.get(PaddleEvent, "evt_1").subscription_id == "sub_9"

    def test_out_of_order_event_ignored(self, client, auth_headers, db_session, monkeypatch):
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        headers, user = auth_headers()
        self._send(client, self._event(user, "evt_a", "subscription.activated", "active", "2026-09-01T10:00:00Z"))
        self._send(client, self._event(user, "evt_c", "subscription.canceled", "canceled", "2026-09-03T10:00:00Z"))
        # « updated: active » du 2 septembre livré en retard : ignoré
        late = self._send(
            client, self._event(user, "evt_b", "subscription.updated", "active", "2026-09-02T10:00:00Z")
        )
        assert late.json() == {"ok": True, "stale": True}
        assert client.get("/api/billing/status", headers=headers).json()["status"] == "canceled"
        # un événement plus récent est bien appliqué
        self._send(client, self._event(user, "evt_d", "subscription.updated", "active", "2026-09-04T10:00:00Z"))
        assert client.get("/api/billing/status", headers=headers).json()["status"] == "active"


class TestTrialAndPlans:
    """Essai sur l'offre annuelle + offres exposées à la landing / au paywall."""

    def test_trialing_without_trial_end_uses_period_end(self):
        assert billing.has_access("trialing", None, NOW + timedelta(days=5), NOW) is True
        assert billing.has_access("trialing", None, None, NOW) is False

    def test_webhook_trialing_sets_trial_end_and_grants_access(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        headers, user = auth_headers()
        ends = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        event = {
            "event_type": "subscription.created",
            "data": {
                "id": "sub_t",
                "customer_id": "ctm_t",
                "status": "trialing",
                "current_billing_period": {"ends_at": ends},
                "items": [{"price": {"id": "pri_annual"}, "trial_dates": {"ends_at": ends}}],
                "custom_data": {"user_id": str(user["id"])},
            },
        }
        sig, raw = _signed(event, "sk_test")
        assert client.post("/api/billing/webhook", content=raw, headers={"Paddle-Signature": sig}).status_code == 200
        s = client.get("/api/billing/status", headers=headers).json()
        assert s["status"] == "trialing" and s["access"] is True
        assert s["trial_days_left"] in (7, 8)

    def test_plans_read_trial_from_paddle(self, client, monkeypatch):
        from app.services import paddle_api

        billing.reset_plans_cache()
        monkeypatch.setattr(billing.settings, "paddle_price_annual", "pri_annual")
        monkeypatch.setattr(billing.settings, "paddle_price_monthly", "pri_monthly")
        prices = {
            "pri_annual": {"id": "pri_annual", "trial_period": {"interval": "week", "frequency": 1}},
            "pri_monthly": {"id": "pri_monthly", "trial_period": None},
        }
        monkeypatch.setattr(paddle_api, "get_price", lambda pid: prices[pid])
        r = client.get("/api/billing/plans")
        assert r.json() == {
            "annual": {"price_id": "pri_annual", "trial_days": 7},
            "monthly": {"price_id": "pri_monthly", "trial_days": 0},
        }
        billing.reset_plans_cache()

    def test_plans_fallback_when_paddle_unreachable(self, client, monkeypatch):
        from app.services import paddle_api

        billing.reset_plans_cache()
        monkeypatch.setattr(billing.settings, "paddle_price_annual", "pri_annual")
        monkeypatch.setattr(billing.settings, "paddle_price_monthly", "")
        monkeypatch.setattr(billing.settings, "annual_trial_days", 7)

        def boom(pid):
            raise paddle_api.PaddleUnavailable("x")

        monkeypatch.setattr(paddle_api, "get_price", boom)
        plans = client.get("/api/billing/plans").json()
        assert plans["annual"]["trial_days"] == 7
        assert plans["monthly"]["price_id"] is None  # pas de mensuel → le paywall le masque
        billing.reset_plans_cache()
