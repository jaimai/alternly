"""Durcissement : bornes d'entrée, iCal 503, cache négatif, en-têtes, migrations."""
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import httpx
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base
from app.migrations import run_migrations
from app.models import Expense, WallPost
from app.services import public_holidays, school_holidays
from tests.test_household import create_household
from tests.test_rules import setup_family

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _down(request):
    raise httpx.ConnectError("down")


class TestSecretKeyGuard:
    def _import_config(self, secret: str):
        env = {**os.environ, "DATABASE_URL": "postgresql://u:p@localhost/db", "SECRET_KEY": secret}
        return subprocess.run(
            [sys.executable, "-c", "import app.config"], cwd=BACKEND_DIR, env=env, capture_output=True
        )

    def test_weak_or_short_key_refused_outside_sqlite(self):
        for secret in ("change-me-in-production", "", "trop-courte"):
            assert self._import_config(secret).returncode != 0, secret

    def test_strong_key_accepted(self):
        assert self._import_config("x" * 48).returncode == 0


class TestInputBounds:
    def test_password_over_72_bytes_rejected_at_register(self, client):
        resp = client.post(
            "/api/auth/register",
            # 40 caractères mais 80 octets
            json={"email": "a@test.fr", "password": "é" * 40, "display_name": "A"},
        )
        assert resp.status_code == 422
        assert "72 octets" in resp.text

    def test_long_password_at_login_is_401_not_500(self, client, auth_headers):
        auth_headers()
        resp = client.post("/api/auth/login", json={"email": "parent1@test.fr", "password": "x" * 150})
        assert resp.status_code == 401
        resp = client.post("/api/auth/login", json={"email": "parent1@test.fr", "password": "x" * 201})
        assert resp.status_code == 422

    def test_amount_and_text_bounds(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        base = {"label": "Cantine", "date": "2026-07-10", "category": "cantine"}
        url = f"/api/households/{h['id']}/expenses"
        assert client.post(url, json={**base, "amount_cents": 10_000_001}, headers=headers1).status_code == 422
        assert client.post(url, json={**base, "amount_cents": 10_000_000}, headers=headers1).status_code == 201
        long_name = client.patch(f"/api/households/{h['id']}", json={"name": "x" * 81}, headers=headers1)
        assert long_name.status_code == 422
        child = client.post(f"/api/households/{h['id']}/children", json={"first_name": "x" * 51}, headers=headers1)
        assert child.status_code == 422

    def test_handover_time_format(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        body = {"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]}
        url = f"/api/households/{h['id']}/custody-rule"
        assert client.put(url, json={**body, "handover_time": "25:00"}, headers=headers1).status_code == 422
        assert client.put(url, json={**body, "handover_time": "08:30"}, headers=headers1).status_code == 200


class TestDeleteChild:
    def test_referenced_child_detached_not_500(self, client, auth_headers, db_session):
        # Clés étrangères appliquées comme en Postgres.
        db_session.execute(text("PRAGMA foreign_keys=ON"))
        headers1, _, _, _, h = setup_family(client, auth_headers)
        child_id = client.post(
            f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers1
        ).json()["id"]
        exp = client.post(
            f"/api/households/{h['id']}/expenses",
            json={"label": "Judo", "amount_cents": 5000, "date": "2026-07-10", "category": "activites",
                  "child_id": child_id},
            headers=headers1,
        )
        assert exp.status_code == 201, exp.text
        post = client.post(
            f"/api/households/{h['id']}/wall",
            json={"kind": "message", "body": "Doudou oublié", "child_id": child_id},
            headers=headers1,
        )
        assert post.status_code == 201, post.text

        resp = client.delete(f"/api/households/{h['id']}/children/{child_id}", headers=headers1)
        assert resp.status_code == 204
        assert db_session.get(Expense, exp.json()["id"]).child_id is None
        assert db_session.get(WallPost, post.json()["id"]).child_id is None


class TestIcalAvailability:
    def _feed_token(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        return client.post("/api/ical/regenerate", headers=headers1).json()["ical_token"]

    def test_ok_is_cacheable(self, client, auth_headers):
        resp = client.get(f"/api/ical/{self._feed_token(client, auth_headers)}.ics")
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "private, max-age=3600"

    def test_503_when_school_holidays_unavailable(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(public_holidays, "_transport", httpx.MockTransport(_down))
        resp = client.get(f"/api/ical/{self._feed_token(client, auth_headers)}.ics")
        assert resp.status_code == 503
        assert resp.headers["retry-after"] == "3600"


class TestNegativeCache:
    def test_empty_year_not_refetched(self, db_session):
        calls = []

        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, json={"results": []})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        assert school_holidays.get(db_session, "A", ["2030-2031"], client=client) == []
        assert school_holidays.get(db_session, "A", ["2030-2031"], client=client) == []
        assert len(calls) == 1

    def test_failure_memoized(self, db_session):
        calls = []

        def handler(request):
            calls.append(request.url)
            raise httpx.ConnectError("down")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        for _ in range(2):
            try:
                public_holidays.get(db_session, 2031, client=client)
            except public_holidays.PublicDataUnavailable:
                pass
            else:
                raise AssertionError("PublicDataUnavailable attendue")
        assert len(calls) == 1

    def test_fake_api_serves_realistic_periods(self, db_session):
        periods = school_holidays.get(db_session, "B", ["2025-2026"])
        hiver = next(p for p in periods if p.label == "Vacances d'Hiver")
        assert hiver.start == date(2026, 2, 14) and hiver.end == date(2026, 3, 1)
        assert public_holidays.get(db_session, 2026)[date(2026, 7, 14)] == "14 juillet"


class TestHttpHardening:
    def test_security_headers_and_health(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["x-frame-options"] == "DENY"
        assert resp.headers["referrer-policy"] == "strict-origin-when-cross-origin"

    def test_docs_available_in_dev(self, client):
        assert client.get("/openapi.json").status_code == 200

    def test_cron_wrong_key(self, client, monkeypatch):
        monkeypatch.setattr(settings, "cron_secret", "bon-secret")
        assert client.post("/api/cron/exchange-reminders", headers={"X-Cron-Key": "mauvais"}).status_code == 401
        assert client.post("/api/cron/exchange-reminders").status_code == 401


class TestLinks:
    def test_invite_url_points_to_spa(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_household(client, headers)
        inv = client.post(f"/api/households/{h['id']}/invitations", headers=headers).json()
        assert inv["invite_url"] == f"{settings.app_url.rstrip('/')}/join/{inv['token']}"

    def test_site_url_used_for_canonical_urls(self, client, monkeypatch):
        monkeypatch.setattr(settings, "site_url", "https://alternly.example")
        assert "<loc>https://alternly.example/blog</loc>" in client.get("/sitemap.xml").text
        assert "Sitemap: https://alternly.example/sitemap.xml" in client.get("/robots.txt").text
        llms = client.get("/llms.txt").text
        assert f"{settings.app_url.rstrip('/')}/register" in llms and "/app/register" not in llms
        page = client.get("/blog").text
        assert '<link rel="canonical" href="https://alternly.example/blog" />' in page
        assert "iOS" not in page


class TestMigrations:
    def test_indexes_added_to_existing_tables(self):
        engine = create_engine("sqlite://", poolclass=StaticPool)
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX ix_expenses_household_id"))
        run_migrations(engine)
        run_migrations(engine)  # idempotent
        names = {i["name"] for i in inspect(engine).get_indexes("expenses")}
        assert "ix_expenses_household_id" in names
        with sessionmaker(bind=engine)() as s:
            assert s.scalars(select(Expense)).all() == []
