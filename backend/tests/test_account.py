"""Compte : révocation de sessions, mot de passe oublié / changé, export RGPD, suppression."""
import re
from datetime import timedelta

import jwt
import pytest
from sqlalchemy import func, select, text

from app.config import settings
from app.models import (
    Child,
    Expense,
    Household,
    HouseholdMember,
    Invitation,
    Notification,
    PasswordResetToken,
    ScheduleException,
    Settlement,
    SpecialDayRule,
    User,
    WallPost,
    WallReply,
    utcnow,
)
from app.services import email as email_service
from tests.test_expenses_api import add_expense
from tests.test_household import create_household
from tests.test_rules import premium_family

PWD = "motdepasse1"


@pytest.fixture
def sent(monkeypatch):
    box: list[dict] = []
    monkeypatch.setattr(
        email_service,
        "send_email",
        lambda to, subject, html: box.append({"to": to, "subject": subject, "html": html}) or True,
    )
    return box


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def login(client, email="parent1@test.fr", password=PWD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def forgot_and_get_token(client, sent, email="parent1@test.fr") -> str:
    resp = client.post("/api/auth/password/forgot", json={"email": email})
    assert resp.status_code == 202
    assert resp.json() == {"ok": True}
    match = re.search(r"/reset-password\?token=([A-Za-z0-9_-]+)", sent[-1]["html"])
    assert match, sent[-1]["html"]
    return match.group(1)


def count(db, model, *where) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*where))


class TestTokenVersion:
    def test_token_carries_tv_and_legacy_token_accepted(self, client, auth_headers):
        headers, user = auth_headers()
        payload = jwt.decode(headers["Authorization"][7:], settings.secret_key, algorithms=["HS256"])
        assert payload["tv"] == 0
        # jeton émis avant l'ajout du claim "tv" → traité comme tv=0
        legacy = jwt.encode(
            {"sub": str(user["id"]), "exp": payload["exp"]}, settings.secret_key, algorithm="HS256"
        )
        assert client.get("/api/auth/me", headers=bearer(legacy)).status_code == 200

    def test_mismatched_tv_rejected(self, client, auth_headers):
        headers, user = auth_headers()
        payload = jwt.decode(headers["Authorization"][7:], settings.secret_key, algorithms=["HS256"])
        forged = jwt.encode({**payload, "tv": 5}, settings.secret_key, algorithm="HS256")
        assert client.get("/api/auth/me", headers=bearer(forged)).status_code == 401

    def test_logout_all_revokes_every_token(self, client, auth_headers):
        headers, _ = auth_headers()
        other_device = bearer(login(client).json()["access_token"])
        resp = client.post("/api/auth/logout-all", headers=headers)
        assert resp.status_code == 204
        assert client.get("/api/auth/me", headers=headers).status_code == 401
        assert client.get("/api/auth/me", headers=other_device).status_code == 401
        # une nouvelle connexion fonctionne
        fresh = bearer(login(client).json()["access_token"])
        assert client.get("/api/auth/me", headers=fresh).status_code == 200

    def test_logout_all_requires_auth(self, client):
        assert client.post("/api/auth/logout-all").status_code == 401


class TestForgotPassword:
    def test_unknown_email_same_response_no_email(self, client, sent):
        resp = client.post("/api/auth/password/forgot", json={"email": "inconnu@test.fr"})
        assert resp.status_code == 202
        assert resp.json() == {"ok": True}
        assert sent == []

    def test_known_email_sends_link_and_stores_only_hash(self, client, auth_headers, sent, db_session):
        auth_headers()
        raw = forgot_and_get_token(client, sent, email="PARENT1@test.fr")
        assert sent[0]["to"] == "parent1@test.fr"
        assert f"{settings.app_url}/reset-password?token={raw}" in sent[0]["html"]
        assert "une heure" in sent[0]["html"]
        row = db_session.scalar(select(PasswordResetToken))
        assert row.token_hash != raw and len(row.token_hash) == 64
        assert raw not in row.token_hash
        assert timedelta(minutes=59) < row.expires_at - utcnow() <= timedelta(hours=1)

    def test_email_in_user_locale(self, client, auth_headers, sent):
        headers, _ = auth_headers()
        client.patch("/api/auth/me", json={"locale": "en"}, headers=headers)
        forgot_and_get_token(client, sent)
        assert sent[0]["subject"] == "Reset your Alternly password"
        assert "one hour" in sent[0]["html"]

    def test_placeholder_gets_no_email(self, client, auth_headers, sent, db_session):
        headers, _ = auth_headers()
        create_household(client, headers)
        ghost = db_session.scalar(select(User).where(User.is_placeholder.is_(True)))
        assert client.post("/api/auth/password/forgot", json={"email": ghost.email}).status_code in (202, 422)
        assert sent == []

    def test_invalid_email_422(self, client):
        assert client.post("/api/auth/password/forgot", json={"email": "pas-un-email"}).status_code == 422


