"""Limitation de débit : fenêtre glissante, 429 + Retry-After, clés IP / e-mail / foyer."""
import pytest

from app import ratelimit
from app.config import settings
from app.ratelimit import TOO_MANY, SlidingWindowLimiter
from tests.test_rules import premium_family, setup_family


@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class TestSlidingWindow:
    def test_window_slides(self):
        clock = FakeClock()
        lim = SlidingWindowLimiter(clock=clock)
        assert lim.hit("k", 2, 60) == 0
        clock.now += 10
        assert lim.hit("k", 2, 60) == 0
        assert lim.hit("k", 2, 60) == 50  # le premier hit sort dans 50 s
        clock.now += 50
        assert lim.hit("k", 2, 60) == 0
        assert lim.hit("autre", 2, 60) == 0  # clés indépendantes

    def test_prune_drops_stale_keys(self):
        clock = FakeClock()
        lim = SlidingWindowLimiter(clock=clock)
        lim.hit("vieux", 5, 60)
        clock.now += 61
        lim._prune(clock.now)
        assert "vieux" not in lim._hits


def _login(client, email="x@test.fr"):
    return client.post("/api/auth/login", json={"email": email, "password": "mauvais-mdp"})


class TestEndpoints:
    def test_disabled_by_default_in_tests(self, client):
        for _ in range(15):
            assert _login(client).status_code == 401

    def test_login_per_ip(self, client, limits_on):
        for i in range(10):
            assert _login(client, email=f"u{i}@test.fr").status_code == 401
        resp = _login(client, email="u99@test.fr")
        assert resp.status_code == 429
        assert resp.json()["detail"] == TOO_MANY
        assert 1 <= int(resp.headers["Retry-After"]) <= 60

    def test_login_per_email(self, client, limits_on, monkeypatch):
        # IP différente à chaque requête : seul le compteur par e-mail s'applique
        ips = iter(f"10.0.0.{i}" for i in range(100))
        monkeypatch.setattr(ratelimit, "_client_ip", lambda request: next(ips))
        for _ in range(20):
            assert _login(client, email="Cible@test.fr").status_code == 401
        assert _login(client, email="cible@test.fr").status_code == 429  # insensible à la casse
        assert _login(client, email="autre@test.fr").status_code == 401

    def test_forgot_per_email_then_ip(self, client, limits_on):
        for _ in range(3):
            assert client.post("/api/auth/password/forgot", json={"email": "a@test.fr"}).status_code == 202
        assert client.post("/api/auth/password/forgot", json={"email": "a@test.fr"}).status_code == 429
        # 4e requête (bloquée) comptée pour l'IP : 1 de plus → 5
        assert client.post("/api/auth/password/forgot", json={"email": "b@test.fr"}).status_code == 202
        assert client.post("/api/auth/password/forgot", json={"email": "c@test.fr"}).status_code == 429

    def test_register_per_ip(self, client, limits_on):
        for i in range(10):
            resp = client.post(
                "/api/auth/register",
                json={"email": f"p{i}@test.fr", "password": "motdepasse1", "display_name": "P"},
            )
            assert resp.status_code == 201
        resp = client.post(
            "/api/auth/register", json={"email": "p10@test.fr", "password": "motdepasse1", "display_name": "P"}
        )
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers

    def test_reset_per_ip(self, client, limits_on):
        for _ in range(10):
            assert client.post("/api/auth/password/reset", json={"token": "x", "password": "motdepasse2"}).status_code == 400
        assert client.post("/api/auth/password/reset", json={"token": "x", "password": "motdepasse2"}).status_code == 429

    def test_invitation_preview_per_ip(self, client, limits_on):
        for _ in range(30):
            assert client.get("/api/invitations/inexistant").status_code == 404
        assert client.get("/api/invitations/inexistant").status_code == 429

    def test_wall_per_household_not_shared_across_households(self, client, auth_headers, db_session, limits_on):
        from app.models import User

        headers1, _, _, _, h = premium_family(client, auth_headers, db_session)
        # quota rempli directement (100 posts réels seraient lents)
        for _ in range(100):
            ratelimit.limiter.hit(f"wall:hh:{h['id']}", 100, ratelimit.DAY)
        resp = client.post(f"/api/households/{h['id']}/wall", json={"kind": "message", "body": "x"}, headers=headers1)
        assert resp.status_code == 429
        # un autre foyer n'est pas affecté
        other_headers, other_user = auth_headers(email="autre@test.fr", name="Autre")
        db_session.get(User, other_user["id"]).subscription_status = "active"
        db_session.commit()
        other = client.post("/api/households", json={"name": "Autre", "school_zone": "A"}, headers=other_headers).json()
        ok = client.post(f"/api/households/{other['id']}/wall", json={"kind": "message", "body": "x"}, headers=other_headers)
        assert ok.status_code == 201

    def test_household_limit_checked_after_membership(self, client, auth_headers, limits_on):
        _, _, _, _, h = setup_family(client, auth_headers)
        intruder, _ = auth_headers(email="intrus@test.fr", name="Intrus")
        for _ in range(40):
            resp = client.post(
                f"/api/households/{h['id']}/exceptions",
                json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": 1},
                headers=intruder,
            )
            assert resp.status_code == 404  # jamais 429 : l'intrus ne consomme pas le quota

    def test_exceptions_per_household(self, client, auth_headers, limits_on):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        for i in range(30):
            resp = client.post(
                f"/api/households/{h['id']}/exceptions",
                json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user1["id"]},
                headers=headers1,
            )
            assert resp.status_code == 201, (i, resp.text)
        resp = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user1["id"]},
            headers=headers1,
        )
        assert resp.status_code == 429

    def test_expenses_per_household(self, client, auth_headers, db_session, limits_on):
        headers1, _, _, _, h = premium_family(client, auth_headers, db_session)
        for _ in range(100):
            ratelimit.limiter.hit(f"expenses:hh:{h['id']}", 100, ratelimit.DAY)
        resp = client.post(
            f"/api/households/{h['id']}/expenses",
            json={"label": "x", "amount_cents": 100, "date": "2026-07-10", "category": "autre"},
            headers=headers1,
        )
        assert resp.status_code == 429

    def test_billing_calls_per_ip(self, client, auth_headers, limits_on):
        headers, _ = auth_headers()
        for _ in range(10):
            assert client.post("/api/billing/cancel", headers=headers).status_code == 404
        assert client.post("/api/billing/cancel", headers=headers).status_code == 429

    def test_paddle_webhook_never_limited(self, client, limits_on):
        for _ in range(40):
            assert client.post("/api/billing/webhook", content=b"{}").status_code == 403

    def test_password_change_per_ip(self, client, auth_headers, limits_on):
        headers, _ = auth_headers()
        body = {"current_password": "mauvais", "new_password": "nouveau-mdp-2"}
        for _ in range(10):
            assert client.post("/api/auth/password/change", json=body, headers=headers).status_code == 400
        assert client.post("/api/auth/password/change", json=body, headers=headers).status_code == 429
