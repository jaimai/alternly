"""Dépenses v2 : marquer réglé, second parent sans compte (placeholder), visu rapide."""
from sqlalchemy import select

from app.models import HouseholdMember, Notification, User
from tests.test_household import create_household
from tests.test_rules import premium_family


def premium_solo(client, auth_headers, db_session):
    """Foyer à un seul parent réel (le 2e est un placeholder auto-créé).

    Retourne (headers1, user1, household, placeholder_id).
    """
    headers1, user1 = auth_headers()
    h = create_household(client, headers1)
    db_session.get(User, user1["id"]).subscription_status = "active"
    db_session.commit()
    members = client.get("/api/households/mine", headers=headers1).json()["members"]
    placeholder = next(m for m in members if m["id"] != user1["id"])
    return headers1, user1, h, placeholder["id"]


def add_expense(client, headers, hid, *, amount=1000, paid_by=None, percent=50):
    body = {"label": "Cantine", "amount_cents": amount, "date": "2026-07-10", "category": "cantine", "payer_percent": percent}
    if paid_by is not None:
        body["paid_by"] = paid_by
    return client.post(f"/api/households/{hid}/expenses", json=body, headers=headers)


class TestSettleExpense:
    def test_settle_marks_and_excludes_from_balance(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"], amount=1000).json()["id"]
        # avant : B doit 500
        assert client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()["amount_cents"] == 500
        # je marque la dépense remboursée
        resp = client.post(f"/api/households/{h['id']}/expenses/{eid}/settle", headers=headers1)
        assert resp.status_code == 200, resp.text
        assert resp.json()["settled_at"] is not None
        # le solde repart à zéro
        assert client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()["amount_cents"] == 0

    def test_unsettle_restores(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"], amount=1000).json()["id"]
        client.post(f"/api/households/{h['id']}/expenses/{eid}/settle", headers=headers1)
        resp = client.post(f"/api/households/{h['id']}/expenses/{eid}/unsettle", headers=headers1)
        assert resp.status_code == 200 and resp.json()["settled_at"] is None
        assert client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()["amount_cents"] == 500

    def test_settle_notifies_other_parent(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"]).json()["id"]
        client.post(f"/api/households/{h['id']}/expenses/{eid}/settle", headers=headers1)
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user2["id"], Notification.type == "expense_settled")
        ).all()
        assert len(notifs) == 1


class TestQuickView:
    def test_balance_exposes_directional_outstanding(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        add_expense(client, headers1, h["id"], amount=1000)          # j'avance → on me doit 500
        add_expense(client, headers2, h["id"], amount=400)           # l'autre avance → je dois 200
        bal = client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()
        assert bal["owed_to_me_cents"] == 500
        assert bal["i_owe_cents"] == 200

    def test_perspective_is_per_user(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        add_expense(client, headers1, h["id"], amount=1000)
        bal2 = client.get(f"/api/households/{h['id']}/balance", headers=headers2).json()
        assert bal2["owed_to_me_cents"] == 0 and bal2["i_owe_cents"] == 500


class TestPlaceholderParent:
    def test_solo_household_has_placeholder_second_parent(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        members = client.get("/api/households/mine", headers=headers1).json()["members"]
        assert len(members) == 2
        ph = next(m for m in members if m["id"] == placeholder_id)
        assert ph["is_placeholder"] is True
        me = next(m for m in members if m["id"] == user1["id"])
        assert me["is_placeholder"] is False

    def test_placeholder_does_not_grant_premium(self, client, auth_headers, db_session):
        # un foyer dont seul le placeholder « existe » ne doit jamais être premium
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        db_session.get(User, user1["id"]).subscription_status = "free"
        db_session.commit()
        resp = client.get(f"/api/households/{h['id']}/expenses", headers=headers1)
        assert resp.status_code == 402

    def test_assign_expense_to_placeholder_counts_in_balance(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        # je paie, la part revient au 2e parent (placeholder) → on me doit 500
        add_expense(client, headers1, h["id"], amount=1000, paid_by=user1["id"])
        bal = client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()
        assert bal["owed_to_me_cents"] == 500
        assert bal["debtor_id"] == placeholder_id

    def test_can_name_the_second_parent(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        resp = client.patch(f"/api/households/{h['id']}/partner", json={"display_name": "Camille"}, headers=headers1)
        assert resp.status_code == 200, resp.text
        members = client.get("/api/households/mine", headers=headers1).json()["members"]
        assert next(m for m in members if m["id"] == placeholder_id)["display_name"] == "Camille"

    def test_real_parent_claims_placeholder_and_keeps_expenses(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        eid = add_expense(client, headers1, h["id"], amount=1000, paid_by=user1["id"]).json()["id"]
        # le vrai 2e parent rejoint le foyer
        token = client.post(f"/api/households/{h['id']}/invitations", headers=headers1).json()["token"]
        headers2, user2 = auth_headers(email="real2@test.fr", name="Réel", color="#cc6633")
        accept = client.post(f"/api/invitations/{token}/accept", headers=headers2)
        assert accept.status_code == 200, accept.text
        # le placeholder a disparu, remplacé par le vrai compte
        members = client.get("/api/households/mine", headers=headers1).json()["members"]
        ids = {m["id"] for m in members}
        assert len(members) == 2 and placeholder_id not in ids and user2["id"] in ids
        assert db_session.get(User, placeholder_id) is None
        assert db_session.scalar(
            select(HouseholdMember).where(HouseholdMember.user_id == placeholder_id)
        ) is None
        # la dépense assignée au placeholder pointe désormais vers le vrai parent
        bal = client.get(f"/api/households/{h['id']}/balance", headers=headers1).json()
        assert bal["debtor_id"] == user2["id"] and bal["owed_to_me_cents"] == 500
