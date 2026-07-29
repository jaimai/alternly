"""Gestion d'abonnement : voir l'offre, changer d'offre, se désabonner.

Les appels réseau à Paddle sont mockés (on teste la logique des endpoints)."""
import pytest

from app.config import settings
from app.models import User
from app.services import paddle_api


@pytest.fixture
def subscriber(client, auth_headers, db_session):
    headers, user = auth_headers()
    u = db_session.get(User, user["id"])
    u.paddle_subscription_id = "sub_123"
    u.subscription_status = "active"
    db_session.commit()
    return headers, user


@pytest.fixture(autouse=True)
def _prices(monkeypatch):
    monkeypatch.setattr(settings, "paddle_price_annual", "pri_annual", raising=False)
    monkeypatch.setattr(settings, "paddle_price_monthly", "pri_monthly", raising=False)


class TestViewSubscription:
    def test_no_subscription_is_not_manageable(self, client, auth_headers):
        headers, _ = auth_headers()
        assert client.get("/api/billing/subscription", headers=headers).json() == {"manageable": False}

    def test_returns_current_plan(self, client, subscriber, monkeypatch):
        headers, _ = subscriber
        monkeypatch.setattr(paddle_api, "get_subscription", lambda sid: {
            "status": "active",
            "next_billed_at": "2027-07-28T00:00:00Z",
            "items": [{"price": {"id": "pri_annual"}}],
        })
        body = client.get("/api/billing/subscription", headers=headers).json()
        assert body["manageable"] is True
        assert body["plan"] == "annual"
        assert body["next_billed_at"].startswith("2027")

    def test_falls_back_when_paddle_unavailable(self, client, subscriber, monkeypatch):
        headers, _ = subscriber
        def boom(sid):
            raise paddle_api.PaddleUnavailable("down")
        monkeypatch.setattr(paddle_api, "get_subscription", boom)
        body = client.get("/api/billing/subscription", headers=headers).json()
        assert body["manageable"] is True and body["plan"] is None


class TestCancel:
    def test_cancel_calls_paddle(self, client, subscriber, monkeypatch):
        headers, _ = subscriber
        calls = []
        monkeypatch.setattr(paddle_api, "cancel_subscription", lambda sid: calls.append(sid) or {})
        assert client.post("/api/billing/cancel", headers=headers).status_code == 200
        assert calls == ["sub_123"]

    def test_cancel_without_subscription_404(self, client, auth_headers):
        headers, _ = auth_headers()
        assert client.post("/api/billing/cancel", headers=headers).status_code == 404


class TestChangePlan:
    def test_change_to_monthly_uses_configured_price(self, client, subscriber, monkeypatch):
        headers, _ = subscriber
        calls = []
        monkeypatch.setattr(paddle_api, "change_price", lambda sid, pid: calls.append((sid, pid)) or {})
        resp = client.post("/api/billing/change-plan", json={"plan": "monthly"}, headers=headers)
        assert resp.status_code == 200
        assert calls == [("sub_123", "pri_monthly")]

    def test_unknown_plan_rejected(self, client, subscriber):
        headers, _ = subscriber
        assert client.post("/api/billing/change-plan", json={"plan": "weekly"}, headers=headers).status_code == 422

    def test_change_without_subscription_404(self, client, auth_headers):
        headers, _ = auth_headers()
        assert client.post("/api/billing/change-plan", json={"plan": "annual"}, headers=headers).status_code == 404
