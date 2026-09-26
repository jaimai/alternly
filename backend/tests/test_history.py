"""Journal d'audit du foyer : couverture des mutations, pagination, rendu FR/EN."""
import hashlib
import hmac
import json
from datetime import date

from sqlalchemy import select

from app.models import AuditLog, User
from app.services import audit, paddle_api
from app.services.audit import euros, fmt_date, fmt_range, fr_date, fr_range, money
from tests.test_exchanges import create_solo
from tests.test_rules import premium_family, setup_family


def _history(client, headers, hid, **params):
    resp = client.get(f"/api/households/{hid}/history", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _summaries(client, headers, hid):
    return [e["summary"] for e in _history(client, headers, hid, limit=100)]


class TestFormatting:
    def test_fr_date_and_amounts(self):
        assert fr_date(date(2026, 10, 1)) == "jeu. 1 oct."
        assert fr_date(date(2026, 10, 5)) == "lun. 5 oct."
        assert fr_range(date(2026, 10, 1), date(2026, 10, 4)) == "jeu. 1 oct. → dim. 4 oct."
        assert euros(12900) == "129,00 €"
        assert euros(123456) == "1 234,56 €"

    def test_en_date_and_amounts(self):
        assert fmt_date(date(2026, 10, 1), "en") == "Thu, Oct 1"
        assert fmt_range(date(2026, 10, 1), date(2026, 10, 4), "en") == "Thu, Oct 1 → Sun, Oct 4"
        assert money(123456, "USD", "en") == "$1,234.56"
        assert money(12900, "EUR", "en") == "€129.00"
        assert money(12900, "USD", "fr") == "129,00 $"


class TestHistory:
    def test_mutations_are_journaled(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        hid = h["id"]
        client.post(
            f"/api/households/{hid}/expenses",
            json={"label": "Lunettes", "amount_cents": 12900, "date": "2026-07-10", "category": "sante"},
            headers=headers1,
        )
        client.post(
            f"/api/households/{hid}/exceptions",
            json={"date_start": "2026-10-01", "date_end": "2026-10-01", "parent_id": user1["id"]}, headers=headers1,
        )
        post = client.post(f"/api/households/{hid}/wall", json={"kind": "message", "body": "Doudou"}, headers=headers2).json()
        client.delete(f"/api/households/{hid}/wall/{post['id']}", headers=headers2)
        client.patch(f"/api/households/{hid}", json={"school_zone": "C"}, headers=headers1)

        entries = _history(client, headers2, hid)
        summaries = [e["summary"] for e in entries]
        assert summaries[0] == f"a changé la zone scolaire : {h['school_zone']} → C"
        assert "a supprimé le message « Doudou »" in summaries
        assert "a proposé un échange : jeu. 1 oct. chez Camille" in summaries
        assert "a ajouté la dépense « Lunettes » (129,00 €)" in summaries
        assert summaries[-1] == "a rejoint le foyer"
        assert entries[-1]["actor_id"] == user2["id"]
        assert set(entries[0]) == {"id", "actor_id", "action", "summary", "created_at"}
        ids = [e["id"] for e in entries]
        assert ids == sorted(ids, reverse=True)

    def test_summaries_rendered_in_reader_locale(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        hid = h["id"]
        client.patch("/api/auth/me", json={"locale": "en"}, headers=headers2)
        client.post(
            f"/api/households/{hid}/expenses",
            json={"label": "Lunettes", "amount_cents": 12900, "date": "2026-07-10", "category": "sante"},
            headers=headers1,
        )
        client.post(
            f"/api/households/{hid}/exceptions",
            json={"date_start": "2026-10-01", "date_end": "2026-10-02", "parent_id": user1["id"]}, headers=headers1,
        )
        fr = _summaries(client, headers1, hid)
        en = _summaries(client, headers2, hid)
        assert "a ajouté la dépense « Lunettes » (129,00 €)" in fr
        assert "added the expense “Lunettes” (€129.00)" in en
        assert "proposed a swap: Thu, Oct 1 → Fri, Oct 2 with Camille" in en
        assert en[-1] == "joined the household"

    def test_us_household_amounts_in_dollars(self, client, auth_headers, db_session):
        headers, user = auth_headers()
        db_session.get(User, user["id"]).subscription_status = "active"
        db_session.commit()
        client.patch("/api/auth/me", json={"locale": "en"}, headers=headers)
        h = client.post("/api/households", json={"name": "Home", "country": "US"}, headers=headers).json()
        client.post(
            f"/api/households/{h['id']}/expenses",
            json={"label": "Braces", "amount_cents": 123456, "date": "2026-07-10", "category": "sante"},
            headers=headers,
        )
        assert "added the expense “Braces” ($1,234.56)" in _summaries(client, headers, h["id"])

    def test_pagination_and_limit(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        hid = h["id"]
        for i in range(5):
            client.post(f"/api/households/{hid}/children", json={"first_name": f"E{i}"}, headers=headers)
        page1 = _history(client, headers, hid, limit=2)
        assert [e["summary"] for e in page1] == ["a ajouté l'enfant E4", "a ajouté l'enfant E3"]
        page2 = _history(client, headers, hid, limit=2, before_id=page1[-1]["id"])
        assert [e["summary"] for e in page2] == ["a ajouté l'enfant E2", "a ajouté l'enfant E1"]
        assert len(_history(client, headers, hid, limit=1000)) == 5

    def test_rule_change_journal_with_snapshot(self, client, auth_headers, db_session):
        headers, user, h = create_solo(client, auth_headers)
        hid = h["id"]
        body = {"pattern": "alternate_weeks", "start_date": "2026-10-05", "reference_parent_id": user["id"]}
        client.put(f"/api/households/{hid}/custody-rule", json=body, headers=headers)
        client.put(f"/api/households/{hid}/custody-rule", json={**body, "pattern": "two_two_three"}, headers=headers)
        summaries = _summaries(client, headers, hid)
        assert summaries[0] == "a modifié le rythme de garde : semaine/semaine → 2-2-3, départ le lun. 5 oct."
        assert summaries[1] == "a défini le rythme de garde : semaine/semaine, départ le lun. 5 oct."
        entry = db_session.scalars(
            select(AuditLog).where(AuditLog.action == "custody_rule.update").order_by(AuditLog.id.desc())
        ).first()
        assert entry.actor_id == user["id"]
        assert entry.data["before"]["pattern"] == "alternate_weeks" and entry.data["after"]["pattern"] == "two_two_three"

    def test_expense_journal_incl_settle(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        hid = h["id"]
        eid = client.post(
            f"/api/households/{hid}/expenses",
            json={"label": "Judo", "amount_cents": 5000, "date": "2026-07-10", "category": "activites"},
            headers=headers1,
        ).json()["id"]
        client.post(f"/api/households/{hid}/expenses/{eid}/dispute", json={}, headers=headers2)
        client.patch(f"/api/households/{hid}/expenses/{eid}", json={"amount_cents": 4000}, headers=headers1)
        client.post(f"/api/households/{hid}/expenses/{eid}/settle", headers=headers2)
        client.post(f"/api/households/{hid}/expenses/{eid}/unsettle", headers=headers2)
        client.post(
            f"/api/households/{hid}/settlements",
            json={"from_user": user2["id"], "to_user": user1["id"], "amount_cents": 2000, "date": "2026-07-12"},
            headers=headers2,
        )
        summaries = _summaries(client, headers1, hid)
        assert "a contesté la dépense « Judo » (50,00 €)" in summaries
        assert "a modifié la dépense « Judo » (50,00 € → 40,00 €)" in summaries
        assert "a marqué comme remboursée la dépense « Judo » (40,00 €)" in summaries
        assert "a annulé le remboursement de la dépense « Judo » (40,00 €)" in summaries
        assert "a enregistré un remboursement de 20,00 € de Dominique à Camille (dim. 12 juil.)" in summaries

    def test_main_only_mutations_journaled(self, client, auth_headers, db_session):
        headers, user, h = create_solo(client, auth_headers)
        hid = h["id"]
        client.patch(f"/api/households/{hid}/partner", json={"display_name": "Alex"}, headers=headers)
        vid = client.post(
            f"/api/households/{hid}/school-vacations",
            json={"label": "Spring break", "start": "2027-03-15", "end": "2027-03-19"}, headers=headers,
        ).json()["id"]
        client.delete(f"/api/households/{hid}/school-vacations/{vid}", headers=headers)
        client.patch(f"/api/households/{hid}", json={"country": "US", "name": "Maison"}, headers=headers)
        summaries = _summaries(client, headers, hid)
        assert "a renommé le second parent : L'autre parent → Alex" in summaries
        assert "a ajouté les congés scolaires « Spring break » (lun. 15 mars → ven. 19 mars)" in summaries
        assert "a supprimé les congés scolaires « Spring break » (lun. 15 mars → ven. 19 mars)" in summaries
        assert "a changé le pays : FR → US" in summaries
        assert "a renommé le foyer : Foyer Léo → Maison" in summaries

    def test_subscription_changes_journaled(self, client, auth_headers, db_session, monkeypatch):
        from app.services import billing

        headers, user, h = create_solo(client, auth_headers)
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        monkeypatch.setattr(billing.settings, "paddle_price_monthly", "pri_m")
        event = {
            "event_type": "subscription.activated",
            "data": {"id": "sub_1", "status": "active", "custom_data": {"user_id": str(user["id"])}},
        }
        raw = json.dumps(event).encode()
        h1 = hmac.new(b"sk_test", b"1:" + raw, hashlib.sha256).hexdigest()
        client.post("/api/billing/webhook", content=raw, headers={"Paddle-Signature": f"ts=1;h1={h1}"})
        monkeypatch.setattr(paddle_api, "change_price", lambda sub, price: {})
        monkeypatch.setattr(paddle_api, "cancel_subscription", lambda sub: {})
        client.post("/api/billing/change-plan", json={"plan": "monthly"}, headers=headers)
        client.post("/api/billing/cancel", headers=headers)
        summaries = _summaries(client, headers, h["id"])
        assert summaries[:3] == [
            "a programmé la résiliation de l'abonnement Premium (fin de période)",
            "a changé l'offre Premium : mensuelle",
            "a activé l'abonnement Premium",
        ]

    def test_member_left_journaled_and_household_deletion_purges(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        client.delete("/api/auth/me", headers=headers2)
        entries = _history(client, headers1, hid)
        assert entries[0]["summary"] == "a quitté le foyer (compte supprimé)"
        assert entries[0]["actor_id"] == user2["id"]
        client.delete("/api/auth/me", headers=headers1)
        assert db_session.scalars(select(AuditLog).where(AuditLog.household_id == hid)).all() == []

    def test_no_mutation_endpoints(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        hid = h["id"]
        client.post(f"/api/households/{hid}/children", json={"first_name": "Léo"}, headers=headers)
        eid = _history(client, headers, hid)[0]["id"]
        assert client.delete(f"/api/households/{hid}/history/{eid}", headers=headers).status_code in (404, 405)
        assert client.patch(f"/api/households/{hid}/history/{eid}", json={}, headers=headers).status_code in (404, 405)

    def test_isolation(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        stranger, _ = auth_headers(email="x@test.fr", name="X")
        assert client.get(f"/api/households/{h['id']}/history", headers=stranger).status_code == 404

    def test_history_exported(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers)
        data = client.get("/api/auth/me/export", headers=headers).json()
        assert data["household"]["history"][0]["summary"] == "a ajouté l'enfant Léo"

    def test_unknown_or_broken_entry_never_fails(self, client, auth_headers, db_session):
        headers, user, h = create_solo(client, auth_headers)
        audit.record(db_session, h["id"], user["id"], "expense.update", "expense", 1, {"oops": True})
        db_session.commit()
        assert _history(client, headers, h["id"])[0]["summary"] == "expense.update"


class TestHistoryCoverage:
    def test_exchanges_wall_children_journaled(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        hid = h["id"]

        def propose(day):
            return client.post(
                f"/api/households/{hid}/exceptions",
                json={"date_start": day, "date_end": day, "parent_id": user2["id"]}, headers=headers1,
            ).json()["id"]

        client.post(f"/api/households/{hid}/exceptions/{propose('2099-10-01')}/accept", json={}, headers=headers2)
        client.post(f"/api/households/{hid}/exceptions/{propose('2099-10-02')}/refuse", json={}, headers=headers2)
        client.post(f"/api/households/{hid}/exceptions/{propose('2099-10-03')}/withdraw", json={}, headers=headers1)
        post = client.post(
            f"/api/households/{hid}/wall", json={"kind": "task", "body": "Acheter des baskets"}, headers=headers1
        ).json()
        client.post(f"/api/households/{hid}/wall/{post['id']}/complete", headers=headers2)
        client.post(f"/api/households/{hid}/wall/{post['id']}/reopen", headers=headers2)
        reply = client.post(f"/api/households/{hid}/wall/{post['id']}/replies", json={"body": "OK"}, headers=headers2).json()
        client.delete(f"/api/households/{hid}/replies/{reply['id']}", headers=headers2)
        client.post(f"/api/households/{hid}/children", json={"first_name": "Léo"}, headers=headers1)

        actions = {e["action"] for e in _history(client, headers1, hid, limit=100)}
        assert {
            "exchange.propose", "exchange.accept", "exchange.refuse", "exchange.withdraw",
            "wall_post.create", "wall_post.complete", "wall_post.reopen",
            "wall_reply.create", "wall_reply.delete", "child.create", "member.join",
        } <= actions
        summaries = _summaries(client, headers1, hid)
        assert "a ajouté la tâche « Acheter des baskets »" in summaries
        assert "a marqué comme fait la tâche « Acheter des baskets »" in summaries
        assert "a répondu « OK » sur la tâche « Acheter des baskets »" in summaries
        assert any(s.startswith("a accepté l'échange : ") and "chez Dominique" in s for s in summaries)