class TestResetPassword:
    def test_full_flow(self, client, auth_headers, sent):
        old_headers, user = auth_headers()
        raw = forgot_and_get_token(client, sent)
        resp = client.post("/api/auth/password/reset", json={"token": raw, "password": "nouveau-mdp-2"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["user"]["id"] == user["id"]
        assert client.get("/api/auth/me", headers=bearer(body["access_token"])).status_code == 200
        # anciennes sessions révoquées
        assert client.get("/api/auth/me", headers=old_headers).status_code == 401
        assert login(client).status_code == 401
        assert login(client, password="nouveau-mdp-2").status_code == 200

    def test_token_single_use(self, client, auth_headers, sent):
        auth_headers()
        raw = forgot_and_get_token(client, sent)
        assert client.post("/api/auth/password/reset", json={"token": raw, "password": "nouveau-mdp-2"}).status_code == 200
        again = client.post("/api/auth/password/reset", json={"token": raw, "password": "nouveau-mdp-3"})
        assert again.status_code == 400
        assert again.json()["detail"] == "Lien invalide ou expiré"

    def test_other_outstanding_tokens_invalidated(self, client, auth_headers, sent):
        auth_headers()
        first = forgot_and_get_token(client, sent)
        second = forgot_and_get_token(client, sent)
        assert client.post("/api/auth/password/reset", json={"token": second, "password": "nouveau-mdp-2"}).status_code == 200
        assert client.post("/api/auth/password/reset", json={"token": first, "password": "nouveau-mdp-3"}).status_code == 400

    def test_expired_token(self, client, auth_headers, sent, db_session):
        auth_headers()
        raw = forgot_and_get_token(client, sent)
        row = db_session.scalar(select(PasswordResetToken))
        row.expires_at = utcnow() - timedelta(seconds=1)
        db_session.commit()
        resp = client.post("/api/auth/password/reset", json={"token": raw, "password": "nouveau-mdp-2"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Lien invalide ou expiré"

    def test_unknown_token(self, client):
        resp = client.post("/api/auth/password/reset", json={"token": "nimportequoi", "password": "nouveau-mdp-2"})
        assert resp.status_code == 400

    def test_password_validation_same_as_register(self, client, auth_headers, sent):
        auth_headers()
        raw = forgot_and_get_token(client, sent)
        assert client.post("/api/auth/password/reset", json={"token": raw, "password": "court"}).status_code == 422
        # 40 « é » = 40 caractères mais 80 octets : refusé (limite bcrypt)
        assert client.post("/api/auth/password/reset", json={"token": raw, "password": "é" * 40}).status_code == 422
        # le jeton n'a pas été consommé par les tentatives invalides
        assert client.post("/api/auth/password/reset", json={"token": raw, "password": "nouveau-mdp-2"}).status_code == 200


class TestChangePassword:
    def test_change_revokes_old_token_and_returns_new(self, client, auth_headers):
        headers, _ = auth_headers()
        resp = client.post(
            "/api/auth/password/change",
            json={"current_password": PWD, "new_password": "nouveau-mdp-2"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        new_headers = bearer(resp.json()["access_token"])
        assert client.get("/api/auth/me", headers=headers).status_code == 401
        assert client.get("/api/auth/me", headers=new_headers).status_code == 200
        assert login(client).status_code == 401
        assert login(client, password="nouveau-mdp-2").status_code == 200

    def test_wrong_current_password(self, client, auth_headers):
        headers, _ = auth_headers()
        resp = client.post(
            "/api/auth/password/change",
            json={"current_password": "mauvais", "new_password": "nouveau-mdp-2"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Mot de passe actuel incorrect"
        assert client.get("/api/auth/me", headers=headers).status_code == 200

    def test_new_password_validated(self, client, auth_headers):
        headers, _ = auth_headers()
        resp = client.post(
            "/api/auth/password/change", json={"current_password": PWD, "new_password": "court"}, headers=headers
        )
        assert resp.status_code == 422


def _populate(client, headers1, user1, headers2, user2, hid):
    """Un peu de tout dans le foyer."""
    child = client.post(f"/api/households/{hid}/children", json={"first_name": "Léa"}, headers=headers1).json()
    client.put(
        f"/api/households/{hid}/custody-rule",
        json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
        headers=headers1,
    )
    client.put(f"/api/households/{hid}/vacation-rule", json={"mode": "split_half"}, headers=headers1)
    exc = client.post(
        f"/api/households/{hid}/exceptions",
        json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user1["id"], "note": "échange"},
        headers=headers1,
    ).json()
    # contre-proposition (auto-référence replaces_id)
    client.post(
        f"/api/households/{hid}/exceptions",
        json={"date_start": "2099-03-05", "date_end": "2099-03-05", "parent_id": user1["id"], "replaces_id": exc["id"]},
        headers=headers1,
    )
    assert add_expense(client, headers1, hid, amount=3000).status_code == 201
    exp = client.post(
        f"/api/households/{hid}/expenses",
        json={"label": "Chaussures", "amount_cents": 4000, "date": "2026-07-10", "category": "vetements", "child_id": child["id"]},
        headers=headers1,
    )
    assert exp.status_code == 201, exp.text
    if user2 is not None:
        assert client.post(
            f"/api/households/{hid}/settlements",
            json={"from_user": user2["id"], "to_user": user1["id"], "amount_cents": 1000, "date": "2026-07-11"},
            headers=headers2,
        ).status_code == 201
    post = client.post(f"/api/households/{hid}/wall", json={"kind": "message", "body": "Bonjour"}, headers=headers1).json()
    client.post(
        f"/api/households/{hid}/wall/{post['id']}/replies", json={"body": "Salut"}, headers=headers2 or headers1
    )
    return child


class TestExport:
    def test_export_content(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        _populate(client, headers1, user1, headers2, user2, h["id"])
        resp = client.get("/api/auth/me/export", headers=headers1)
        assert resp.status_code == 200
        assert resp.headers["content-disposition"] == 'attachment; filename="alternly-export.json"'
        data = resp.json()
        assert data["exported_at"]
        assert data["user"]["email"] == "parent1@test.fr"
        for secret in ("password_hash", "ical_token", "token_version"):
            assert secret not in data["user"]
        assert "motdepasse1" not in resp.text
        hh = data["household"]
        assert hh["name"] == h["name"] and hh["school_zone"] == h["school_zone"]
        assert hh["country"] == "FR" and hh["currency"] == "EUR"
        assert {m["display_name"] for m in hh["members"]} == {"Camille", "Dominique"}
        assert {m["role"] for m in hh["members"]} == {"parent1", "parent2"}
        assert [c["first_name"] for c in hh["children"]] == ["Léa"]
        assert hh["custody_rules"][0]["pattern"] == "alternate_weeks"
        assert "school_vacations" in hh
        assert hh["vacation_rules"][0]["mode"] == "split_half"
        assert len(hh["special_day_rules"]) == 4
        assert len(hh["schedule_exceptions"]) == 2
        assert len(hh["expenses"]) == 2
        assert hh["settlements"][0]["amount_cents"] == 1000
        assert hh["wall_posts"][0]["body"] == "Bonjour"
        assert hh["wall_posts"][0]["replies"][0]["body"] == "Salut"
        # parent1 a reçu des notifications (réponse au mur, remboursement…)
        assert data["notifications"]
        # notifications de l'autre parent absentes
        other = client.get("/api/auth/me/export", headers=headers2).json()
        mine_ids = {n["id"] for n in data["notifications"]}
        assert mine_ids.isdisjoint({n["id"] for n in other["notifications"]})

    def test_export_without_household(self, client, auth_headers):
        headers, _ = auth_headers()
        data = client.get("/api/auth/me/export", headers=headers).json()
        assert data["household"] is None
        assert data["notifications"] == []

    def test_export_requires_auth(self, client):
        assert client.get("/api/auth/me/export").status_code == 401


@pytest.fixture
def fk_on(db_session):
    """Clés étrangères vérifiées (comme Postgres) : valide l'ordre des suppressions."""
    db_session.commit()
    db_session.execute(text("PRAGMA foreign_keys=ON"))
    assert db_session.execute(text("PRAGMA foreign_keys")).scalar() == 1
    yield


class TestDeleteAccountExtended:
    def test_sole_member_cleans_reset_tokens(self, client, auth_headers, db_session, sent, fk_on):
        headers, user = auth_headers()
        h = create_household(client, headers)
        forgot_and_get_token(client, sent)
        assert client.delete("/api/auth/me", headers=headers).status_code == 204
        db_session.expire_all()
        assert db_session.get(Household, h["id"]) is None
        assert count(db_session, PasswordResetToken) == 0

    def test_with_coparent_revokes_and_notifies(self, client, auth_headers, db_session, sent, fk_on):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        _populate(client, headers1, user1, headers2, user2, h["id"])
        forgot_and_get_token(client, sent)
        old_ical = db_session.get(User, user1["id"]).ical_token
        assert client.delete("/api/auth/me", headers=headers1).status_code == 204
        db_session.expire_all()
        u = db_session.get(User, user1["id"])
        assert u.is_placeholder and u.token_version == 1 and u.ical_token != old_ical
        assert count(db_session, PasswordResetToken, PasswordResetToken.user_id == u.id) == 0
        assert client.get("/api/auth/me", headers=headers1).status_code == 401
        assert login(client).status_code == 401
        assert client.get(f"/api/ical/{old_ical}.ics").status_code == 404
        notif = db_session.scalar(
            select(Notification).where(Notification.user_id == user2["id"], Notification.type == "parent_left")
        )
        assert notif.payload == {"display_name": "Camille"}
        # l'historique partagé reste lisible par le coparent
        assert client.get(f"/api/households/{h['id']}/expenses", headers=headers2).json()
        assert client.get(f"/api/households/{h['id']}/balance", headers=headers2).status_code == 200
