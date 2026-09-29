"""Signalements « Signaler un problème / Une idée » (#15)."""
import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Feedback
from app.services import analytics
from app.services import email as email_service
from tests.test_household import create_household


@pytest.fixture
def sent(monkeypatch):
    box: list[dict] = []
    monkeypatch.setattr(settings, "feedback_email", "support@alternly.test")
    monkeypatch.setattr(
        email_service,
        "send_email",
        lambda to, subject, html, reply_to=None: box.append(
            {"to": to, "subject": subject, "html": html, "reply_to": reply_to}
        ) or True,
    )
    return box


@pytest.fixture
def events(monkeypatch):
    box: list[tuple] = []
    monkeypatch.setattr(analytics.settings, "posthog_token", "phc_test")
    monkeypatch.setattr(analytics, "_send", lambda did, ev, props, groups: box.append((did, ev, props)))
    return box


def post(client, headers=None, **body):
    payload = {"kind": "problem", "message": "Le calendrier ne charge pas.", **body}
    return client.post("/api/feedback", json=payload, headers=headers or {})


def test_logged_in_feedback_is_stored_and_emailed(client, auth_headers, db_session, sent, events):
    headers, user = auth_headers(name="Camille Martin")
    h = create_household(client, headers)
    r = post(client, headers, page="/join/secret-token?x=1", source="settings", locale="fr")
    assert r.status_code == 202, r.text

    fb = db_session.scalar(select(Feedback))
    assert fb.user_id == user["id"] and fb.household_id == h["id"]
    assert fb.reply_email == "parent1@test.fr"
    assert fb.page == "/join/…"  # le jeton n'est jamais conservé
    assert fb.emailed is True

    (mail,) = sent
    assert mail["to"] == "support@alternly.test"
    assert mail["reply_to"] == "parent1@test.fr"
    assert mail["subject"].startswith("[Alternly][Problème] Le calendrier ne charge pas.")
    # Contexte technique sans prénom ni nom de foyer.
    assert "Camille" not in mail["html"] and h["name"] not in mail["html"]
    assert f"#{h['id']}" in mail["html"]
    assert any(e[1] == "feedback_sent" and e[2]["type"] == "problem" for e in events)


def test_message_is_escaped(client, auth_headers, sent):
    headers, _ = auth_headers()
    post(client, headers, message="<script>alert(1)</script>\nligne 2", kind="idea")
    assert "<script>" not in sent[0]["html"] and "&lt;script&gt;" in sent[0]["html"]
    assert "[Alternly][Idée]" in sent[0]["subject"]


def test_anonymous_needs_email(client, sent, db_session):
    r = post(client, source="footer")
    assert r.status_code == 422
    r = post(client, source="footer", email="Parent@Example.fr", kind="question")
    assert r.status_code == 202
    fb = db_session.scalar(select(Feedback))
    assert fb.user_id is None and fb.reply_email == "parent@example.fr"
    assert sent[0]["reply_to"] == "parent@example.fr"


def test_honeypot_drops_silently(client, sent, db_session):
    r = post(client, email="bot@spam.fr", website="http://spam.fr")
    assert r.status_code == 202
    assert db_session.scalar(select(Feedback)) is None and sent == []


def test_validation(client, auth_headers):
    headers, _ = auth_headers()
    assert post(client, headers, message="a").status_code == 422
    assert post(client, headers, message="x" * 2001).status_code == 422
    assert post(client, headers, kind="spam").status_code == 422


def test_stored_without_feedback_email(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "feedback_email", "")
    headers, _ = auth_headers()
    assert post(client, headers).status_code == 202
    fb = db_session.scalar(select(Feedback))
    assert fb is not None and fb.emailed is False


def test_rate_limits(client, auth_headers, sent, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    for _ in range(5):
        assert post(client, email="a@test.fr").status_code == 202
    assert post(client, email="a@test.fr").status_code == 429
