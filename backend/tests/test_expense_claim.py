"""Demande de remboursement imprimable (parcours solo : l'autre parent n'a pas de compte)."""
from tests.test_expenses_api import add_expense
from tests.test_expenses_v2 import premium_solo
from tests.test_rules import premium_family


def claim(client, headers, hid, **params):
    return client.get(f"/api/households/{hid}/expenses/claim", params=params, headers=headers)


class TestExpenseClaim:
    def test_solo_parent_claims_open_expenses(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        add_expense(client, headers1, h["id"], amount=1000)  # 50 % → 5,00 dus
        add_expense(client, headers1, h["id"], amount=3333, percent=40, label="Orthodontiste")  # 60 % → 20,00 dus
        resp = claim(client, headers1, h["id"])
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["author_name"] == user1["display_name"]
        assert data["other_name"]  # nom du parent placeholder
        assert [line["owed_cents"] for line in data["lines"]] == [500, 2000]
        assert data["total_paid_cents"] == 4333 and data["total_owed_cents"] == 2500

    def test_excludes_settled_disputed_and_other_payer(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        keep = add_expense(client, headers1, h["id"], label="Garde").json()["id"]
        settled = add_expense(client, headers1, h["id"], label="Réglée").json()["id"]
        disputed = add_expense(client, headers1, h["id"], label="Contestée").json()["id"]
        add_expense(client, headers2, h["id"], label="Payée par l'autre")
        base = f"/api/households/{h['id']}/expenses"
        assert client.post(f"{base}/{settled}/settle", headers=headers1).status_code in (200, 201)
        assert client.post(f"{base}/{disputed}/dispute", json={"dispute_note": "?"}, headers=headers2).status_code == 200
        ids = [line["id"] for line in claim(client, headers1, h["id"]).json()["lines"]]
        assert ids == [keep]

    def test_period_filter_and_bad_range(self, client, auth_headers, db_session):
        headers1, _, h, _ = premium_solo(client, auth_headers, db_session)
        add_expense(client, headers1, h["id"])  # 2026-07-10
        assert claim(client, headers1, h["id"], start="2026-08-01").json()["lines"] == []
        assert len(claim(client, headers1, h["id"], start="2026-07-01", end="2026-07-31").json()["lines"]) == 1
        assert claim(client, headers1, h["id"], start="2026-08-01", end="2026-07-01").status_code == 422
