"""Notifications push mobile : appareils, envoi après commit, préférences, rappel de passation."""
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.deps import notify
from app.models import DeviceToken
from app.services import handover_reminders, push
from tests.test_household import create_household
from tests.test_rules import setup_family

TOKEN_1 = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
TOKEN_2 = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"


@pytest.fixture
def sent(monkeypatch):
    """Capture les messages envoyés à Expo (aucun appel réseau, envoi synchrone)."""
    out: list[dict] = []
    monkeypatch.setattr(push, "_run", lambda fn, messages: fn(messages))

    def fake_post(messages):
        out.extend(messages)
        return [{"status": "ok", "id": str(i)} for i, _ in enumerate(messages)]

    monkeypatch.setattr(push, "_post", fake_post)
    return out


def register(client, headers, token=TOKEN_1, platform="ios"):
    return client.post("/api/devices", json={"token": token, "platform": platform, "app_version": "0.2.0"}, headers=headers)


def propose(client, headers, hid, parent_id, note=""):
    return client.post(
        f"/api/households/{hid}/exceptions",
        json={"date_start": "2099-03-04", "date_end": "2099-03-05", "parent_id": parent_id, "note": note},
        headers=headers,
    )


class TestDevices:
    def test_register_and_unregister(self, client, auth_headers, db_session):
        headers, user = auth_headers()
        assert register(client, headers).status_code == 204
        assert db_session.scalar(select(DeviceToken.user_id).where(DeviceToken.token == TOKEN_1)) == user["id"]
        assert client.delete(f"/api/devices/{TOKEN_1}", headers=headers).status_code == 204
        assert db_session.scalar(select(DeviceToken).where(DeviceToken.token == TOKEN_1)) is None

    def test_rejects_non_expo_token(self, client, auth_headers):
        headers, _ = auth_headers()
        assert register(client, headers, token="not-a-token-at-all").status_code == 422
        assert register(client, headers, platform="windows").status_code == 422

    def test_same_phone_moves_to_the_new_account(self, client, auth_headers, db_session):
        headers1, _ = auth_headers()
        headers2, user2 = auth_headers(email="autre@test.fr")
        register(client, headers1)
        register(client, headers2)
        rows = db_session.scalars(select(DeviceToken).where(DeviceToken.token == TOKEN_1)).all()
        assert [r.user_id for r in rows] == [user2["id"]]

    def test_cannot_unregister_someone_elses_phone(self, client, auth_headers, db_session):
        headers1, _ = auth_headers()
        headers2, _ = auth_headers(email="autre@test.fr")
        register(client, headers1)
        client.delete(f"/api/devices/{TOKEN_1}", headers=headers2)
        assert db_session.scalar(select(DeviceToken).where(DeviceToken.token == TOKEN_1)) is not None

    def test_logout_all_forgets_phones(self, client, auth_headers, db_session):
        headers, _ = auth_headers()
        register(client, headers)
        assert client.post("/api/auth/logout-all", headers=headers).status_code == 204
        assert db_session.scalar(select(DeviceToken).where(DeviceToken.token == TOKEN_1)) is None


class TestDelivery:
    def test_exchange_proposal_pushes_to_the_other_parent(self, client, auth_headers, sent):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        register(client, headers2, TOKEN_2)
        sent.clear()  # « parent_joined » envoyé à user1 (sans téléphone) : rien
        assert propose(client, headers1, h["id"], user2["id"], note="Anniversaire").status_code == 201
        assert len(sent) == 1
        msg = sent[0]
        assert msg["to"] == TOKEN_2
        assert msg["title"] == "Échange de garde"
        assert msg["body"] == "Nouvel échange proposé (4 → 5 mars) — « Anniversaire » — à accepter ou refuser"
        assert msg["data"]["type"] == "exchange_proposed"
        assert isinstance(msg["data"]["id"], int)

    def test_english_account_gets_english_text(self, client, auth_headers, sent):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        client.patch("/api/auth/me", json={"locale": "en"}, headers=headers2)
        register(client, headers2, TOKEN_2)
        propose(client, headers1, h["id"], user2["id"])
        assert sent[-1]["body"] == "New swap proposed (Mar 4 → 5) — accept or decline"

    def test_no_phone_no_push(self, client, auth_headers, sent):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        propose(client, headers1, h["id"], user2["id"])
        assert sent == []

    def test_nothing_sent_when_the_transaction_rolls_back(self, client, auth_headers, db_session, sent):
        headers, user = auth_headers()
        register(client, headers)
        notify(db_session, user["id"], "rule_changed", {"what": "custody"})
        db_session.rollback()
        db_session.commit()
        assert sent == []

    def test_sent_only_after_commit(self, client, auth_headers, db_session, sent):
        headers, user = auth_headers()
        register(client, headers)
        notify(db_session, user["id"], "rule_changed", {"what": "custody"})
        assert sent == []
        db_session.commit()
        assert [m["body"] for m in sent] == ["Les règles de garde ont été modifiées"]

    def test_category_can_be_turned_off(self, client, auth_headers, sent):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        register(client, headers2, TOKEN_2)
        resp = client.put("/api/devices/prefs", json={"exchanges": False}, headers=headers2)
        assert resp.status_code == 200
        assert resp.json() == {"handover": True, "exchanges": False, "expenses": True, "wall": True, "household": True}
        assert client.get("/api/devices/prefs", headers=headers2).json()["exchanges"] is False
        sent.clear()
        propose(client, headers1, h["id"], user2["id"])
        assert sent == []

    def test_dead_tokens_are_forgotten(self, client, auth_headers, db_session, monkeypatch):
        headers, user = auth_headers()
        register(client, headers)
        forgotten: list[list[str]] = []
        monkeypatch.setattr(push, "_post", lambda msgs: [{"status": "error", "details": {"error": "DeviceNotRegistered"}}])
        monkeypatch.setattr(push, "_forget", forgotten.append)
        push.deliver(push.prepare(db_session, user["id"], "rule_changed", {}))
        assert forgotten == [[TOKEN_1]]

    def test_network_error_never_raises(self, monkeypatch):
        def boom(_):
            raise RuntimeError("réseau coupé")

        monkeypatch.setattr(push, "_post", boom)
        push.deliver([{"to": TOKEN_1, "title": "t", "body": "b"}])  # pas d'exception


