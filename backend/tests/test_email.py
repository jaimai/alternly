"""Notifications e-mail : envoi actionnable, opt-in, endpoint cron de rappel."""
from datetime import date, timedelta

import httpx
import pytest

from app.services import email as email_service
from tests.test_rules import premium_family


@pytest.fixture
def sent(monkeypatch):
    """Capture les e-mails « envoyés » sans réseau."""
    box: list[dict] = []
    monkeypatch.setattr(
        email_service,
        "send_email",
        lambda to, subject, html: box.append({"to": to, "subject": subject, "html": html}) or True,
    )
    return box


def iso(d: date) -> str:
    return d.isoformat()


class TestSendEmail:
    def test_noop_without_api_key(self, monkeypatch):
        monkeypatch.setattr(email_service.settings, "resend_api_key", "")
        assert email_service.send_email("x@test.fr", "Sujet", "<p>hi</p>") is False

    def test_posts_to_resend_with_key(self, monkeypatch):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            captured["body"] = request.read().decode()
            return httpx.Response(200, json={"id": "abc"})

        monkeypatch.setattr(email_service.settings, "resend_api_key", "re_test")
        monkeypatch.setattr(email_service.settings, "email_from", "Coparent <no-reply@coparent.fr>")
        monkeypatch.setattr(email_service, "_transport", httpx.MockTransport(handler))

        ok = email_service.send_email("dest@test.fr", "Sujet", "<p>corps</p>")
        assert ok is True
        assert captured["url"] == "https://api.resend.com/emails"
        assert captured["auth"] == "Bearer re_test"
        assert "dest@test.fr" in captured["body"]
        assert "Sujet" in captured["body"]


class TestAccentedDomains:
    """Resend refuse les domaines non ASCII : ils sont convertis (IDNA) avant l'envoi."""

    def test_ascii_address(self):
        assert email_service.ascii_address("alternly@hōnō.com") == "alternly@xn--hn-vrab.com"
        assert email_service.ascii_address(" contact@alternly.com ") == "contact@alternly.com"
        assert email_service.ascii_address("pas-une-adresse") == "pas-une-adresse"

    def test_ascii_sender(self):
        assert email_service.ascii_sender("Alternly <alternly@hōnō.com>") == "Alternly <alternly@xn--hn-vrab.com>"
        assert email_service.ascii_sender("Alternly <alternly@xn--hn-vrab.com>") == "Alternly <alternly@xn--hn-vrab.com>"
        assert email_service.ascii_sender("alternly@hōnō.com") == "alternly@xn--hn-vrab.com"

    def test_to_and_reply_to_are_converted(self, monkeypatch):
        import json

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.read())
            return httpx.Response(200, json={"id": "abc"})

        monkeypatch.setattr(email_service.settings, "resend_api_key", "re_test")
        monkeypatch.setattr(email_service, "_transport", httpx.MockTransport(handler))
        assert email_service.send_email("alternly@hōnō.com", "S", "<p>x</p>", reply_to="parent@école.fr")
        assert captured["body"]["to"] == ["alternly@xn--hn-vrab.com"]
        assert captured["body"]["reply_to"] == ["parent@xn--cole-9oa.fr"]


class TestTemplateEscaping:
    def test_note_is_html_escaped(self):
        _, html = email_service.exchange_proposed_email(
            {"date_start": "2099-03-04", "date_end": "2099-03-04", "note": '<script>alert(1)</script>'}
        )
        assert "<script>" not in html
        assert "&lt;script&gt;" in html


class TestProposalEmail:
    def test_proposed_emails_recipient(self, client, auth_headers, db_session, sent):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        )
        assert len(sent) == 1
        assert sent[0]["to"] == "parent2@test.fr"

    def test_no_email_when_opted_out(self, client, auth_headers, db_session, sent):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        # parent2 coupe ses e-mails
        r = client.patch("/api/auth/me", json={"email_opt_in": False}, headers=headers2)
        assert r.status_code == 200
        assert r.json()["email_opt_in"] is False
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        )
        assert sent == []

    def test_opt_in_default_true(self, client, auth_headers):
        headers, user = auth_headers()
        assert client.get("/api/auth/me", headers=headers).json()["email_opt_in"] is True

    def test_accept_does_not_email(self, client, auth_headers, db_session, sent):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        ).json()["id"]
        sent.clear()
        client.post(f"/api/households/{h['id']}/exceptions/{eid}/accept", json={}, headers=headers2)
        assert sent == []  # accepté/refusé/retiré restent in-app


