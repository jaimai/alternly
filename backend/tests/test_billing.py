"""Abonnement Stripe : statut, paywall, Checkout, portail, webhook (Stripe simulé)."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import stripe
from sqlalchemy import create_engine, select, text
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.migrations import run_migrations
from app.models import Notification, StripeEvent, User, utcnow
from tests.test_household import create_household
from tests.test_rules import setup_family

CUSTODY = {"pattern": "alternate_weeks", "start_date": "2026-01-05"}


@pytest.fixture
def billing_on(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_price_id", "price_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_123")
    monkeypatch.setattr(settings, "paywall_mode", "read_only")
    monkeypatch.setattr(settings, "stripe_automatic_tax", False)


@pytest.fixture
def fake_stripe(monkeypatch):
    """Remplace les appels réseau Stripe ; enregistre les paramètres reçus."""
    calls = {"customers": [], "checkout": [], "portal": []}

    def customer_create(**kw):
        calls["customers"].append(kw)
        return SimpleNamespace(id=f"cus_{len(calls['customers'])}")

    def checkout_create(**kw):
        calls["checkout"].append(kw)
        return SimpleNamespace(url="https://checkout.stripe.test/s/1")

    def portal_create(**kw):
        calls["portal"].append(kw)
        return SimpleNamespace(url="https://billing.stripe.test/p/1")

    def construct_event(payload, sig_header, secret):
        assert secret == "whsec_123"
        if sig_header != "valid":
            raise stripe.SignatureVerificationError("Signature invalide", sig_header)
        return json.loads(payload)

    monkeypatch.setattr(stripe.Customer, "create", customer_create)
    monkeypatch.setattr(stripe.checkout.Session, "create", checkout_create)
    monkeypatch.setattr(stripe.billing_portal.Session, "create", portal_create)
    monkeypatch.setattr(stripe.Webhook, "construct_event", construct_event)
    return calls


def _user(db_session, user_id) -> User:
    user = db_session.get(User, user_id)
    db_session.refresh(user)
    return user


def _expire_trial(db_session, user_id):
    user = _user(db_session, user_id)
    user.trial_ends_at = utcnow() - timedelta(days=1)
    db_session.commit()


def _status(client, headers):
    resp = client.get("/api/billing/status", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _webhook(client, event, sig="valid"):
    return client.post(
        "/api/billing/webhook",
        content=json.dumps(event),
        headers={"Stripe-Signature": sig, "Content-Type": "application/json"},
    )


def _sub_event(event_id, type_, user, status="active", sub_id="sub_1", period_end=None, cancel=False):
    period_end = period_end or int((datetime.now(timezone.utc) + timedelta(days=365)).timestamp())
    return {
        "id": event_id,
        "type": type_,
        "data": {"object": {
            "id": sub_id,
            "object": "subscription",
            "customer": user.stripe_customer_id or "cus_x",
            "status": status,
            "cancel_at_period_end": cancel,
            "metadata": {"user_id": str(user.id)},
            # API récente : fin de période portée par les items
            "items": {"data": [{"current_period_end": period_end}]},
        }},
    }


class TestDisabled:
    def test_disabled_by_default_full_access(self, client, auth_headers, db_session):
        headers, user = auth_headers()
        h = create_household(client, headers)
        _expire_trial(db_session, user["id"])
        st = _status(client, headers)
        assert st["enabled"] is False and st["has_access"] is True and st["read_only"] is False
        assert st["price_label"] == "39 € / an"
        resp = client.put(
            f"/api/households/{h['id']}/custody-rule", json={**CUSTODY, "reference_parent_id": user["id"]},
            headers=headers,
        )
        assert resp.status_code == 200

    def test_paywall_off_disables_billing(self, client, auth_headers, billing_on, monkeypatch, db_session):
        monkeypatch.setattr(settings, "paywall_mode", "off")
        headers, user = auth_headers()
        _expire_trial(db_session, user["id"])
        assert _status(client, headers)["enabled"] is False
        assert _status(client, headers)["has_access"] is True

    def test_checkout_503_when_disabled(self, client, auth_headers):
        headers, _ = auth_headers()
        resp = client.post("/api/billing/checkout", headers=headers)
        assert resp.status_code == 503 and resp.json()["detail"] == "Paiement indisponible"

    def test_status_requires_auth(self, client):
        assert client.get("/api/billing/status").status_code == 401


class TestStatus:
    def test_new_user_is_trialing_14_days(self, client, auth_headers, billing_on):
        headers, _ = auth_headers()
        st = _status(client, headers)
        assert st["enabled"] is True
        assert st["status"] == "trialing" and st["has_access"] is True and st["read_only"] is False
        assert st["days_left"] == 14
        assert st["trial_ends_at"] is not None and st["current_period_end"] is None
        assert st["cancel_at_period_end"] is False

    def test_days_left_rounds_up(self, client, auth_headers, billing_on, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.trial_ends_at = utcnow() + timedelta(days=2, hours=1)
        db_session.commit()
        assert _status(client, headers)["days_left"] == 3

    def test_expired(self, client, auth_headers, billing_on, db_session):
        headers, user = auth_headers()
        _expire_trial(db_session, user["id"])
        st = _status(client, headers)
        assert st["status"] == "expired" and st["has_access"] is False and st["read_only"] is True
        assert st["days_left"] is None

    def test_expired_block_mode_not_read_only(self, client, auth_headers, billing_on, db_session, monkeypatch):
        monkeypatch.setattr(settings, "paywall_mode", "block")
        headers, user = auth_headers()
        _expire_trial(db_session, user["id"])
        st = _status(client, headers)
        assert st["has_access"] is False and st["read_only"] is False

    @pytest.mark.parametrize(
        "stripe_status,expected,access",
        [
            ("active", "active", True),
            ("trialing", "active", True),  # abonné pendant l'essai
            ("past_due", "past_due", True),  # période de grâce
            ("canceled", "canceled", False),
            ("unpaid", "canceled", False),
            ("incomplete", "canceled", False),
        ],
    )
    def test_subscription_statuses_after_trial(
        self, client, auth_headers, billing_on, db_session, stripe_status, expected, access
    ):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.trial_ends_at = utcnow() - timedelta(days=3)
        u.subscription_status = stripe_status
        u.stripe_subscription_id = "sub_1"
        db_session.commit()
        st = _status(client, headers)
        assert st["status"] == expected and st["has_access"] is access

    def test_canceled_during_trial_still_trialing(self, client, auth_headers, billing_on, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.subscription_status = "canceled"
        db_session.commit()
        assert _status(client, headers)["status"] == "trialing"


class TestPaywall:
    def _family_expired(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        _expire_trial(db_session, user1["id"])
        return headers1, user1, headers2, user2, h

    def test_read_only_allows_reads_blocks_writes(self, client, auth_headers, billing_on, db_session):
        headers1, user1, headers2, user2, h = self._family_expired(client, auth_headers, db_session)
        hid = h["id"]
        assert client.get(f"/api/households/{hid}/expenses", headers=headers1).status_code == 200
        assert client.get(f"/api/households/{hid}/history", headers=headers1).status_code == 200
        resp = client.post(
            f"/api/households/{hid}/expenses",
            json={"label": "x", "amount_cents": 100, "date": "2026-07-10", "category": "autre"},
            headers=headers1,
        )
        assert resp.status_code == 402
        assert resp.json()["detail"] == (
            "Votre essai est terminé : abonnez-vous pour continuer à modifier le calendrier."
        )
        assert client.patch(f"/api/households/{hid}", json={"name": "X"}, headers=headers1).status_code == 402
        # chaque parent a son propre abonnement : l'autre (en essai) écrit toujours
        ok = client.post(
            f"/api/households/{hid}/expenses",
            json={"label": "x", "amount_cents": 100, "date": "2026-07-10", "category": "autre"},
            headers=headers2,
        )
        assert ok.status_code == 201

    def test_block_mode_blocks_reads(self, client, auth_headers, billing_on, db_session, monkeypatch):
        monkeypatch.setattr(settings, "paywall_mode", "block")
        headers1, _, _, _, h = self._family_expired(client, auth_headers, db_session)
        assert client.get(f"/api/households/{h['id']}/expenses", headers=headers1).status_code == 402

    def test_never_paywalled(self, client, auth_headers, billing_on, db_session, monkeypatch):
        monkeypatch.setattr(settings, "paywall_mode", "block")
        headers1, user1, _, _, h = self._family_expired(client, auth_headers, db_session)
        assert client.get("/api/auth/me", headers=headers1).status_code == 200
        assert client.get("/api/households/mine", headers=headers1).status_code == 200
        assert client.get("/api/billing/status", headers=headers1).status_code == 200
        assert client.get("/api/auth/me/export", headers=headers1).status_code == 200
        assert client.get("/api/health").status_code == 200

    def test_ical_feed_not_paywalled(self, client, auth_headers, billing_on, db_session, monkeypatch):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule", json={**CUSTODY, "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        token = client.post("/api/ical/regenerate", headers=headers1).json()["ical_token"]
        _expire_trial(db_session, user1["id"])
        monkeypatch.setattr(settings, "paywall_mode", "block")
        assert client.get(f"/api/ical/{token}.ics").status_code == 200

    def test_expired_user_can_join_household(self, client, auth_headers, billing_on, db_session):
        headers1, _ = auth_headers()
        h = create_household(client, headers1)
        token = client.post(f"/api/households/{h['id']}/invitations", headers=headers1).json()["token"]
        headers2, user2 = auth_headers(email="parent2@test.fr", name="Dominique")
        _expire_trial(db_session, user2["id"])
        assert client.post(f"/api/invitations/{token}/accept", headers=headers2).status_code == 200

    def test_account_deletion_not_paywalled(self, client, auth_headers, billing_on, db_session, monkeypatch):
        monkeypatch.setattr(settings, "paywall_mode", "block")
        headers1, user1, _, _, _ = self._family_expired(client, auth_headers, db_session)
        resp = client.request("DELETE", "/api/auth/me", json={"password": "motdepasse1"}, headers=headers1)
        assert resp.status_code == 204

    def test_active_subscriber_has_access(self, client, auth_headers, billing_on, db_session):
        headers1, user1, _, _, h = self._family_expired(client, auth_headers, db_session)
        u = _user(db_session, user1["id"])
        u.subscription_status = "active"
        db_session.commit()
        resp = client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers1)
        assert resp.status_code == 201

    def test_past_due_keeps_access(self, client, auth_headers, billing_on, db_session):
        headers1, user1, _, _, h = self._family_expired(client, auth_headers, db_session)
        u = _user(db_session, user1["id"])
        u.subscription_status = "past_due"
        db_session.commit()
        resp = client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers1)
        assert resp.status_code == 201


class TestCheckout:
    def test_creates_customer_once_and_session(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        resp = client.post("/api/billing/checkout", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"url": "https://checkout.stripe.test/s/1"}
        assert len(fake_stripe["customers"]) == 1
        cust = fake_stripe["customers"][0]
        assert cust["email"] == "parent1@test.fr" and cust["metadata"] == {"user_id": str(user["id"])}
        assert _user(db_session, user["id"]).stripe_customer_id == "cus_1"

        params = fake_stripe["checkout"][0]
        assert params["mode"] == "subscription"
        assert params["customer"] == "cus_1"
        assert params["client_reference_id"] == str(user["id"])
        assert params["line_items"] == [{"price": "price_123", "quantity": 1}]
        assert params["success_url"] == f"{settings.app_url}/billing?success=1"
        assert params["cancel_url"] == f"{settings.app_url}/billing"
        assert params["allow_promotion_codes"] is True and params["locale"] == "fr"
        assert params["subscription_data"]["metadata"] == {"user_id": str(user["id"])}
        assert "automatic_tax" not in params
        assert "L. 221-28" in params["custom_text"]["submit"]["message"]
        # encore ~14 jours d'essai : reportés sur l'abonnement
        trial_end = params["subscription_data"]["trial_end"]
        assert trial_end > (datetime.now(timezone.utc) + timedelta(days=13)).timestamp()

        # second passage : même client Stripe
        client.post("/api/billing/checkout", headers=headers)
        assert len(fake_stripe["customers"]) == 1
        assert fake_stripe["checkout"][1]["customer"] == "cus_1"

    def test_no_trial_end_when_trial_nearly_over(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.trial_ends_at = utcnow() + timedelta(hours=20)  # < 48 h : refusé par Stripe
        db_session.commit()
        client.post("/api/billing/checkout", headers=headers)
        assert "trial_end" not in fake_stripe["checkout"][0]["subscription_data"]

    def test_no_trial_end_when_expired(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        _expire_trial(db_session, user["id"])
        assert client.post("/api/billing/checkout", headers=headers).status_code == 200
        assert "trial_end" not in fake_stripe["checkout"][0]["subscription_data"]

    def test_automatic_tax_opt_in(self, client, auth_headers, billing_on, fake_stripe, monkeypatch):
        monkeypatch.setattr(settings, "stripe_automatic_tax", True)
        headers, _ = auth_headers()
        client.post("/api/billing/checkout", headers=headers)
        assert fake_stripe["checkout"][0]["automatic_tax"] == {"enabled": True}

    def test_409_when_already_active(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.subscription_status = "active"
        db_session.commit()
        assert client.post("/api/billing/checkout", headers=headers).status_code == 409
        assert fake_stripe["checkout"] == []

    def test_stripe_error_502(self, client, auth_headers, billing_on, fake_stripe, monkeypatch):
        def boom(**kw):
            raise stripe.APIConnectionError("réseau")

        monkeypatch.setattr(stripe.checkout.Session, "create", boom)
        headers, _ = auth_headers()
        assert client.post("/api/billing/checkout", headers=headers).status_code == 502


class TestPortal:
    def test_409_without_customer(self, client, auth_headers, billing_on, fake_stripe):
        headers, _ = auth_headers()
        assert client.post("/api/billing/portal", headers=headers).status_code == 409

    def test_portal_session(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.stripe_customer_id = "cus_9"
        db_session.commit()
        resp = client.post("/api/billing/portal", headers=headers)
        assert resp.status_code == 200 and resp.json()["url"] == "https://billing.stripe.test/p/1"
        assert fake_stripe["portal"][0]["customer"] == "cus_9"
        assert fake_stripe["portal"][0]["return_url"] == f"{settings.app_url}/billing"


class TestWebhook:
    def test_bad_signature_400(self, client, billing_on, fake_stripe):
        resp = _webhook(client, {"id": "evt_1", "type": "invoice.payment_failed", "data": {"object": {}}}, sig="nope")
        assert resp.status_code == 400

    def test_503_without_secret(self, client, fake_stripe):
        assert _webhook(client, {"id": "evt_1", "type": "x", "data": {}}).status_code == 503

    def test_checkout_completed_links_user(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        event = {
            "id": "evt_co",
            "type": "checkout.session.completed",
            "data": {"object": {
                "id": "cs_1", "status": "complete", "client_reference_id": str(user["id"]),
                "customer": "cus_42", "subscription": "sub_42", "metadata": {},
            }},
        }
        assert _webhook(client, event).status_code == 200
        u = _user(db_session, user["id"])
        assert (u.stripe_customer_id, u.stripe_subscription_id, u.subscription_status) == ("cus_42", "sub_42", "active")
        assert _status(client, headers)["status"] == "active"

    def test_subscription_lifecycle(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.stripe_customer_id = "cus_7"
        db_session.commit()
        end = int((datetime.now(timezone.utc) + timedelta(days=380)).timestamp())
        assert _webhook(client, _sub_event("evt_a", "customer.subscription.created", u, period_end=end)).status_code == 200
        st = _status(client, headers)
        assert st["status"] == "active" and st["current_period_end"] is not None
        assert st["cancel_at_period_end"] is False

        _webhook(client, _sub_event("evt_b", "customer.subscription.updated", u, cancel=True))
        assert _status(client, headers)["cancel_at_period_end"] is True

        _webhook(client, _sub_event("evt_c", "customer.subscription.updated", u, status="past_due"))
        assert _status(client, headers)["status"] == "past_due"

        _webhook(client, _sub_event("evt_d", "customer.subscription.deleted", u, status="canceled"))
        u = _user(db_session, user["id"])
        u.trial_ends_at = utcnow() - timedelta(days=1)
        db_session.commit()
        st = _status(client, headers)
        assert st["status"] == "canceled" and st["has_access"] is False

    def test_subscription_found_by_metadata(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])  # pas encore de stripe_customer_id
        event = _sub_event("evt_m", "customer.subscription.created", u)
        event["data"]["object"]["customer"] = "cus_meta"
        _webhook(client, event)
        u = _user(db_session, user["id"])
        assert u.stripe_customer_id == "cus_meta" and u.subscription_status == "active"

    def test_old_subscription_deleted_does_not_override(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.stripe_customer_id = "cus_7"
        u.stripe_subscription_id = "sub_new"
        u.subscription_status = "active"
        db_session.commit()
        _webhook(client, _sub_event("evt_old", "customer.subscription.deleted", u, status="canceled", sub_id="sub_old"))
        assert _user(db_session, user["id"]).subscription_status == "active"

    def test_payment_failed_marks_past_due_and_notifies(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.stripe_customer_id = "cus_7"
        u.stripe_subscription_id = "sub_1"
        u.subscription_status = "active"
        db_session.commit()
        event = {"id": "evt_pf", "type": "invoice.payment_failed", "data": {"object": {"customer": "cus_7"}}}
        assert _webhook(client, event).status_code == 200
        assert _status(client, headers)["status"] == "past_due"
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user["id"], Notification.type == "payment_failed")
        ).all()
        assert len(notifs) == 1 and notifs[0].payload == {}

    def test_idempotent(self, client, auth_headers, billing_on, fake_stripe, db_session):
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.stripe_customer_id = "cus_7"
        u.subscription_status = "active"
        db_session.commit()
        event = {"id": "evt_dup", "type": "invoice.payment_failed", "data": {"object": {"customer": "cus_7"}}}
        assert _webhook(client, event).json() == {"received": True}
        assert _webhook(client, event).json() == {"received": True, "duplicate": True}
        notifs = db_session.scalars(select(Notification).where(Notification.type == "payment_failed")).all()
        assert len(notifs) == 1
        assert db_session.get(StripeEvent, "evt_dup") is not None

    def test_unknown_event_acknowledged(self, client, billing_on, fake_stripe):
        resp = _webhook(client, {"id": "evt_u", "type": "customer.created", "data": {"object": {}}})
        assert resp.status_code == 200

    def test_webhook_not_rate_limited(self, client, billing_on, fake_stripe, monkeypatch):
        monkeypatch.setattr(settings, "rate_limit_enabled", True)
        for i in range(40):
            resp = _webhook(client, {"id": f"evt_r{i}", "type": "customer.created", "data": {"object": {}}})
            assert resp.status_code == 200


class TestMigrationGrace:
    def test_existing_users_get_full_trial_from_deploy(self):
        engine = create_engine("sqlite://", poolclass=StaticPool)
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR, password_hash VARCHAR, "
                "display_name VARCHAR, color VARCHAR, ical_token VARCHAR, created_at DATETIME)"
            ))
            conn.execute(text("INSERT INTO users (id, email, created_at) VALUES (1, 'old@test.fr', '2025-01-01 10:00:00')"))
            conn.execute(text("INSERT INTO users (id, email, created_at) VALUES (2, 'recent@test.fr', :c)"),
                         {"c": utcnow() - timedelta(days=2)})
        run_migrations(engine)
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT id, trial_ends_at, cancel_at_period_end FROM users ORDER BY id")).all()
        for _, trial_end, cancel in rows:
            trial_end = datetime.fromisoformat(str(trial_end))
            # max(created_at + 14 j, maintenant + 14 j) = maintenant + 14 j
            assert abs((trial_end - (utcnow() + timedelta(days=14))).total_seconds()) < 60
            assert not cancel
        # idempotent : une seconde exécution ne repousse pas l'essai
        with engine.begin() as conn:
            conn.execute(text("UPDATE users SET trial_ends_at = '2020-01-01 00:00:00' WHERE id = 1"))
        run_migrations(engine)
        with engine.connect() as conn:
            assert str(conn.execute(text("SELECT trial_ends_at FROM users WHERE id = 1")).scalar()).startswith("2020-01-01")


class TestAccountDeletion:
    def test_deleting_account_cancels_subscription(self, client, auth_headers, billing_on, db_session, monkeypatch):
        cancelled = []
        monkeypatch.setattr(stripe.Subscription, "cancel", lambda sid, **kw: cancelled.append(sid))
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.stripe_customer_id, u.stripe_subscription_id, u.subscription_status = "cus_1", "sub_1", "active"
        db_session.commit()
        resp = client.request("DELETE", "/api/auth/me", json={"password": "motdepasse1"}, headers=headers)
        assert resp.status_code == 204
        assert cancelled == ["sub_1"]

    def test_stripe_error_does_not_block_deletion(self, client, auth_headers, billing_on, db_session, monkeypatch):
        def boom(sid, **kw):
            raise stripe.APIConnectionError("réseau")

        monkeypatch.setattr(stripe.Subscription, "cancel", boom)
        headers, user = auth_headers()
        u = _user(db_session, user["id"])
        u.stripe_subscription_id, u.subscription_status = "sub_1", "active"
        db_session.commit()
        resp = client.request("DELETE", "/api/auth/me", json={"password": "motdepasse1"}, headers=headers)
        assert resp.status_code == 204
