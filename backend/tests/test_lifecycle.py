"""E-mails de cycle de vie : séquence de bienvenue (J0/J1/J3/J7), rappels de
vacances scolaires, garde-fous (opt-out, un e-mail par jour, comptes anonymisés),
désinscription signée et cron."""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import EmailLog, Household, Invitation, SchoolVacationPeriod, User, utcnow
from app.services import analytics, lifecycle
from app.services import email as email_service
from app.services import lifecycle_emails as tpl
from app.services.calendar_service import build_calendar
from app.services.vacation_tool import compute_split
from app.services.custody_engine import Period
from tests.test_household import create_household
from tests.test_invitation_loop import invite, solo_household


@pytest.fixture
def sent(monkeypatch):
    box: list[dict] = []

    def fake(to, subject, html, text, unsubscribe_url):
        box.append({"to": to, "subject": subject, "html": html, "text": text, "unsub": unsubscribe_url})
        return True

    monkeypatch.setattr(email_service, "send_lifecycle_email", fake)
    return box


@pytest.fixture
def events(monkeypatch):
    box: list[tuple] = []
    monkeypatch.setattr(analytics.settings, "posthog_token", "phc_test")
    monkeypatch.setattr(analytics, "_send", lambda did, ev, props, groups: box.append((did, ev, props)))
    return box


def props(event) -> dict:
    """Propriétés d'un événement capturé, sans les clés techniques PostHog ($…)."""
    return {k: v for k, v in event[2].items() if not k.startswith("$")}


def user_row(db, user_id) -> User:
    return db.get(User, user_id)


def age_user(db, user_id, days, hours=1):
    """Recule la création du compte ; l'e-mail J0 (s'il existe) est reculé d'autant."""
    u = db.get(User, user_id)
    u.created_at = utcnow() - timedelta(days=days, hours=hours)
    for log in db.scalars(select(EmailLog).where(EmailLog.user_id == user_id)):
        log.sent_at = u.created_at
    db.commit()


def kinds(db, user_id) -> set[str]:
    return set(db.scalars(select(EmailLog.kind).where(EmailLog.user_id == user_id)))


def make_premium(db, user_id):
    u = db.get(User, user_id)
    u.subscription_status = "active"
    db.commit()


def join_partner(client, auth_headers, token, name="Dominique Durand", email="parent2@test.fr", locale="fr"):
    r = client.post(
        "/api/auth/register",
        json={"email": email, "password": "motdepasse1", "display_name": name, "color": "#c46b4f",
              "via_invite": True, "locale": locale},
    )
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    acc = client.post(f"/api/invitations/{token}/accept", headers=headers)
    assert acc.status_code == 200, acc.text
    return headers, r.json()["user"]


# ---------------------------------------------------------------- J0


class TestWelcome:
    def test_sent_at_signup_with_text_and_unsubscribe(self, client, auth_headers, db_session, sent, events):
        _, user = auth_headers(name="Camille Martin")
        assert len(sent) == 1
        mail = sent[0]
        assert mail["to"] == user["email"]
        assert mail["subject"] == "Bienvenue sur Alternly"
        assert "Bienvenue sur Alternly, Camille" in mail["html"]
        # les 3 étapes : règle de garde → invitation → synchro
        html = mail["html"]
        assert html.index("règle de garde") < html.index("Invitez l'autre parent") < html.index("Synchronisez")
        assert "/app" in html and mail["unsub"] in html
        assert mail["unsub"].startswith(f"{settings.public_site_url}/api/email/unsubscribe?token={user['id']}.")
        assert "Se désabonner" in mail["text"] and "<" not in mail["text"].replace("<http", "")
        assert kinds(db_session, user["id"]) == {"welcome"}
        assert any(e[1] == "lifecycle_email_sent" and props(e) == {"kind": "welcome", "variant": "owner"} for e in events)

    def test_english(self, client, sent):
        r = client.post(
            "/api/auth/register",
            json={"email": "en@test.com", "password": "motdepasse1", "display_name": "Sam", "color": "#4f7cac",
                  "locale": "en"},
        )
        assert r.status_code == 201
        assert sent[0]["subject"] == "Welcome to Alternly"
        assert "Invite your co-parent" in sent[0]["html"]

    def test_partner_variant_on_accept(self, client, auth_headers, db_session, sent, events):
        headers, owner, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        sent.clear()
        _, partner = join_partner(client, auth_headers, token)
        assert len(sent) == 1, [m["subject"] for m in sent]  # pas de « Bienvenue » générique en plus
        mail = sent[0]
        assert mail["subject"] == "Bienvenue dans le foyer de Camille"
        assert "Léo et Lina" in mail["html"]
        assert "Vos prochains jours" in mail["html"] and "Synchroniser mon agenda" in mail["html"]
        assert kinds(db_session, partner["id"]) == {"welcome"}
        assert any(e[2].get("variant") == "partner" for e in events if e[1] == "lifecycle_email_sent")

    def test_partner_periods_match_calendar(self, client, auth_headers, db_session, sent):
        headers, owner, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        _, partner = join_partner(client, auth_headers, token)
        household = db_session.get(Household, h["id"])
        today = date.today()
        cal = build_calendar(db_session, household, today, today + timedelta(days=27))
        first_mine = next(d.day for d in cal.days if d.parent == str(partner["id"]))
        assert tpl.fmt_day(first_mine, "fr") in sent[-1]["html"]

    def test_existing_user_joining_gets_no_second_welcome(self, client, auth_headers, db_session, sent):
        headers, owner, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        other_headers, other = auth_headers(email="deja@test.fr", name="Déjà Inscrit")
        n = len(sent)
        client.post(f"/api/invitations/{token}/accept", headers=other_headers)
        assert len(sent) == n