class TestCronReminders:
    def _propose_tomorrow(self, client, headers, h, parent_id):
        tomorrow = iso(date.today() + timedelta(days=1))
        return client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": tomorrow, "date_end": tomorrow, "parent_id": parent_id},
            headers=headers,
        ).json()["id"]

    def test_reminder_sent_once(self, client, auth_headers, db_session, sent, monkeypatch):
        monkeypatch.setattr(email_service.settings, "cron_secret", "s3cr3t")
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        self._propose_tomorrow(client, headers1, h, user2["id"])
        sent.clear()
        r = client.post("/api/cron/exchange-reminders", headers={"X-Cron-Key": "s3cr3t"})
        assert r.status_code == 200
        assert r.json()["sent"] == 1
        assert len(sent) == 1 and sent[0]["to"] == "parent2@test.fr"
        # deuxième passage : plus rien (reminder_sent_at posé)
        sent.clear()
        r2 = client.post("/api/cron/exchange-reminders", headers={"X-Cron-Key": "s3cr3t"})
        assert r2.json()["sent"] == 0
        assert sent == []

    def test_reminder_wrong_key_401(self, client, auth_headers, db_session, monkeypatch):
        monkeypatch.setattr(email_service.settings, "cron_secret", "s3cr3t")
        r = client.post("/api/cron/exchange-reminders", headers={"X-Cron-Key": "mauvais"})
        assert r.status_code == 401

    def test_reminder_skips_opted_out(self, client, auth_headers, db_session, sent, monkeypatch):
        monkeypatch.setattr(email_service.settings, "cron_secret", "s3cr3t")
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        client.patch("/api/auth/me", json={"email_opt_in": False}, headers=headers2)
        self._propose_tomorrow(client, headers1, h, user2["id"])
        sent.clear()
        r = client.post("/api/cron/exchange-reminders", headers={"X-Cron-Key": "s3cr3t"})
        assert r.json()["sent"] == 0


class TestOnboardingFlag:
    def test_default_false_and_patch(self, client, auth_headers):
        headers, user = auth_headers()
        assert client.get("/api/auth/me", headers=headers).json()["onboarding_seen"] is False
        r = client.patch("/api/auth/me", json={"onboarding_seen": True}, headers=headers)
        assert r.status_code == 200 and r.json()["onboarding_seen"] is True


class TestEmailHardening:
    def test_mask_email(self):
        assert email_service.mask_email("jean.dupont@x.fr") == "j***@x.fr"
        assert email_service.mask_email("pas-une-adresse") == "***"

    def test_logs_mask_address(self, monkeypatch, caplog):
        monkeypatch.setattr(email_service.settings, "resend_api_key", "")
        with caplog.at_level("INFO", logger="coparent.email"):
            email_service.send_email("jean.dupont@x.fr", "Sujet", "<p/>")
        assert "jean.dupont" not in caplog.text and "j***@x.fr" in caplog.text

    def test_proposal_email_sent_after_commit(self, client, auth_headers, db_session, monkeypatch):
        from sqlalchemy import select

        from app.models import ScheduleException

        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        seen = []
        monkeypatch.setattr(
            email_service,
            "send_email",
            lambda to, subject, html: seen.append(db_session.scalars(select(ScheduleException)).all()) or True,
        )
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        )
        assert len(seen) == 1 and len(seen[0]) == 1  # proposition déjà enregistrée à l'envoi

    def test_proposal_email_in_recipient_locale(self, client, auth_headers, db_session, sent):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        client.patch("/api/auth/me", json={"locale": "en"}, headers=headers2)
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-05", "parent_id": user2["id"]},
            headers=headers1,
        )
        assert sent[0]["subject"] == "New custody swap proposal"
        assert "2099-03-04 to 2099-03-05" in sent[0]["html"]


class TestEmailCheck:
    def test_requires_cron_key(self, client, monkeypatch):
        monkeypatch.setattr(email_service.settings, "cron_secret", "s3cret")
        assert client.post("/api/cron/email-check").status_code == 401

    def test_reports_config_without_secrets_and_sends_test(self, client, monkeypatch):
        import json

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.read())
            return httpx.Response(403, json={"message": "domain not verified"})

        monkeypatch.setattr(email_service.settings, "cron_secret", "s3cret")
        monkeypatch.setattr(email_service.settings, "resend_api_key", "re_supersecretkey")
        monkeypatch.setattr(email_service.settings, "feedback_email", "alternly@hōnō.com")
        monkeypatch.setattr(email_service, "_transport", httpx.MockTransport(handler))
        r = client.post("/api/cron/email-check", headers={"X-Cron-Key": "s3cret"})
        assert r.status_code == 200
        data = r.json()
        assert "supersecret" not in r.text
        assert data["resend_api_key"].startswith("présente (re_")
        assert data["test"]["status"] == 403 and "domain not verified" in data["test"]["response"]
        assert captured["body"]["to"] == ["alternly@xn--hn-vrab.com"]

    def test_no_key_no_call(self, client, monkeypatch):
        monkeypatch.setattr(email_service.settings, "cron_secret", "s3cret")
        monkeypatch.setattr(email_service.settings, "resend_api_key", "")
        r = client.post("/api/cron/email-check", headers={"X-Cron-Key": "s3cret"})
        assert r.json()["resend_api_key"] == "absente"
