"""Mur de communication : posts typés, réponses, complétion, tâches au calendrier."""
from datetime import date, timedelta

from sqlalchemy import select

from app.models import Notification
from tests.test_rules import setup_family


def post(client, headers, hid, **kw):
    body = {"kind": "message", "body": "Coucou"}
    body.update(kw)
    return client.post(f"/api/households/{hid}/wall", json=body, headers=headers)


class TestPostCrud:
    def test_create_message_notifies(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        resp = post(client, headers1, h["id"], kind="message", body="Léo a un exposé lundi")
        assert resp.status_code == 201, resp.text
        assert resp.json()["kind"] == "message"
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user2["id"], Notification.type == "wall_post_added")
        ).all()
        assert len(notifs) == 1

    def test_invalid_kind_rejected(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        resp = post(client, headers1, h["id"], kind="rumeur")
        assert resp.status_code == 422

    def test_empty_body_rejected(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        resp = post(client, headers1, h["id"], body="")
        assert resp.status_code == 422

    def test_author_edits_and_deletes(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        pid = post(client, headers1, h["id"]).json()["id"]
        assert client.patch(f"/api/households/{h['id']}/wall/{pid}", json={"body": "corrigé"}, headers=headers1).status_code == 200
        # non-auteur interdit
        assert client.patch(f"/api/households/{h['id']}/wall/{pid}", json={"body": "x"}, headers=headers2).status_code == 403
        assert client.delete(f"/api/households/{h['id']}/wall/{pid}", headers=headers1).status_code == 204


class TestTaskAssignment:
    def test_assigned_task_notifies_assignee(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        post(client, headers1, h["id"], kind="task", body="Rendre le dossier", assigned_to=user2["id"])
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user2["id"], Notification.type == "wall_task_assigned")
        ).all()
        assert len(notifs) == 1


class TestCompletion:
    def test_complete_and_reopen(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        pid = post(client, headers1, h["id"], kind="task", body="Devoirs").json()["id"]
        done = client.post(f"/api/households/{h['id']}/wall/{pid}/complete", headers=headers2)
        assert done.status_code == 200 and done.json()["completed_at"] is not None
        assert done.json()["completed_by"] == user2["id"]
        reopened = client.post(f"/api/households/{h['id']}/wall/{pid}/reopen", headers=headers1)
        assert reopened.status_code == 200 and reopened.json()["completed_at"] is None


class TestReplies:
    def test_reply_notifies_and_lists(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        pid = post(client, headers1, h["id"], kind="question", body="On inscrit Léo au foot ?").json()["id"]
        r = client.post(f"/api/households/{h['id']}/wall/{pid}/replies", json={"body": "Oui !"}, headers=headers2)
        assert r.status_code == 201, r.text
        listing = client.get(f"/api/households/{h['id']}/wall", headers=headers1).json()
        target = next(p for p in listing if p["id"] == pid)
        assert len(target["replies"]) == 1 and target["replies"][0]["body"] == "Oui !"
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user1["id"], Notification.type == "wall_reply_added")
        ).all()
        assert len(notifs) == 1

    def test_only_author_deletes_reply(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        pid = post(client, headers1, h["id"]).json()["id"]
        rid = client.post(f"/api/households/{h['id']}/wall/{pid}/replies", json={"body": "hey"}, headers=headers2).json()["id"]
        assert client.delete(f"/api/households/{h['id']}/replies/{rid}", headers=headers1).status_code == 403
        assert client.delete(f"/api/households/{h['id']}/replies/{rid}", headers=headers2).status_code == 204


class TestCalendarTasks:
    def test_dated_task_appears_in_calendar(self, client, auth_headers):
        headers1, user1, _, user2, h = setup_family(client, auth_headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        due = "2026-07-15"
        post(client, headers1, h["id"], kind="task", body="Vaccin Léo", due_date=due)
        cal = client.get(f"/api/households/{h['id']}/calendar?start=2026-07-01&end=2026-07-31", headers=headers1).json()
        assert any(t["due_date"] == due and t["body"] == "Vaccin Léo" for t in cal["tasks"])

    def test_completed_task_not_in_calendar(self, client, auth_headers):
        headers1, user1, _, user2, h = setup_family(client, auth_headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        pid = post(client, headers1, h["id"], kind="task", body="Fait", due_date="2026-07-15").json()["id"]
        client.post(f"/api/households/{h['id']}/wall/{pid}/complete", headers=headers1)
        cal = client.get(f"/api/households/{h['id']}/calendar?start=2026-07-01&end=2026-07-31", headers=headers1).json()
        assert cal["tasks"] == []