# ---------------------------------------------------------------- séquence


class TestSequence:
    @pytest.fixture(autouse=True)
    def _no_holiday_reminders(self, monkeypatch):
        """La séquence est testée seule : un rappel de vacances réel (ex. Toussaint
        à moins de 10 jours) prendrait sinon le seul e-mail autorisé du jour."""
        monkeypatch.setattr(lifecycle, "run_holidays", lambda db, now, today: {})

    def test_j1_when_no_rule_then_once(self, client, auth_headers, db_session, sent, events):
        _, user = auth_headers()
        age_user(db_session, user["id"], 1)
        sent.clear()
        stats = lifecycle.run(db_session)
        assert stats["j1_rule"] == 1
        assert sent[0]["subject"] == "Il ne manque que votre règle de garde"
        assert "/onboarding" in sent[0]["html"]
        assert lifecycle.run(db_session)["j1_rule"] == 0  # idempotent
        assert len(sent) == 1
        assert any(props(e) == {"kind": "j1_rule"} for e in events if e[1] == "lifecycle_email_sent")

    def test_j1_skipped_when_onboarded(self, client, auth_headers, db_session, sent):
        _, user, _ = solo_household(client, auth_headers)
        age_user(db_session, user["id"], 1)
        sent.clear()
        lifecycle.run(db_session)
        assert sent == []
        assert "j1_rule" not in kinds(db_session, user["id"])

    def test_j3_solo_household(self, client, auth_headers, db_session, sent):
        _, user, _ = solo_household(client, auth_headers)
        age_user(db_session, user["id"], 3)
        sent.clear()
        assert lifecycle.run(db_session)["j3_invite"] == 1
        assert sent[0]["subject"] == "Comment présenter Alternly à l'autre parent"
        assert "/settings#invite" in sent[0]["html"]

    def test_j3_skipped_when_partner_joined(self, client, auth_headers, db_session, sent):
        headers, user, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        join_partner(client, auth_headers, token)
        age_user(db_session, user["id"], 3)
        sent.clear()
        lifecycle.run(db_session)
        assert all(m["to"] != user["email"] for m in sent)

    def test_j3_deferred_after_invitation_reminder(self, client, auth_headers, db_session, sent):
        headers, user, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        age_user(db_session, user["id"], 3)
        inv = db_session.scalar(select(Invitation).where(Invitation.token == token))
        inv.inviter_reminder_d2_at = utcnow() - timedelta(hours=2)  # relance J+2 partie ce matin
        db_session.commit()
        sent.clear()
        assert lifecycle.run(db_session)["j3_invite"] == 0
        # Le lendemain, la relance d'invitation date de plus de 20 h : J3 part.
        assert lifecycle.run(db_session, now=utcnow() + timedelta(days=1))["j3_invite"] == 1

    def test_j3_deferred_after_onboarding_nudge(self, client, auth_headers, db_session, sent):
        _, user, _ = solo_household(client, auth_headers)
        age_user(db_session, user["id"], 3)
        u = user_row(db_session, user["id"])
        u.invite_nudge_sent_at = utcnow() - timedelta(hours=1)
        db_session.commit()
        sent.clear()
        assert lifecycle.run(db_session)["j3_invite"] == 0

    def test_j7_solo_pushes_the_invitation(self, client, auth_headers, db_session, sent, events):
        _, user, _ = solo_household(client, auth_headers)
        age_user(db_session, user["id"], 7)
        sent.clear()
        assert lifecycle.run(db_session)["j7_value"] == 1
        mail = sent[0]
        assert "seul·e à le voir" in mail["subject"]
        assert "Inviter l'autre parent" in mail["html"] and "/settings#invite" in mail["html"]
        assert "Découvrir Premium" not in mail["html"]
        assert any(props(e) == {"kind": "j7_value", "solo": True} for e in events if e[1] == "lifecycle_email_sent")

    def test_j7_free_mentions_premium_softly(self, client, auth_headers, db_session, sent, events):
        _, user, _, _ = two_parent_household(client, auth_headers, db_session)
        age_user(db_session, user["id"], 7)
        sent.clear()
        assert lifecycle.run(db_session)["j7_value"] == 1
        mail = sent[0]
        assert "Découvrir Premium" in mail["html"] and "dépenses partagées" in mail["html"]
        assert "échange" in mail["html"]
        assert "Découvrir Premium (http" in mail["text"]
        assert any(props(e) == {"kind": "j7_value", "premium": False} for e in events if e[1] == "lifecycle_email_sent")

    def test_j7_premium_copy(self, client, auth_headers, db_session, sent):
        _, user, _, _ = two_parent_household(client, auth_headers, db_session)
        make_premium(db_session, user["id"])
        age_user(db_session, user["id"], 7)
        sent.clear()
        lifecycle.run(db_session)
        mail = sent[0]
        assert "Synchroniser mon agenda" in mail["html"]
        assert "Découvrir Premium" not in mail["html"]

    def test_steps_do_not_stack_and_old_accounts_skipped(self, client, auth_headers, db_session, sent):
        _, user, _ = solo_household(client, auth_headers)
        age_user(db_session, user["id"], 30)
        sent.clear()
        lifecycle.run(db_session)
        assert sent == []

    def test_one_email_per_day(self, client, auth_headers, db_session, sent):
        _, user = auth_headers()
        age_user(db_session, user["id"], 1)
        db_session.add(EmailLog(user_id=user["id"], kind="holiday:x:2026-01-01", sent_at=utcnow() - timedelta(hours=3)))
        db_session.commit()
        sent.clear()
        assert lifecycle.run(db_session)["j1_rule"] == 0
        assert lifecycle.run(db_session, now=utcnow() + timedelta(hours=21))["j1_rule"] == 1

    def test_opt_out_respected(self, client, auth_headers, db_session, sent):
        _, user = auth_headers()
        age_user(db_session, user["id"], 1)
        user_row(db_session, user["id"]).email_opt_in = False
        db_session.commit()
        sent.clear()
        lifecycle.run(db_session)
        assert sent == []

    def test_anonymized_and_placeholder_skipped(self, client, auth_headers, db_session, sent):
        headers, user, h = solo_household(client, auth_headers)
        token = invite(client, headers, h)["token"]
        p_headers, partner = join_partner(client, auth_headers, token)
        # L'invité supprime son compte : anonymisé (un parent réel subsiste).
        assert client.delete("/api/auth/me", headers=p_headers).status_code == 204
        ghost = user_row(db_session, partner["id"])
        assert ghost.is_placeholder
        ghost.email_opt_in = True  # même réactivé par erreur, jamais écrit
        ghost.created_at = utcnow() - timedelta(days=7, hours=1)
        db_session.commit()
        assert not lifecycle.can_email(ghost)
        sent.clear()
        lifecycle.run(db_session)
        assert all(m["to"] != ghost.email for m in sent)

    def test_deleted_account_logs_removed(self, client, auth_headers, db_session, sent):
        headers, user = auth_headers()
        assert kinds(db_session, user["id"]) == {"welcome"}
        assert client.delete("/api/auth/me", headers=headers).status_code == 204
        assert db_session.scalars(select(EmailLog).where(EmailLog.user_id == user["id"])).all() == []


