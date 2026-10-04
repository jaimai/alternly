"""Garde-fous entre parents : demandes de changement soumises à l'accord de l'autre."""
from sqlalchemy import select

from app.config import settings
from app.models import AuditLog, ChangeRequest, Child, Notification, ScheduleException
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
        eid = self._accepted_exchange(client, headers1, headers2, hid, user1["id"], "2037-10-01")
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
        client.delete("/api/auth/me", headers=headers2)
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



class TestMainSpecifics:
    def test_placeholder_partner_cannot_consent_applies_directly(self, client, auth_headers):
        # Foyer solo : le second parent est un placeholder (sans compte) → pas de demande.
        headers, user, h = create_solo(client, auth_headers)
        members = client.get("/api/households/mine", headers=headers).json()["members"]
        ghost = next(m for m in members if m["is_placeholder"])
        assert _custody(client, headers, h["id"], user["id"]).status_code == 200
        resp = _custody(client, headers, h["id"], ghost["id"], pattern="two_two_three")
        assert resp.status_code == 200 and resp.json()["reference_parent_id"] == ghost["id"]
        cid = client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers).json()["id"]
        assert client.delete(f"/api/households/{h['id']}/children/{cid}", headers=headers).status_code == 204
        assert client.get(f"/api/households/{h['id']}/change-requests", headers=headers).json() == []

    def test_works_on_free_tier(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        assert client.get("/api/billing/status", headers=headers1).json()["access"] is False
        _custody(client, headers1, h["id"], user1["id"])
        resp = _custody(client, headers1, h["id"], user1["id"], pattern="two_two_three")
        accept_pending(client, headers2, h["id"], resp)

    def test_summaries_in_reader_and_recipient_locale(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        client.patch("/api/auth/me", json={"locale": "en"}, headers=headers2)
        _custody(client, headers1, hid, user1["id"], start_date="2026-10-05")
        resp = _custody(client, headers1, hid, user1["id"], pattern="two_two_three", start_date="2026-10-05")
        fr = "Rythme de garde : semaine/semaine → 2-2-3, départ le lun. 5 oct."
        en = "Custody schedule: week on/week off → 2-2-3, starting Mon, Oct 5"
        assert resp.json()["change_request"]["summary"] == fr
        # notification rédigée dans la langue du destinataire
        assert _notifs(db_session, user2["id"], "change_requested")[0].payload["summary"] == en
        assert client.get(f"/api/households/{hid}/change-requests", headers=headers2).json()[0]["summary"] == en
        done = client.post(
            f"/api/households/{hid}/change-requests/{resp.json()['change_request']['id']}/accept", headers=headers2
        )
        assert done.json()["summary"] == en
        assert _notifs(db_session, user1["id"], "change_accepted")[0].payload["summary"] == fr
        history = client.get(f"/api/households/{hid}/history", headers=headers2).json()
        assert history[0]["summary"] == f"accepted the change: {en}"

    def test_cancel_exchange_with_counter_proposal(self, client, auth_headers, db_session):
        # Échange accepté remplacé par une contre-proposition : l'annulation ne casse pas la clé étrangère.
        from sqlalchemy import text

        db_session.execute(text("PRAGMA foreign_keys=ON"))
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        hid = h["id"]
        eid = client.post(
            f"/api/households/{hid}/exceptions",
            json={"date_start": "2099-10-01", "date_end": "2099-10-01", "parent_id": user1["id"]}, headers=headers1,
        ).json()["id"]
        client.post(f"/api/households/{hid}/exceptions/{eid}/accept", json={}, headers=headers2)
        client.post(
            f"/api/households/{hid}/exceptions",
            json={"date_start": "2099-10-02", "date_end": "2099-10-02", "parent_id": user1["id"], "replaces_id": eid},
            headers=headers2,
        )
        resp = client.delete(f"/api/households/{hid}/exceptions/{eid}", headers=headers2)
        accept_pending(client, headers1, hid, resp)
        db_session.expire_all()
        assert db_session.get(ScheduleException, eid) is None

    def test_change_request_exported(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        _custody(client, headers1, h["id"], user1["id"])
        _custody(client, headers1, h["id"], user1["id"], pattern="two_two_three")
        crs = client.get("/api/auth/me/export", headers=headers2).json()["household"]["change_requests"]
        assert crs[0]["kind"] == "custody_rule" and crs[0]["summary"].startswith("Rythme de garde")
