"""Garde-fous entre parents : demandes de changement et journal d'audit."""
from sqlalchemy import select

from app.config import settings
from app.models import AuditLog, ChangeRequest, Child, Notification, ScheduleException
from app.services.audit import euros, fr_date, fr_range
from tests.test_exchanges import create_solo
from tests.test_rules import accept_pending, setup_family

CUSTODY = {"pattern": "alternate_weeks", "start_date": "2026-01-05"}


def _custody(client, headers, hid, ref, **extra):
    return client.put(
        f"/api/households/{hid}/custody-rule", json={**CUSTODY, "reference_parent_id": ref, **extra}, headers=headers
    )


def _history(client, headers, hid, **params):
    resp = client.get(f"/api/households/{hid}/history", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _notifs(db_session, user_id, type_):
    return db_session.scalars(
        select(Notification).where(Notification.user_id == user_id, Notification.type == type_)
    ).all()


class TestFormatting:
    def test_fr_date_and_amounts(self):
        from datetime import date

        assert fr_date(date(2026, 10, 1)) == "jeu. 1 oct."
        assert fr_date(date(2026, 10, 5)) == "lun. 5 oct."
        assert fr_range(date(2026, 10, 1), date(2026, 10, 4)) == "jeu. 1 oct. → dim. 4 oct."
        assert euros(12900) == "129,00 €"
        assert euros(123456) == "1 234,56 €"


class TestOnboarding:
    def test_solo_creator_applies_directly(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        assert _custody(client, headers, h["id"], user["id"]).status_code == 200
        resp = _custody(client, headers, h["id"], user["id"], pattern="two_two_three")
        assert resp.status_code == 200 and resp.json()["pattern"] == "two_two_three"
        assert client.put(f"/api/households/{h['id']}/vacation-rule", json={"mode": "alternate_full"}, headers=headers).status_code == 200
        sd = client.put(
            f"/api/households/{h['id']}/special-day-rules",
            json=[{"kind": "christmas_day", "parent_mode": "fixed", "parent_id": user["id"], "enabled": True}],
            headers=headers,
        )
        assert sd.status_code == 200

    def test_first_rule_with_two_parents_applies_directly(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        assert _custody(client, headers1, h["id"], user1["id"]).status_code == 200
        assert client.put(f"/api/households/{h['id']}/vacation-rule", json={"mode": "split_half"}, headers=headers2).status_code == 200

    def test_then_changes_by_either_parent_need_consent(self, client, auth_headers):
        headers, user1, h = create_solo(client, auth_headers)
        assert _custody(client, headers, h["id"], user1["id"]).status_code == 200
        token = client.post(f"/api/households/{h['id']}/invitations", headers=headers).json()["token"]
        headers2, user2 = auth_headers(email="parent2@test.fr", name="Dominique")
        client.post(f"/api/invitations/{token}/accept", headers=headers2)
        assert _custody(client, headers2, h["id"], user1["id"], pattern="two_two_three").status_code == 202
        assert _custody(client, headers, h["id"], user1["id"], start_date="2026-02-02").status_code == 202

    def test_same_value_is_noop_200(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        _custody(client, headers1, h["id"], user1["id"])
        resp = _custody(client, headers1, h["id"], user1["id"])
        assert resp.status_code == 200 and resp.json()["pattern"] == "alternate_weeks"
        rules = client.get("/api/households/mine", headers=headers1).json()["special_day_rules"]
        same = client.put(f"/api/households/{h['id']}/special-day-rules", json=rules, headers=headers1)
        assert same.status_code == 200
        assert client.get(f"/api/households/{h['id']}/change-requests", headers=headers1).json() == []


class TestCustodyRequest:
    def test_request_accept_flow(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"], start_date="2026-10-05")
        resp = _custody(client, headers1, hid, user1["id"], pattern="two_two_three", start_date="2026-10-05")
        assert resp.status_code == 202
        cr = resp.json()["change_request"]
        assert cr["kind"] == "custody_rule" and cr["status"] == "pending"
        assert cr["requested_by"] == user1["id"] and cr["resolved_by"] is None
        assert cr["summary"] == "Rythme de garde : semaine/semaine → 2-2-3, départ le lun. 5 oct."
        # rien n'est appliqué tant que l'autre n'a pas accepté
        assert client.get("/api/households/mine", headers=headers1).json()["custody_rule"]["pattern"] == "alternate_weeks"
        notif = _notifs(db_session, user2["id"], "change_requested")
        assert len(notif) == 1 and notif[0].payload["summary"] == cr["summary"]

        listing = client.get(f"/api/households/{hid}/change-requests", headers=headers2).json()
        assert [c["id"] for c in listing] == [cr["id"]]

        # le demandeur ne peut pas accepter sa propre demande
        assert client.post(f"/api/households/{hid}/change-requests/{cr['id']}/accept", headers=headers1).status_code == 403
        done = client.post(f"/api/households/{hid}/change-requests/{cr['id']}/accept", headers=headers2)
        assert done.status_code == 200
        assert done.json()["status"] == "accepted" and done.json()["resolved_by"] == user2["id"]
        assert client.get("/api/households/mine", headers=headers1).json()["custody_rule"]["pattern"] == "two_two_three"
        assert len(_notifs(db_session, user1["id"], "change_accepted")) == 1
        # plus en attente
        assert client.get(f"/api/households/{hid}/change-requests", headers=headers2).json() == []
        assert len(client.get(f"/api/households/{hid}/change-requests?status=all", headers=headers2).json()) == 1
        again = client.post(f"/api/households/{hid}/change-requests/{cr['id']}/accept", headers=headers2)
        assert again.status_code == 409

    def test_refuse(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"])
        rid = _custody(client, headers1, hid, user1["id"], pattern="two_two_three").json()["change_request"]["id"]
        assert client.post(f"/api/households/{hid}/change-requests/{rid}/refuse", headers=headers1).status_code == 403
        resp = client.post(f"/api/households/{hid}/change-requests/{rid}/refuse", headers=headers2)
        assert resp.status_code == 200 and resp.json()["status"] == "refused"
        assert client.get("/api/households/mine", headers=headers1).json()["custody_rule"]["pattern"] == "alternate_weeks"
        notif = _notifs(db_session, user1["id"], "change_refused")
        assert len(notif) == 1 and "2-2-3" in notif[0].payload["summary"]

    def test_withdraw_only_by_requester(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"])
        rid = _custody(client, headers1, hid, user1["id"], pattern="two_two_three").json()["change_request"]["id"]
        assert client.post(f"/api/households/{hid}/change-requests/{rid}/withdraw", headers=headers2).status_code == 403
        resp = client.post(f"/api/households/{hid}/change-requests/{rid}/withdraw", headers=headers1)
        assert resp.status_code == 200 and resp.json()["status"] == "withdrawn"

    def test_new_request_supersedes_previous(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"])
        first = _custody(client, headers1, hid, user1["id"], pattern="two_two_three").json()["change_request"]
        second = _custody(client, headers1, hid, user1["id"], pattern="every_other_weekend").json()["change_request"]
        pending = client.get(f"/api/households/{hid}/change-requests", headers=headers2).json()
        assert [c["id"] for c in pending] == [second["id"]]
        all_ = {c["id"]: c["status"] for c in client.get(f"/api/households/{hid}/change-requests?status=all", headers=headers2).json()}
        assert all_[first["id"]] == "withdrawn"
        # une demande de l'autre parent, du même type, ne remplace pas celle-ci
        other = _custody(client, headers2, hid, user1["id"], pattern="custom", custom_weeks=["ref"] * 7 + ["other"] * 7)
        assert other.status_code == 202
        assert len(client.get(f"/api/households/{hid}/change-requests", headers=headers2).json()) == 2

    def test_accept_revalidates_and_marks_refused(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"])
        rid = _custody(client, headers1, hid, user1["id"], pattern="two_two_three").json()["change_request"]["id"]
        # charge utile devenue invalide (parent de référence inconnu)
        cr = db_session.get(ChangeRequest, rid)
        cr.payload = {**cr.payload, "reference_parent_id": 9999}
        db_session.commit()
        resp = client.post(f"/api/households/{hid}/change-requests/{rid}/accept", headers=headers2)
        assert resp.status_code == 409
        db_session.refresh(cr)
        assert cr.status == "refused"

    def test_validation_still_422(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        _custody(client, headers1, h["id"], user1["id"])
        assert _custody(client, headers1, h["id"], user1["id"], pattern="lunaire").status_code == 422

    def test_isolation(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        _custody(client, headers1, h["id"], user1["id"])
        rid = _custody(client, headers1, h["id"], user1["id"], pattern="two_two_three").json()["change_request"]["id"]
        stranger, _ = auth_headers(email="x@test.fr", name="X")
        sh = client.post("/api/households", json={"name": "Autre", "school_zone": "A"}, headers=stranger).json()
        assert client.get(f"/api/households/{h['id']}/change-requests", headers=stranger).status_code == 404
        assert client.post(f"/api/households/{sh['id']}/change-requests/{rid}/accept", headers=stranger).status_code == 404


class TestOtherKinds:
    def test_vacation_request(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        client.put(f"/api/households/{hid}/vacation-rule", json={"mode": "split_half"}, headers=headers1)
        resp = client.put(f"/api/households/{hid}/vacation-rule", json={"mode": "alternate_full"}, headers=headers1)
        assert resp.status_code == 202
        assert resp.json()["change_request"]["summary"] == "Vacances : partage par moitié → vacances entières alternées"
        accept_pending(client, headers2, hid, resp)
        assert client.get("/api/households/mine", headers=headers1).json()["vacation_rule"]["mode"] == "alternate_full"

    def test_special_days_request(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        resp = client.put(
            f"/api/households/{hid}/special-day-rules",
            json=[
                {"kind": "mothers_day", "parent_mode": "auto", "enabled": False},
                {"kind": "christmas_day", "parent_mode": "fixed", "parent_id": user2["id"], "enabled": True},
            ],
            headers=headers1,
        )
        assert resp.status_code == 202
        summary = resp.json()["change_request"]["summary"]
        assert summary.startswith("Jours de fête : ")
        assert "Fête des mères désactivée" in summary
        assert "Jour de Noël activé" in summary and "toujours chez Dominique" in summary
        accept_pending(client, headers2, hid, resp)
        rules = {r["kind"]: r for r in client.get("/api/households/mine", headers=headers1).json()["special_day_rules"]}
        assert rules["mothers_day"]["enabled"] is False
        assert rules["christmas_day"]["parent_id"] == user2["id"]

    def test_delete_child_request(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        cid = client.post(f"/api/households/{hid}/children", json={"first_name": "Léo"}, headers=headers1).json()["id"]
        resp = client.delete(f"/api/households/{hid}/children/{cid}", headers=headers1)
        assert resp.status_code == 202
        assert resp.json()["change_request"]["summary"] == "Retirer l'enfant Léo"
        assert resp.json()["change_request"]["kind"] == "delete_child"
        # même demande répétée : pas de doublon
        again = client.delete(f"/api/households/{hid}/children/{cid}", headers=headers1)
        assert again.json()["change_request"]["id"] == resp.json()["change_request"]["id"]
        assert db_session.get(Child, cid) is not None
        accept_pending(client, headers2, hid, resp)
        db_session.expire_all()
        assert db_session.get(Child, cid) is None

    def test_delete_child_target_gone_409(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        cid = client.post(f"/api/households/{hid}/children", json={"first_name": "Léo"}, headers=headers1).json()["id"]
        rid = client.delete(f"/api/households/{hid}/children/{cid}", headers=headers1).json()["change_request"]["id"]
        db_session.delete(db_session.get(Child, cid))
        db_session.commit()
        resp = client.post(f"/api/households/{hid}/change-requests/{rid}/accept", headers=headers2)
        assert resp.status_code == 409
        assert db_session.get(ChangeRequest, rid).status == "refused"
        assert len(_notifs(db_session, user1["id"], "change_refused")) == 1

    def test_solo_delete_child_direct(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        cid = client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers).json()["id"]
        assert client.delete(f"/api/households/{h['id']}/children/{cid}", headers=headers).status_code == 204

    def _accepted_exchange(self, client, headers1, headers2, hid, parent_id, day="2099-10-01"):
        eid = client.post(
            f"/api/households/{hid}/exceptions",
            json={"date_start": day, "date_end": day, "parent_id": parent_id}, headers=headers1,
        ).json()["id"]
        client.post(f"/api/households/{hid}/exceptions/{eid}/accept", json={}, headers=headers2)
        return eid

    def test_cancel_accepted_exchange_request(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        eid = self._accepted_exchange(client, headers1, headers2, hid, user1["id"], "2026-10-01")
        resp = client.delete(f"/api/households/{hid}/exceptions/{eid}", headers=headers2)
        assert resp.status_code == 202
        cr = resp.json()["change_request"]
        assert cr["kind"] == "cancel_exchange"
        assert cr["summary"] == "Annuler l'échange du jeu. 1 oct. (chez Camille)"
        assert db_session.get(ScheduleException, eid) is not None
        client.post(f"/api/households/{hid}/change-requests/{cr['id']}/accept", headers=headers1)
        db_session.expire_all()
        assert db_session.get(ScheduleException, eid) is None

    def test_pending_exchange_delete_only_by_creator(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        eid = client.post(
            f"/api/households/{hid}/exceptions",
            json={"date_start": "2099-10-01", "date_end": "2099-10-01", "parent_id": user1["id"]}, headers=headers1,
        ).json()["id"]
        assert client.delete(f"/api/households/{hid}/exceptions/{eid}", headers=headers2).status_code == 403
        assert client.delete(f"/api/households/{hid}/exceptions/{eid}", headers=headers1).status_code == 204

    def test_other_parent_left_applies_directly(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"])
        pending = _custody(client, headers1, hid, user1["id"], pattern="two_two_three")
        assert pending.status_code == 202
        client.request("DELETE", "/api/auth/me", json={"password": "motdepasse1"}, headers=headers2)
        # demandes en attente closes au départ du parent
        assert db_session.get(ChangeRequest, pending.json()["change_request"]["id"]).status == "withdrawn"
        resp = _custody(client, headers1, hid, user1["id"], pattern="two_two_three")
        assert resp.status_code == 200 and resp.json()["pattern"] == "two_two_three"

    def test_rate_limited(self, client, auth_headers, monkeypatch):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"], start_date="2025-12-01")
        monkeypatch.setattr(settings, "rate_limit_enabled", True)
        codes = [
            _custody(client, headers1, hid, user1["id"], start_date=f"2026-01-{d:02d}").status_code
            for d in range(1, 32)
        ]
        assert codes[:30] == [202] * 30 and codes[30] == 429


class TestHistory:
    def test_mutations_are_journaled(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
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
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"], start_date="2026-10-05")
        resp = _custody(client, headers1, hid, user1["id"], pattern="two_two_three", start_date="2026-10-05")
        accept_pending(client, headers2, hid, resp)
        summaries = [e["summary"] for e in _history(client, headers1, hid)]
        assert "a modifié le rythme de garde : semaine/semaine → 2-2-3, départ le lun. 5 oct." in summaries
        assert any(s.startswith("a accepté le changement : Rythme de garde") for s in summaries)
        assert any(s.startswith("a demandé un changement : Rythme de garde") for s in summaries)
        entry = db_session.scalars(
            select(AuditLog).where(AuditLog.action == "custody_rule.update").order_by(AuditLog.id.desc())
        ).first()
        assert entry.actor_id == user1["id"]
        assert entry.data["before"]["pattern"] == "alternate_weeks" and entry.data["after"]["pattern"] == "two_two_three"

    def test_expense_dispute_journal(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        eid = client.post(
            f"/api/households/{hid}/expenses",
            json={"label": "Judo", "amount_cents": 5000, "date": "2026-07-10", "category": "activites"},
            headers=headers1,
        ).json()["id"]
        client.post(f"/api/households/{hid}/expenses/{eid}/dispute", json={}, headers=headers2)
        client.patch(f"/api/households/{hid}/expenses/{eid}", json={"amount_cents": 4000}, headers=headers1)
        client.post(f"/api/households/{hid}/expenses/{eid}/resolve", json={}, headers=headers2)
        client.post(
            f"/api/households/{hid}/settlements",
            json={"from_user": user2["id"], "to_user": user1["id"], "amount_cents": 2000, "date": "2026-07-12"},
            headers=headers2,
        )
        summaries = [e["summary"] for e in _history(client, headers1, hid)]
        assert "a contesté la dépense « Judo » (50,00 €)" in summaries
        assert "a modifié la dépense « Judo » (50,00 € → 40,00 €)" in summaries
        assert "a levé la contestation sur la dépense « Judo » (40,00 €)" in summaries
        assert "a enregistré un remboursement de 20,00 € de Dominique à Camille (dim. 12 juil.)" in summaries

    def test_member_left_journaled_and_household_deletion_purges(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        client.request("DELETE", "/api/auth/me", json={"password": "motdepasse1"}, headers=headers2)
        entries = _history(client, headers1, hid)
        assert entries[0]["summary"] == "a quitté le foyer (compte supprimé)"
        assert entries[0]["actor_id"] == user2["id"]
        client.request("DELETE", "/api/auth/me", json={"password": "motdepasse1"}, headers=headers1)
        assert db_session.scalars(select(AuditLog).where(AuditLog.household_id == hid)).all() == []

    def test_no_mutation_endpoints(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        hid = h["id"]
        client.post(f"/api/households/{hid}/children", json={"first_name": "Léo"}, headers=headers)
        eid = _history(client, headers, hid)[0]["id"]
        assert client.delete(f"/api/households/{hid}/history/{eid}", headers=headers).status_code in (404, 405)
        assert client.patch(f"/api/households/{hid}/history/{eid}", json={}, headers=headers).status_code in (404, 405)

    def test_history_exported(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers)
        data = client.get("/api/auth/me/export", headers=headers).json()
        assert data["household"]["history"][0]["summary"] == "a ajouté l'enfant Léo"


class TestHistoryCoverage:
    def test_exchanges_wall_children_journaled(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
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
        summaries = [e["summary"] for e in _history(client, headers1, hid, limit=100)]
        assert "a ajouté la tâche « Acheter des baskets »" in summaries
        assert any(s.startswith("a accepté l'échange : ") and "chez Dominique" in s for s in summaries)


class TestPaywallOnConsent:
    def test_read_only_parent_cannot_answer_requests(self, client, auth_headers, db_session, monkeypatch):
        from datetime import timedelta

        from app.models import User, utcnow

        monkeypatch.setattr(settings, "stripe_secret_key", "sk_test")
        monkeypatch.setattr(settings, "stripe_price_id", "price_1")
        monkeypatch.setattr(settings, "paywall_mode", "read_only")
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        _custody(client, headers1, hid, user1["id"])
        rid = _custody(client, headers1, hid, user1["id"], pattern="two_two_three").json()["change_request"]["id"]
        u2 = db_session.get(User, user2["id"])
        u2.trial_ends_at = utcnow() - timedelta(days=1)
        db_session.commit()
        # lecture possible, réponse (écriture) refusée : choix documenté
        assert client.get(f"/api/households/{hid}/change-requests", headers=headers2).status_code == 200
        assert client.post(f"/api/households/{hid}/change-requests/{rid}/accept", headers=headers2).status_code == 402
