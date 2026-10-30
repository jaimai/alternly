"""Journal de garde : notes privées à leur auteur, réservées au premium, exportables."""
from sqlalchemy import select

from app.models import AuditLog, JournalEntry, Notification, User
from tests.test_rules import premium_family, setup_family


def add(client, headers, hid, **kw):
    body = {"day": "2026-10-12", "time": "18:20", "kind": "late", "body": "Arrivée à 18h20 au lieu de 18h."}
    body.update(kw)
    return client.post(f"/api/households/{hid}/journal", json=body, headers=headers)


class TestJournalCrud:
    def test_create_list_edit_delete(self, client, auth_headers, db_session):
        headers1, _, _, _, h = premium_family(client, auth_headers, db_session)
        resp = add(client, headers1, h["id"])
        assert resp.status_code == 201, resp.text
        eid = resp.json()["id"]
        add(client, headers1, h["id"], day="2026-10-20", time=None, kind="handover", body="Passage normal.")

        listed = client.get(f"/api/households/{h['id']}/journal", headers=headers1).json()
        assert [e["day"] for e in listed] == ["2026-10-20", "2026-10-12"]  # plus récent d'abord

        patched = client.patch(
            f"/api/households/{h['id']}/journal/{eid}", json={"body": "Arrivée à 18h25.", "time": None}, headers=headers1
        )
        assert patched.status_code == 200
        assert patched.json()["time"] is None and patched.json()["edited_at"] is not None

        assert client.delete(f"/api/households/{h['id']}/journal/{eid}", headers=headers1).status_code == 204
        assert len(client.get(f"/api/households/{h['id']}/journal", headers=headers1).json()) == 1

    def test_filters_by_period_and_kind(self, client, auth_headers, db_session):
        headers1, _, _, _, h = premium_family(client, auth_headers, db_session)
        add(client, headers1, h["id"], day="2026-09-01", kind="health", body="Fièvre.")
        add(client, headers1, h["id"], day="2026-10-01", kind="late")
        url = f"/api/households/{h['id']}/journal"
        assert len(client.get(url, params={"start": "2026-09-15"}, headers=headers1).json()) == 1
        assert len(client.get(url, params={"kind": "health"}, headers=headers1).json()) == 1

    def test_invalid_input_rejected(self, client, auth_headers, db_session):
        headers1, _, _, _, h = premium_family(client, auth_headers, db_session)
        assert add(client, headers1, h["id"], kind="rumeur").status_code == 422
        assert add(client, headers1, h["id"], body="").status_code == 422
        assert add(client, headers1, h["id"], time="25:00").status_code == 422
        assert add(client, headers1, h["id"], child_id=999999).status_code == 422


class TestJournalPrivacy:
    def test_other_parent_cannot_see_or_touch(self, client, auth_headers, db_session):
        headers1, _, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add(client, headers1, h["id"]).json()["id"]
        assert client.get(f"/api/households/{h['id']}/journal", headers=headers2).json() == []
        assert client.patch(
            f"/api/households/{h['id']}/journal/{eid}", json={"body": "x"}, headers=headers2
        ).status_code == 404
        assert client.delete(f"/api/households/{h['id']}/journal/{eid}", headers=headers2).status_code == 404
        export = client.get(f"/api/households/{h['id']}/journal/export", headers=headers2).json()
        assert export["entries"] == []

    def test_no_notification_nor_household_history(self, client, auth_headers, db_session):
        headers1, _, _, user2, h = premium_family(client, auth_headers, db_session)
        before_audit = db_session.scalar(select(AuditLog.id).order_by(AuditLog.id.desc()).limit(1))
        add(client, headers1, h["id"])
        notifs = db_session.scalars(select(Notification).where(Notification.user_id == user2["id"])).all()
        assert not any("journal" in n.type for n in notifs)
        after_audit = db_session.scalar(select(AuditLog.id).order_by(AuditLog.id.desc()).limit(1))
        assert after_audit == before_audit

    def test_requires_premium(self, client, auth_headers):
        headers1, _, _, _, h = setup_family(client, auth_headers)
        assert client.get(f"/api/households/{h['id']}/journal", headers=headers1).status_code == 402
        assert add(client, headers1, h["id"]).status_code == 402


class TestJournalExport:
    def test_export_includes_context(self, client, auth_headers, db_session):
        headers1, user1, _, _, h = premium_family(client, auth_headers, db_session)
        child = client.post(f"/api/households/{h['id']}/children", json={"first_name": "Léo"}, headers=headers1).json()
        add(client, headers1, h["id"], child_id=child["id"])
        add(client, headers1, h["id"], day="2027-01-05", kind="school", body="Réunion parents-profs.")
        resp = client.get(
            f"/api/households/{h['id']}/journal/export", params={"start": "2026-10-01", "end": "2026-12-31"},
            headers=headers1,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["author_name"] == user1["display_name"]
        assert len(data["entries"]) == 1  # bornes respectées
        assert data["children"][str(child["id"])] == "Léo"
        assert data["scheduled"] == {}  # pas de règle de garde : rien de « prévu »

    def test_export_reports_scheduled_parent(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        rule = client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        assert rule.status_code in (200, 202), rule.text
        add(client, headers1, h["id"], day="2026-01-06")
        scheduled = client.get(f"/api/households/{h['id']}/journal/export", headers=headers1).json()["scheduled"]
        assert scheduled == {"2026-01-06": user1["display_name"]}  # semaine du parent de référence

    def test_bad_range_rejected(self, client, auth_headers, db_session):
        headers1, _, _, _, h = premium_family(client, auth_headers, db_session)
        resp = client.get(
            f"/api/households/{h['id']}/journal/export", params={"start": "2026-12-01", "end": "2026-01-01"},
            headers=headers1,
        )
        assert resp.status_code == 422


class TestJournalAccount:
    def test_deleted_with_account_and_in_data_export(self, client, auth_headers, db_session):
        headers1, user1, _, _, h = premium_family(client, auth_headers, db_session)
        add(client, headers1, h["id"])
        export = client.get("/api/auth/me/export", headers=headers1)
        assert len(export.json()["household"]["journal_entries"]) == 1
        from app.services.account import delete_account

        delete_account(db_session, db_session.get(User, user1["id"]))
        db_session.commit()
        assert db_session.scalars(select(JournalEntry)).all() == []