# ---------------------------------------------------------------- vacances scolaires

TOUSSAINT = date(2026, 10, 17)  # calendrier simulé (conftest) : 17 oct. → 1er nov. inclus


def two_parent_household(client, auth_headers, db_session, zone="A"):
    """Camille (parent1) + Dominique ; vacances partagées par moitié, Camille a la
    1re moitié les années paires."""
    headers, owner = auth_headers(name="Camille Martin")
    h = create_household(client, headers, zone=zone)
    client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers)
    client.post(f"/api/households/{h['id']}/children", json={"first_name": "Lina"}, headers=headers)
    r = client.put(
        f"/api/households/{h['id']}/custody-rule",
        json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": owner["id"],
              "handover_time": "18:00"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    token = invite(client, headers, h)["token"]
    _, partner = join_partner(client, auth_headers, token)
    r = client.put(
        f"/api/households/{h['id']}/vacation-rule",
        json={"mode": "split_half", "even_year_first_half_parent_id": owner["id"]},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    # Comptes anciens : hors séquence de bienvenue (on isole les rappels de vacances).
    for uid in (owner["id"], partner["id"]):
        age_user(db_session, uid, 60)
    return headers, owner, partner, h


def run_on(db, day: date):
    return lifecycle.run(db, now=datetime.combine(day, datetime.min.time()) + timedelta(hours=6), today=day)


class TestHolidayReminders:
    def test_premium_household_who_has_the_kids(self, client, auth_headers, db_session, sent, events):
        _, owner, partner, h = two_parent_household(client, auth_headers, db_session)
        make_premium(db_session, owner["id"])
        sent.clear()
        stats = run_on(db_session, TOUSSAINT - timedelta(days=10))
        assert stats["holiday_reminders"] == 2
        by_to = {m["to"]: m for m in sent}
        mine = by_to[owner["email"]]
        assert mine["subject"] == "Vacances de la Toussaint dans 10 jours"
        # Même résultat que le moteur de l'outil public (moitié / moitié, 1re moitié à Camille).
        split = compute_split(Period("Toussaint", TOUSSAINT, date(2026, 11, 1)), "split_half", "A")
        assert [(s["start"], s["end"]) for s in split] == [
            (date(2026, 10, 17), date(2026, 10, 24)), (date(2026, 10, 25), date(2026, 11, 1)),
        ]
        assert (
            "Léo et Lina seront chez vous du sam. 17 oct. au sam. 24 oct., "
            "puis chez Dominique du dim. 25 oct. au dim. 1er nov." in mine["html"]
        )
        assert "Passage de relais : dim. 25 oct. à 18:00." in mine["html"]
        assert "/app?propose=2026-10-17" in mine["html"] and "Proposer un échange" in mine["html"]
        assert "offert" not in mine["html"]
        theirs = by_to[partner["email"]]
        assert "chez Camille du sam. 17 oct. au sam. 24 oct., puis chez vous du dim. 25 oct." in theirs["html"]
        assert any(
            e[1] == "holiday_reminder_sent" and e[2]["period"] == "toussaint" and e[2]["teaser"] is False
            for e in events
        )
        # Une seule fois par période, même si le cron repasse les jours suivants.
        sent.clear()
        assert run_on(db_session, TOUSSAINT - timedelta(days=9))["holiday_reminders"] == 0
        assert sent == []

    def test_matches_app_calendar(self, client, auth_headers, db_session, sent):
        _, owner, partner, h = two_parent_household(client, auth_headers, db_session)
        make_premium(db_session, owner["id"])
        sent.clear()
        run_on(db_session, TOUSSAINT - timedelta(days=8))
        household = db_session.get(Household, h["id"])
        cal = build_calendar(db_session, household, TOUSSAINT, date(2026, 11, 1))
        first_other = next(d.day for d in cal.days if d.parent == str(partner["id"]))
        mine = next(m for m in sent if m["to"] == owner["email"])
        assert f"puis chez Dominique du {tpl.fmt_day(first_other, 'fr')}" in mine["html"]

    def test_outside_window_nothing(self, client, auth_headers, db_session, sent):
        _, owner, _, _ = two_parent_household(client, auth_headers, db_session)
        make_premium(db_session, owner["id"])
        sent.clear()
        assert run_on(db_session, TOUSSAINT - timedelta(days=11))["holiday_reminders"] == 0
        assert run_on(db_session, TOUSSAINT - timedelta(days=5))["holiday_reminders"] == 0
        assert sent == []

    def test_free_household_gets_one_teaser_only(self, client, auth_headers, db_session, sent, events):
        _, owner, partner, _ = two_parent_household(client, auth_headers, db_session)
        sent.clear()
        stats = run_on(db_session, TOUSSAINT - timedelta(days=10))
        assert stats["holiday_teasers"] == 2 and stats["holiday_reminders"] == 0
        assert all("Ce premier rappel vous est offert" in m["html"] for m in sent)
        assert any(e[1] == "holiday_reminder_sent" and e[2]["teaser"] is True for e in events)
        # Noël : plus rien pour un foyer gratuit…
        sent.clear()
        noel = date(2026, 12, 19)
        assert run_on(db_session, noel - timedelta(days=10))["holiday_teasers"] == 0
        assert sent == []
        # …mais le rappel complet dès que le foyer passe Premium.
        make_premium(db_session, partner["id"])
        assert run_on(db_session, noel - timedelta(days=9))["holiday_reminders"] == 2
        assert sent[0]["subject"] == "Vacances de Noël dans 9 jours"

    def test_opt_out_and_english(self, client, auth_headers, db_session, sent):
        _, owner, partner, _ = two_parent_household(client, auth_headers, db_session)
        make_premium(db_session, owner["id"])
        user_row(db_session, owner["id"]).email_opt_in = False
        user_row(db_session, partner["id"]).locale = "en"
        db_session.commit()
        sent.clear()
        run_on(db_session, TOUSSAINT - timedelta(days=10))
        assert [m["to"] for m in sent] == [partner["email"]]
        mail = sent[0]
        assert mail["subject"] == "Fall break (Toussaint) in 10 days"
        assert "with Camille from Sat, Oct 17 to Sat, Oct 24, then with you from Sun, Oct 25 to Sun, Nov 1" in mail["html"]

    def test_daily_guard_defers_holiday(self, client, auth_headers, db_session, sent):
        _, owner, partner, _ = two_parent_household(client, auth_headers, db_session)
        make_premium(db_session, owner["id"])
        day = TOUSSAINT - timedelta(days=10)
        db_session.add(EmailLog(user_id=owner["id"], kind="j7_value",
                                sent_at=datetime.combine(day, datetime.min.time()) + timedelta(hours=2)))
        db_session.commit()
        sent.clear()
        run_on(db_session, day)
        assert [m["to"] for m in sent] == [partner["email"]]
        run_on(db_session, day + timedelta(days=1))
        assert sent[-1]["to"] == owner["email"] and "dans 9 jours" in sent[-1]["subject"]

    def test_us_manual_periods(self, client, auth_headers, db_session, sent):
        headers, owner = auth_headers(name="Sam Parker")
        r = client.post("/api/households", json={"name": "Parker", "country": "US"}, headers=headers)
        assert r.status_code == 201, r.text
        hid = r.json()["id"]
        client.post(f"/api/households/{hid}/children", json={"first_name": "Mia"}, headers=headers)
        client.put(
            f"/api/households/{hid}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": owner["id"]},
            headers=headers,
        )
        make_premium(db_session, owner["id"])
        user_row(db_session, owner["id"]).locale = "en"
        age_user(db_session, owner["id"], 60)
        sent.clear()
        # Aucun congé saisi : rien.
        assert run_on(db_session, date(2026, 11, 16))["holiday_reminders"] == 0
        db_session.add(SchoolVacationPeriod(household_id=hid, label="Thanksgiving break",
                                            start=date(2026, 11, 25), end=date(2026, 11, 29)))
        db_session.commit()
        assert run_on(db_session, date(2026, 11, 16))["holiday_reminders"] == 1
        mail = sent[0]
        assert mail["subject"] == "Thanksgiving break in 9 days"
        assert "Mia will be" in mail["html"] and "Wed, Nov 25" in mail["html"]
        assert "holiday:Thanksgiving break:2026-11-25" in kinds(db_session, owner["id"])

    def test_household_without_rule_skipped(self, client, auth_headers, db_session, sent):
        headers, owner = auth_headers()
        create_household(client, headers, zone="A")
        make_premium(db_session, owner["id"])
        age_user(db_session, owner["id"], 60)
        sent.clear()
        assert run_on(db_session, TOUSSAINT - timedelta(days=10))["holiday_reminders"] == 0


# ---------------------------------------------------------------- désinscription & cron


class TestUnsubscribe:
    def test_link_unsubscribes(self, client, auth_headers, db_session, sent, events):
        _, user = auth_headers()
        token = tpl.unsubscribe_token(user["id"])
        r = client.get(f"/api/email/unsubscribe?token={token}")
        assert r.status_code == 200
        assert "Désinscription confirmée" in r.text and user["email"] in r.text
        assert user_row(db_session, user["id"]).email_opt_in is False
        assert any(e[1] == "email_unsubscribed" and props(e) == {"source": "link"} for e in events)
        # Idempotent : second clic → même page, pas de second événement.
        n = len(events)
        assert client.get(f"/api/email/unsubscribe?token={token}").status_code == 200
        assert len(events) == n

    def test_one_click_post(self, client, auth_headers, db_session):
        _, user = auth_headers()
        r = client.post(f"/api/email/unsubscribe?token={tpl.unsubscribe_token(user['id'])}")
        assert r.status_code == 200 and r.json() == {"unsubscribed": True}
        assert user_row(db_session, user["id"]).email_opt_in is False

    @pytest.mark.parametrize("token", ["", "abc", "1.faux", "999999.xxxxxxxx", "1"])
    def test_invalid_token(self, client, auth_headers, db_session, token):
        _, user = auth_headers()
        r = client.get(f"/api/email/unsubscribe?token={token}")
        assert r.status_code == 400 and "Lien invalide" in r.text
        assert client.post(f"/api/email/unsubscribe?token={token}").status_code == 400
        assert user_row(db_session, user["id"]).email_opt_in is True

    def test_token_bound_to_user(self, client, auth_headers, db_session):
        _, a = auth_headers(email="a@test.fr")
        _, b = auth_headers(email="b@test.fr")
        forged = f"{b['id']}.{tpl.unsubscribe_token(a['id']).split('.')[1]}"
        assert client.get(f"/api/email/unsubscribe?token={forged}").status_code == 400
        assert user_row(db_session, b["id"]).email_opt_in is True

    def test_resend_payload_has_headers_and_text(self, monkeypatch):
        import httpx

        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen.update(json.loads(request.content))
            return httpx.Response(200, json={"id": "x"})

        monkeypatch.setattr(settings, "resend_api_key", "re_test")
        monkeypatch.setattr(email_service, "_transport", httpx.MockTransport(handler))
        assert email_service.send_lifecycle_email("a@b.fr", "Sujet", "<p>x</p>", "x", "https://u/unsub?token=1.a")
        assert seen["text"] == "x"
        assert seen["headers"] == {
            "List-Unsubscribe": "<https://u/unsub?token=1.a>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }


class TestCronEndpoint:
    def test_requires_key(self, client, monkeypatch):
        monkeypatch.setattr(settings, "cron_secret", "s3cret")
        assert client.post("/api/cron/lifecycle").status_code == 401
        assert client.post("/api/cron/lifecycle", headers={"X-Cron-Key": "bad"}).status_code == 401

    def test_runs(self, client, auth_headers, db_session, sent, monkeypatch):
        monkeypatch.setattr(settings, "cron_secret", "s3cret")
        _, user = auth_headers()
        age_user(db_session, user["id"], 1)
        r = client.post("/api/cron/lifecycle", headers={"X-Cron-Key": "s3cret"})
        assert r.status_code == 200
        assert r.json()["j1_rule"] == 1


class TestFormatting:
    def test_dates(self):
        assert tpl.fmt_day(date(2026, 10, 17), "fr") == "sam. 17 oct."
        assert tpl.fmt_day(date(2026, 11, 1), "fr") == "dim. 1er nov."
        assert tpl.fmt_day(date(2026, 10, 17), "en") == "Sat, Oct 17"

    def test_names_escaped(self):
        seg = tpl.Segment("<b>X</b>", False, date(2026, 10, 17), date(2026, 10, 20))
        mail = tpl.holiday_reminder_email(
            "Vacances de la Toussaint", date(2026, 10, 17), 10, ["<i>k</i>"], [seg], "18:00",
            "<b>X</b>", False, "fr", "https://u",
        )
        assert "<b>X</b>" not in mail.html and "<i>k</i>" not in mail.html