class TestMessages:
    def test_money_and_dates(self):
        assert push.message("expense_added", {"label": "Cantine", "amount_cents": 123456}, "fr")[1] == (
            "Nouvelle dépense « Cantine » (1 234,56 €)"
        )
        assert push.message("expense_added", {"label": "Cantine", "amount_cents": 8400}, "en")[1] == (
            "New expense “Cantine” (€84.00)"
        )
        assert push.message("exchange_withdrawn", {"date_start": "2099-12-31", "date_end": "2099-12-31"}, "fr")[1] == (
            "Une proposition d'échange a été retirée (31 déc.)"
        )
        assert push.message("exception_deleted", {"date_start": "2099-12-30", "date_end": "2100-01-02"}, "fr")[1] == (
            "Échange de garde annulé (30 déc. → 2 janv.)"
        )

    def test_unknown_type_has_a_fallback(self):
        assert push.message("future_type", {}, "fr") == ("Alternly", "Nouvelle activité dans votre foyer")

    def test_categories(self):
        assert push.category("change_requested") == "exchanges"
        assert push.category("settlement_recorded") == "expenses"
        assert push.category("wall_reply_added") == "wall"
        assert push.category("parent_joined") == "household"
        assert push.category("handover_reminder") == "handover"


class TestHandoverReminders:
    def _family_with_rule(self, client, auth_headers, start: date):
        """Semaine/semaine, passation le lundi, parent 1 la semaine qui commence `start`."""
        headers1, user1 = auth_headers()
        h = create_household(client, headers1)
        client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léa"}, headers=headers1)
        client.post(f"/api/households/{h['id']}/children", json={"first_name": "Hugo"}, headers=headers1)
        rule = {
            "pattern": "alternate_weeks", "start_date": start.isoformat(), "reference_parent_id": user1["id"],
            "handover_day": 0, "handover_time": "18:00",
        }
        assert client.put(f"/api/households/{h['id']}/custody-rule", json=rule, headers=headers1).status_code == 200
        token = client.post(f"/api/households/{h['id']}/invitations", headers=headers1).json()["token"]
        headers2, user2 = auth_headers(email="parent2@test.fr", name="Dominique")
        client.post(f"/api/invitations/{token}/accept", headers=headers2)
        return headers1, user1, headers2, user2

    def test_both_parents_are_told_the_day_before(self, client, auth_headers, db_session, sent):
        monday = date(2099, 3, 2) - timedelta(days=date(2099, 3, 2).weekday())
        headers1, user1, headers2, user2 = self._family_with_rule(client, auth_headers, monday)
        register(client, headers1, TOKEN_1)
        register(client, headers2, TOKEN_2)
        sent.clear()
        sunday = monday + timedelta(days=6)  # demain lundi : la semaine passe chez le parent 2
        assert handover_reminders.run(db_session, today=sunday) == {"sent": 2}
        by_token = {m["to"]: m for m in sent}
        assert by_token[TOKEN_2]["body"] == "Demain, Léa et Hugo arrivent chez vous (vers 18:00)."
        assert by_token[TOKEN_1]["body"] == "Demain, Léa et Hugo partent chez Dominique (vers 18:00)."
        assert by_token[TOKEN_1]["title"] == "Passation"

    def test_rerun_does_not_send_twice(self, client, auth_headers, db_session, sent):
        monday = date(2099, 3, 2) - timedelta(days=date(2099, 3, 2).weekday())
        headers1, *_ = self._family_with_rule(client, auth_headers, monday)
        register(client, headers1, TOKEN_1)
        sunday = monday + timedelta(days=6)
        handover_reminders.run(db_session, today=sunday)
        sent.clear()
        assert handover_reminders.run(db_session, today=sunday) == {"sent": 0}
        assert sent == []

    def test_no_reminder_without_a_change(self, client, auth_headers, db_session, sent):
        monday = date(2099, 3, 2) - timedelta(days=date(2099, 3, 2).weekday())
        headers1, *_ = self._family_with_rule(client, auth_headers, monday)
        register(client, headers1, TOKEN_1)
        assert handover_reminders.run(db_session, today=monday + timedelta(days=2)) == {"sent": 0}

    def test_cron_endpoint_requires_the_key(self, client, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "cron_secret", "s3cret")
        assert client.post("/api/cron/handover-reminders").status_code == 401
        assert client.post("/api/cron/handover-reminders", headers={"X-Cron-Key": "s3cret"}).status_code == 200
