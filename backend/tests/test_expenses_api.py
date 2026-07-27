"""API dépenses partagées : CRUD, contestation, remboursements, solde."""
from sqlalchemy import select

from app.models import Notification
from tests.test_rules import premium_family


def add_expense(client, headers, hid, *, amount=1000, paid_by=None, label="Cantine", percent=50):
    body = {"label": label, "amount_cents": amount, "date": "2026-07-10", "category": "cantine", "payer_percent": percent}
    if paid_by is not None:
        body["paid_by"] = paid_by
    return client.post(f"/api/households/{hid}/expenses", json=body, headers=headers)


class TestExpenseCrud:
    def test_create_defaults_paid_by_creator_and_notifies(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        resp = add_expense(client, headers1, h["id"])
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["paid_by"] == user1["id"]
        assert body["status"] == "active"
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user2["id"], Notification.type == "expense_added")
        ).all()
        assert len(notifs) == 1

    def test_invalid_amount_rejected(self, client, auth_headers, db_session):
        headers1, user1, _, _, h = premium_family(client, auth_headers, db_session)
        resp = client.post(
            f"/api/households/{h['id']}/expenses",
            json={"label": "x", "amount_cents": 0, "date": "2026-07-10", "category": "autre"},
            headers=headers1,
        )
        assert resp.status_code == 422

    def test_invalid_category_rejected(self, client, auth_headers, db_session):
        headers1, user1, _, _, h = premium_family(client, auth_headers, db_session)
        resp = client.post(
            f"/api/households/{h['id']}/expenses",
            json={"label": "x", "amount_cents": 500, "date": "2026-07-10", "category": "licorne"},
            headers=headers1,
        )
        assert resp.status_code == 422

    def test_creator_edits_and_deletes(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"]).json()["id"]
        patch = client.patch(f"/api/households/{h['id']}/expenses/{eid}", json={"amount_cents": 2000}, headers=headers1)
        assert patch.status_code == 200 and patch.json()["amount_cents"] == 2000
        # l'autre parent ne peut pas éditer
        forbidden = client.patch(f"/api/households/{h['id']}/expenses/{eid}", json={"amount_cents": 3000}, headers=headers2)
        assert forbidden.status_code == 403
        assert client.delete(f"/api/households/{h['id']}/expenses/{eid}", headers=headers1).status_code == 204


class TestDispute:
    def test_non_payer_disputes_and_excluded_from_balance(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"], amount=1000).json()["id"]
        # avant contestation : B doit 500
        bal = client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()
        assert bal["amount_cents"] == 500 and bal["debtor_id"] == user2["id"]
        # B conteste
        d = client.post(f"/api/households/{h['id']}/expenses/{eid}/dispute", json={"dispute_note": "pas d'accord"}, headers=headers2)
        assert d.status_code == 200 and d.json()["status"] == "disputed"
        bal2 = client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()
        assert bal2["amount_cents"] == 0
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user1["id"], Notification.type == "expense_disputed")
        ).all()
        assert len(notifs) == 1

    def test_payer_cannot_dispute_own(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"]).json()["id"]
        resp = client.post(f"/api/households/{h['id']}/expenses/{eid}/dispute", json={}, headers=headers1)
        assert resp.status_code == 403

    def test_resolve_reactivates(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"]).json()["id"]
        client.post(f"/api/households/{h['id']}/expenses/{eid}/dispute", json={}, headers=headers2)
        r = client.post(f"/api/households/{h['id']}/expenses/{eid}/resolve", json={}, headers=headers1)
        assert r.status_code == 200 and r.json()["status"] == "active"


class TestSettlements:
    def test_settlement_updates_balance_and_notifies(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        add_expense(client, headers1, h["id"], amount=1000)  # B doit 500 à A
        s = client.post(
            f"/api/households/{h['id']}/settlements",
            json={"from_user": user2["id"], "to_user": user1["id"], "amount_cents": 500, "date": "2026-07-12"},
            headers=headers2,
        )
        assert s.status_code == 201, s.text
        bal = client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()
        assert bal["amount_cents"] == 0
        notifs = db_session.scalars(
            select(Notification).where(Notification.type == "settlement_recorded")
        ).all()
        assert len(notifs) == 1

    def test_creator_deletes_settlement(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        sid = client.post(
            f"/api/households/{h['id']}/settlements",
            json={"from_user": user2["id"], "to_user": user1["id"], "amount_cents": 500, "date": "2026-07-12"},
            headers=headers2,
        ).json()["id"]
        assert client.delete(f"/api/households/{h['id']}/settlements/{sid}", headers=headers2).status_code == 204


class TestIsolation:
    def test_other_household_cannot_read(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        add_expense(client, headers1, h["id"])
        stranger, stranger_user = auth_headers(email="stranger@test.fr", name="X")
        # stranger premium (sinon 402 avant le contrôle d'appartenance) : on teste l'isolation.
        from app.models import User
        db_session.get(User, stranger_user["id"]).subscription_status = "active"
        db_session.commit()
        resp = client.get(f"/api/households/{h['id']}/expenses", headers=stranger)
        assert resp.status_code == 404
