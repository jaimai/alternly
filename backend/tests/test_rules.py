from sqlalchemy import select

from app.models import Notification
from tests.test_household import create_household


def setup_family(client, auth_headers):
    """Foyer complet à deux parents. Retourne (headers1, user1, headers2, user2, household)."""
    headers1, user1 = auth_headers()
    h = create_household(client, headers1)
    token = client.post(f"/api/households/{h['id']}/invitations", headers=headers1).json()["token"]
    headers2, user2 = auth_headers(email="parent2@test.fr", name="Dominique", color="#cc6633")
    client.post(f"/api/invitations/{token}/accept", headers=headers2)
    return headers1, user1, headers2, user2, h


class TestCustodyRule:
    def test_upsert(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        resp = client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["pattern"] == "alternate_weeks"
        # ré-upsert : modifie au lieu de dupliquer
        resp2 = client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "two_two_three", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        assert resp2.json()["pattern"] == "two_two_three"

    def test_invalid_pattern(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        resp = client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "lunaire", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        assert resp.status_code == 422

    def test_foreign_parent_rejected(self, client, auth_headers):
        headers1, _, _, _, h = setup_family(client, auth_headers)
        resp = client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": 9999},
            headers=headers1,
        )
        assert resp.status_code == 422

    def test_custom_requires_14_entries(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        resp = client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={
                "pattern": "custom", "start_date": "2026-01-05",
                "reference_parent_id": user1["id"], "custom_weeks": ["ref"] * 5,
            },
            headers=headers1,
        )
        assert resp.status_code == 422

    def test_rule_change_notifies_other_parent(self, client, auth_headers, db_session):
        headers1, user1, _, user2, h = setup_family(client, auth_headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user2["id"], Notification.type == "rule_changed")
        ).all()
        assert len(notifs) == 1


class TestVacationRule:
    def test_upsert(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        resp = client.put(
            f"/api/households/{h['id']}/vacation-rule",
            json={"mode": "split_half", "even_year_first_half_parent_id": user1["id"]},
            headers=headers1,
        )
        assert resp.status_code == 200
        assert resp.json()["mode"] == "split_half"


class TestExceptions:
    def test_create_notifies_and_lists(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        resp = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"], "note": "échange"},
            headers=headers1,
        )
        assert resp.status_code == 201
        listing = client.get(f"/api/households/{h['id']}/exceptions", headers=headers2)
        assert len(listing.json()) == 1
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user2["id"], Notification.type == "exchange_proposed")
        ).all()
        assert len(notifs) == 1

    def test_end_before_start_422(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        resp = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2026-03-05", "date_end": "2026-03-04", "parent_id": user1["id"]},
            headers=headers1,
        )
        assert resp.status_code == 422

    def test_delete(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        eid = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2026-03-04", "date_end": "2026-03-05", "parent_id": user1["id"]},
            headers=headers1,
        ).json()["id"]
        assert client.delete(f"/api/households/{h['id']}/exceptions/{eid}", headers=headers1).status_code == 204
        assert client.get(f"/api/households/{h['id']}/exceptions", headers=headers1).json() == []
