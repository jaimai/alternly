"""Suppression de compte + données (RGPD)."""
from sqlalchemy import select

from app.models import (
    Child,
    CustodyRule,
    Expense,
    Household,
    HouseholdMember,
    Notification,
    User,
    WallPost,
)
from tests.test_household import create_household
from tests.test_rules import premium_family, setup_family


def _seed_household_data(client, headers, hid, uid):
    client.put(
        f"/api/households/{hid}/custody-rule",
        json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": uid},
        headers=headers,
    )
    client.post(f"/api/households/{hid}/children", json={"first_name": "Léo"}, headers=headers)


class TestDeleteAccount:
    def test_solo_deletes_user_household_and_all_data(self, client, auth_headers, db_session):
        headers, user = auth_headers()
        h = create_household(client, headers)
        _seed_household_data(client, headers, h["id"], user["id"])
        # une notif pour le user
        db_session.add(Notification(user_id=user["id"], type="x", payload={}))
        db_session.commit()

        resp = client.delete("/api/auth/me", headers=headers)
        assert resp.status_code == 204, resp.text

        # le compte et toutes les données du foyer ont disparu
        assert db_session.get(User, user["id"]) is None
        assert db_session.get(Household, h["id"]) is None
        assert db_session.scalars(select(HouseholdMember).where(HouseholdMember.household_id == h["id"])).all() == []
        assert db_session.scalars(select(Child).where(Child.household_id == h["id"])).all() == []
        assert db_session.scalar(select(CustodyRule).where(CustodyRule.household_id == h["id"])) is None
        assert db_session.scalars(select(Notification).where(Notification.user_id == user["id"])).all() == []
        # le placeholder du foyer solo est aussi supprimé
        assert db_session.scalars(select(User).where(User.is_placeholder.is_(True))).all() == []

    def test_token_invalid_after_deletion(self, client, auth_headers):
        headers, _ = auth_headers()
        create_household(client, headers)
        assert client.delete("/api/auth/me", headers=headers).status_code == 204
        assert client.get("/api/auth/me", headers=headers).status_code == 401

    def test_email_freed_for_reregistration(self, client, auth_headers):
        headers, user = auth_headers()
        create_household(client, headers)
        client.delete("/api/auth/me", headers=headers)
        again = client.post(
            "/api/auth/register",
            json={"email": user["email"], "password": "motdepasse1", "display_name": "Encore"},
        )
        assert again.status_code == 201

    def test_coparent_household_survives_and_user_is_anonymized(self, client, auth_headers, db_session):
        # foyer à deux parents réels ; parent2 supprime son compte
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        _seed_household_data(client, headers1, h["id"], user1["id"])
        # parent2 crée une dépense (contenu partagé)
        client.post(
            f"/api/households/{h['id']}/expenses",
            json={"label": "Cantine", "amount_cents": 1000, "date": "2026-07-10", "category": "cantine"},
            headers=headers2,
        )
        # rend le foyer premium pour que la dépense soit acceptée
        for uid in (user1["id"], user2["id"]):
            db_session.get(User, uid).subscription_status = "active"
        db_session.commit()

        assert client.delete("/api/auth/me", headers=headers2).status_code == 204

        # le foyer et le co-parent restent
        assert db_session.get(Household, h["id"]) is not None
        assert db_session.get(User, user1["id"]) is not None
        # le parent partant est anonymisé (PII effacée, ne peut plus se connecter)
        gone = db_session.get(User, user2["id"])
        assert gone is not None
        assert gone.is_placeholder is True
        assert gone.email != "parent2@test.fr"
        assert gone.password_hash == ""
        # son e-mail est libéré : réinscription possible
        again = client.post(
            "/api/auth/register",
            json={"email": "parent2@test.fr", "password": "motdepasse1", "display_name": "X"},
        )
        assert again.status_code == 201

    def test_delete_user_without_household(self, client, auth_headers, db_session):
        headers, user = auth_headers()
        assert client.delete("/api/auth/me", headers=headers).status_code == 204
        assert db_session.get(User, user["id"]) is None
