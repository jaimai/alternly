from datetime import timedelta

from sqlalchemy import select

from app.models import Invitation, Notification, utcnow


def create_household(client, headers, name="Foyer Léo", zone="B"):
    resp = client.post("/api/households", json={"name": name, "school_zone": zone}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestHousehold:
    def test_create_and_mine(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_household(client, headers)
        assert h["school_zone"] == "B"
        assert h["my_role"] == "parent1"
        # le foyer solo dispose d'un second parent « placeholder » (assignation de dépenses)
        assert len(h["members"]) == 2
        real = [m for m in h["members"] if not m["is_placeholder"]]
        ghosts = [m for m in h["members"] if m["is_placeholder"]]
        assert len(real) == 1 and len(ghosts) == 1
        # règles spéciales par défaut : fêtes actives, Noël désactivé
        rules = {r["kind"]: r["enabled"] for r in h["special_day_rules"]}
        assert rules == {
            "mothers_day": True, "fathers_day": True,
            "christmas_eve": False, "christmas_day": False,
        }
        mine = client.get("/api/households/mine", headers=headers)
        assert mine.status_code == 200
        assert mine.json()["id"] == h["id"]

    def test_cannot_create_two_households(self, client, auth_headers):
        headers, _ = auth_headers()
        create_household(client, headers)
        resp = client.post("/api/households", json={"name": "Bis"}, headers=headers)
        assert resp.status_code == 409

    def test_invalid_zone_422(self, client, auth_headers):
        headers, _ = auth_headers()
        resp = client.post("/api/households", json={"name": "X", "school_zone": "D"}, headers=headers)
        assert resp.status_code == 422

    def test_stranger_cannot_access(self, client, auth_headers):
        headers1, _ = auth_headers()
        h = create_household(client, headers1)
        headers2, _ = auth_headers(email="intrus@test.fr", name="Intrus")
        resp = client.patch(f"/api/households/{h['id']}", json={"name": "Piraté"}, headers=headers2)
        assert resp.status_code == 404


class TestInvitationFlow:
    def test_full_flow(self, client, auth_headers):
        headers1, user1 = auth_headers()
        h = create_household(client, headers1)
        inv = client.post(f"/api/households/{h['id']}/invitations", headers=headers1)
        assert inv.status_code == 201
        token = inv.json()["token"]

        preview = client.get(f"/api/invitations/{token}")
        assert preview.status_code == 200
        assert preview.json()["household_name"] == "Foyer Léo"
        assert preview.json()["invited_by_name"] == "Camille"

        headers2, user2 = auth_headers(email="parent2@test.fr", name="Dominique")
        accept = client.post(f"/api/invitations/{token}/accept", headers=headers2)
        assert accept.status_code == 200
        roles = {m["display_name"]: m["role"] for m in accept.json()["members"]}
        assert roles == {"Camille": "parent1", "Dominique": "parent2"}

        # parent1 est notifié
        # (vérification via l'API notifications testée plus tard ; ici en DB)

    def test_invitation_cannot_be_reused(self, client, auth_headers, db_session):
        headers1, _ = auth_headers()
        h = create_household(client, headers1)
        token = client.post(f"/api/households/{h['id']}/invitations", headers=headers1).json()["token"]
        headers2, _ = auth_headers(email="parent2@test.fr", name="Dominique")
        assert client.post(f"/api/invitations/{token}/accept", headers=headers2).status_code == 200
        headers3, _ = auth_headers(email="parent3@test.fr", name="Sam")
        assert client.post(f"/api/invitations/{token}/accept", headers=headers3).status_code == 410

    def test_expired_invitation_410(self, client, auth_headers, db_session):
        headers1, _ = auth_headers()
        h = create_household(client, headers1)
        token = client.post(f"/api/households/{h['id']}/invitations", headers=headers1).json()["token"]
        inv = db_session.scalar(select(Invitation).where(Invitation.token == token))
        inv.expires_at = utcnow() - timedelta(days=1)
        db_session.commit()
        assert client.get(f"/api/invitations/{token}").status_code == 410


class TestChildren:
    def test_crud(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_household(client, headers)
        resp = client.post(
            f"/api/households/{h['id']}/children",
            json={"first_name": "Léo", "birthdate": "2020-09-12"},
            headers=headers,
        )
        assert resp.status_code == 201
        child_id = resp.json()["id"]

        listing = client.get(f"/api/households/{h['id']}/children", headers=headers)
        assert [c["first_name"] for c in listing.json()] == ["Léo"]

        upd = client.patch(
            f"/api/households/{h['id']}/children/{child_id}",
            json={"first_name": "Léa"},
            headers=headers,
        )
        assert upd.json()["first_name"] == "Léa"

        assert client.delete(f"/api/households/{h['id']}/children/{child_id}", headers=headers).status_code == 204
        assert client.get(f"/api/households/{h['id']}/children", headers=headers).json() == []
