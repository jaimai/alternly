"""Boucle d'invitation du coparent : e-mail d'invitation, aperçu public du
planning, relances (inviteur J+2/J+5, invité J+3), nudge d'onboarding, expiration."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Household, Invitation, Notification, User, utcnow
from app.services import analytics
from app.services import email as email_service
from app.services import invite_reminders
from tests.test_household import create_household


@pytest.fixture
def sent(monkeypatch):
    box: list[dict] = []
    monkeypatch.setattr(
        email_service,
        "send_email",
        lambda to, subject, html: box.append({"to": to, "subject": subject, "html": html}) or True,
    )
    return box


@pytest.fixture
def events(monkeypatch):
    box: list[tuple] = []
    monkeypatch.setattr(analytics.settings, "posthog_token", "phc_test")
    monkeypatch.setattr(analytics, "_send", lambda did, ev, props, groups: box.append((did, ev, props)))
    return box


def solo_household(client, auth_headers, with_rule=True, children=("Léo", "Lina")):
    headers, user = auth_headers(name="Camille Martin")
    h = create_household(client, headers)
    for name in children:
        client.post(f"/api/households/{h['id']}/children", json={"first_name": name}, headers=headers)
    if with_rule:
        r = client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user["id"]},
            headers=headers,
        )
        assert r.status_code == 200, r.text
    return headers, user, h


def invite(client, headers, h):
    r = client.post(f"/api/households/{h['id']}/invitations", headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def age_invitation(db, token, days):
    inv = db.scalar(select(Invitation).where(Invitation.token == token))
    inv.created_at = utcnow() - timedelta(days=days, minutes=5)
    db.commit()
    return inv


class TestInvitationEmail:
    def test_sends_email_and_stores_invitee(self, client, auth_headers, db_session, sent, events):
        headers, _, h = solo_household(client, auth_headers)
        r = client.post(
            f"/api/households/{h['id']}/invitations/email",
            json={"email": "Dominique@Example.org", "locale": "en"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email_sent"] is True and body["invitee_email"] == "dominique@example.org"
        assert len(sent) == 1
        mail = sent[0]
        assert mail["to"] == "dominique@example.org"
        assert "Camille invited you" in mail["subject"]
        assert f"/join/{body['token']}?lang=en" in mail["html"]
        assert "Léo and Lina" in mail["html"]
        assert any(e[1] == "invite_email_sent" for e in events)
        # Réutilise l'invitation active (pas une nouvelle à chaque envoi).
        again = client.post(
            f"/api/households/{h['id']}/invitations/email", json={"email": "x@example.org"}, headers=headers
        )
        assert again.json()["token"] == body["token"]
        assert "vous invite" in sent[1]["subject"]  # langue de l'expéditeur par défaut (fr)

    def test_same_response_whether_account_exists(self, client, auth_headers, sent):
        headers, _, h = solo_household(client, auth_headers)
        auth_headers(email="existe@test.fr", name="Existe")
        a = client.post(f"/api/households/{h['id']}/invitations/email", json={"email": "existe@test.fr"}, headers=headers)
        b = client.post(f"/api/households/{h['id']}/invitations/email", json={"email": "inconnu@test.fr"}, headers=headers)
        assert a.status_code == b.status_code == 200
        assert set(a.json()) == set(b.json())
        assert len(sent) == 2

    def test_rejects_own_address(self, client, auth_headers, sent):
        headers, user, h = solo_household(client, auth_headers)
        r = client.post(f"/api/households/{h['id']}/invitations/email", json={"email": user["email"]}, headers=headers)
        assert r.status_code == 422
        assert sent == []

    def test_escapes_inviter_name(self, sent):
        _, html = email_service.invitation_email("<b>Evil</b>", ["<i>x</i>"], "tok", "fr")
        assert "<b>Evil</b>" not in html and "&lt;b&gt;Evil&lt;/b&gt;" in html
        assert "<i>x</i>" not in html

    def test_rate_limited_per_household(self, client, auth_headers, sent, monkeypatch):
        monkeypatch.setattr(settings, "rate_limit_enabled", True)
        headers, _, h = solo_household(client, auth_headers)
        codes = [
            client.post(
                f"/api/households/{h['id']}/invitations/email", json={"email": f"p{i}@test.fr"}, headers=headers
            ).status_code
            for i in range(6)
        ]
        assert codes == [200] * 5 + [429]
        assert len(sent) == 5

    def test_stranger_cannot_send(self, client, auth_headers, sent):
        _, _, h = solo_household(client, auth_headers)
        intruder, _ = auth_headers(email="intrus@test.fr", name="Intrus")
        r = client.post(f"/api/households/{h['id']}/invitations/email", json={"email": "a@b.fr"}, headers=intruder)
        assert r.status_code == 404
        assert sent == []


class TestCurrentInvitation:
    def test_current_and_expired(self, client, auth_headers, db_session):
        headers, _, h = solo_household(client, auth_headers)
        url = f"/api/households/{h['id']}/invitations/current"
        assert client.get(url, headers=headers).json() == {"invitation": None, "last_expired": False}
        token = invite(client, headers, h)["token"]
        cur = client.get(url, headers=headers).json()
        assert cur["invitation"]["token"] == token and cur["last_expired"] is False
        inv = db_session.scalar(select(Invitation).where(Invitation.token == token))
        inv.expires_at = utcnow() - timedelta(hours=1)
        db_session.commit()
        assert client.get(url, headers=headers).json() == {"invitation": None, "last_expired": True}
        # Régénération en un clic.
        assert invite(client, headers, h)["token"] != token

    def test_expired_landing_names_inviter(self, client, auth_headers, db_session):
        headers, _, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        inv = db_session.scalar(select(Invitation).where(Invitation.token == token))
        inv.expires_at = utcnow() - timedelta(hours=1)
        db_session.commit()
        r = client.get(f"/api/invitations/{token}")
        assert r.status_code == 410
        assert r.json()["detail"]["code"] == "expired"
        assert r.json()["detail"]["inviter_first_name"] == "Camille"
        assert client.get(f"/api/invitations/{token}/preview-schedule").status_code == 410


class TestPreviewSchedule:
    def test_shows_invitee_days_from_placeholder(self, client, auth_headers, db_session, events):
        headers, user, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        r = client.get(f"/api/invitations/{token}/preview-schedule")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["inviter_first_name"] == "Camille"
        assert data["children"] == ["Léo", "Lina"]
        assert data["has_schedule"] is True
        assert len(data["days"]) == 28
        whos = {d["who"] for d in data["days"]}
        assert whos == {"you", "inviter"}  # garde alternée : les deux sur 4 semaines
        assert data["your_periods"]
        # Cohérent avec le calendrier réel : les jours « you » sont ceux du placeholder.
        ghost = next(m for m in h["members"] if m["is_placeholder"])
        cal = client.get(
            f"/api/households/{h['id']}/calendar",
            params={"start": data["days"][0]["date"], "end": data["days"][-1]["date"]},
            headers=headers,
        ).json()
        by_date = {d["date"]: d["parent_id"] for d in cal["days"]}
        for d in data["days"]:
            assert (by_date[d["date"]] == ghost["id"]) == (d["who"] == "you")
        # Événement anonyme (distinct_id aléatoire, sans profil).
        ev = [e for e in events if e[1] == "invite_preview_viewed"]
        assert ev and ev[0][2]["$process_person_profile"] is False

    def test_no_pii_leak(self, client, auth_headers, db_session):
        headers, user, h = solo_household(client, auth_headers)
        client.post(
            f"/api/households/{h['id']}/expenses",
            json={"label": "Dentiste secret", "amount_cents": 4200, "category": "sante"},
            headers=headers,
        )
        client.post(f"/api/households/{h['id']}/wall", json={"kind": "message", "body": "Message privé"}, headers=headers)
        token = invite(client, headers, h)["token"]
        client.post(f"/api/households/{h['id']}/invitations/email", json={"email": "invite@test.fr"}, headers=headers)
        raw = client.get(f"/api/invitations/{token}/preview-schedule").text
        for secret in (user["email"], "invite@test.fr", "Dentiste", "Message privé", "Martin", "Foyer Léo", "@"):
            assert secret not in raw
        assert set(client.get(f"/api/invitations/{token}/preview-schedule").json()) == {
            "inviter_first_name", "children", "has_schedule", "handover_time", "days", "your_periods",
        }

    def test_without_rule(self, client, auth_headers):
        headers, _, h = solo_household(client, auth_headers, with_rule=False)
        token = invite(client, headers, h)["token"]
        data = client.get(f"/api/invitations/{token}/preview-schedule").json()
        assert data["has_schedule"] is False and data["days"] == []

    def test_unknown_token_404(self, client):
        assert client.get("/api/invitations/nope/preview-schedule").status_code == 404

    def test_rate_limited(self, client, auth_headers, monkeypatch):
        headers, _, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        monkeypatch.setattr(settings, "rate_limit_enabled", True)
        codes = [client.get(f"/api/invitations/{token}/preview-schedule").status_code for _ in range(31)]
        assert codes[-1] == 429 and codes[0] == 200


def run_cron(client, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "s3cr3t")
    r = client.post("/api/cron/invite-reminders", headers={"X-Cron-Key": "s3cr3t"})
    assert r.status_code == 200, r.text
    return r.json()


class TestReminders:
    def test_requires_cron_key(self, client, monkeypatch):
        monkeypatch.setattr(settings, "cron_secret", "s3cr3t")
        assert client.post("/api/cron/invite-reminders", headers={"X-Cron-Key": "x"}).status_code == 401

    def test_inviter_day2_then_day5_idempotent(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, user, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        age_invitation(db_session, token, 1)
        assert run_cron(client, monkeypatch)["inviter_emails"] == 0
        age_invitation(db_session, token, 2)
        assert run_cron(client, monkeypatch)["inviter_emails"] == 1
        assert run_cron(client, monkeypatch)["inviter_emails"] == 0  # idempotent
        assert sent[0]["to"] == user["email"] and "/settings#invite" in sent[0]["html"]
        age_invitation(db_session, token, 5)
        assert run_cron(client, monkeypatch)["inviter_emails"] == 1
        assert run_cron(client, monkeypatch)["inviter_emails"] == 0
        assert len(sent) == 2 and "Toujours pas" in sent[1]["html"]
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user["id"], Notification.type == "invite_reminder")
        ).all()
        assert sorted(n.payload["day"] for n in notifs) == [2, 5]

    def test_late_first_run_sends_only_day5(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, _, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        age_invitation(db_session, token, 6)
        run_cron(client, monkeypatch)
        run_cron(client, monkeypatch)
        assert len(sent) == 1

    def test_inviter_opt_out_gets_notification_only(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, user, h = solo_household(client, auth_headers)
        db_session.get(User, user["id"]).email_opt_in = False
        db_session.commit()
        token = invite(client, headers, h)["token"]
        age_invitation(db_session, token, 2)
        stats = run_cron(client, monkeypatch)
        assert stats["inviter_emails"] == 0 and stats["inviter_notifications"] == 1
        assert sent == []

    def test_invitee_day3_once(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, user, h = solo_household(client, auth_headers)
        client.post(f"/api/households/{h['id']}/invitations/email", json={"email": "dom@test.fr"}, headers=headers)
        sent.clear()
        token = db_session.scalar(select(Invitation)).token
        age_invitation(db_session, token, 2)
        run_cron(client, monkeypatch)
        assert [m["to"] for m in sent] == [user["email"]]  # J+2 : inviteur seulement
        sent.clear()
        age_invitation(db_session, token, 3)
        assert run_cron(client, monkeypatch)["invitee_emails"] == 1
        assert [m["to"] for m in sent] == ["dom@test.fr"]
        assert "rappel" in sent[0]["subject"].lower()
        sent.clear()
        age_invitation(db_session, token, 5)
        run_cron(client, monkeypatch)
        assert [m["to"] for m in sent] == [user["email"]]  # J+5 : pas de 2e rappel invité

    def test_no_reminder_when_joined_or_expired_or_superseded(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, _, h = solo_household(client, auth_headers)
        old = invite(client, headers, h)["token"]
        new = invite(client, headers, h)["token"]
        age_invitation(db_session, old, 3)
        age_invitation(db_session, new, 1)
        run_cron(client, monkeypatch)
        assert sent == []  # seule la dernière invitation compte
        inv = age_invitation(db_session, new, 3)
        inv.expires_at = utcnow() - timedelta(minutes=1)
        db_session.commit()
        run_cron(client, monkeypatch)
        assert sent == []
        token = invite(client, headers, h)["token"]
        headers2, _ = auth_headers(email="p2@test.fr", name="Dominique")
        assert client.post(f"/api/invitations/{token}/accept", headers=headers2).status_code == 200
        age_invitation(db_session, token, 3)
        run_cron(client, monkeypatch)
        assert sent == []


class TestOnboardingNudge:
    def _age_household(self, db, hid, hours):
        db.get(Household, hid).created_at = utcnow() - timedelta(hours=hours)
        db.commit()

    def test_sent_once_after_24h(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, user, h = solo_household(client, auth_headers)
        self._age_household(db_session, h["id"], 12)
        assert run_cron(client, monkeypatch)["nudges"] == 0
        self._age_household(db_session, h["id"], 25)
        assert run_cron(client, monkeypatch)["nudges"] == 1
        assert run_cron(client, monkeypatch)["nudges"] == 0
        assert [m["to"] for m in sent] == [user["email"]]
        assert "/settings#invite" in sent[0]["html"]

    def test_not_sent_if_invited_or_no_rule(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, _, h = solo_household(client, auth_headers)
        invite(client, headers, h)
        self._age_household(db_session, h["id"], 25)
        headers2, _, h2 = solo_household(
            client, lambda **kw: auth_headers(email="autre@test.fr", **kw), with_rule=False
        )
        self._age_household(db_session, h2["id"], 25)
        assert run_cron(client, monkeypatch)["nudges"] == 0
        assert sent == []

    def test_respects_opt_out(self, client, auth_headers, db_session, sent, monkeypatch):
        headers, user, h = solo_household(client, auth_headers)
        db_session.get(User, user["id"]).email_opt_in = False
        db_session.commit()
        self._age_household(db_session, h["id"], 25)
        run_cron(client, monkeypatch)
        assert sent == []
        assert db_session.get(User, user["id"]).invite_nudge_sent_at is not None
        db_session.get(User, user["id"]).email_opt_in = True
        db_session.commit()
        run_cron(client, monkeypatch)
        assert sent == []  # marqué : jamais envoyé après coup


def test_reminders_service_direct(db_session):
    assert invite_reminders.run(db_session) == {
        "inviter_emails": 0, "inviter_notifications": 0, "invitee_emails": 0, "nudges": 0,
    }
