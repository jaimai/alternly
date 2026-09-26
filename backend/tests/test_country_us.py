"""Foyer américain : pays/devise, congés manuels, fériés US, fêtes US."""
from tests.test_household import create_household


def create_us_household(client, headers):
    resp = client.post("/api/households", json={"name": "Smith family", "country": "US"}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestUsHousehold:
    def test_country_and_currency(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_us_household(client, headers)
        assert h["country"] == "US"
        assert h["currency"] == "USD"

    def test_fr_default_unchanged(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_household(client, headers)
        assert h["country"] == "FR" and h["currency"] == "EUR"

    def test_us_defaults_include_thanksgiving(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_us_household(client, headers)
        kinds = {r["kind"] for r in h["special_day_rules"]}
        assert "thanksgiving" in kinds
        assert "mothers_day" in kinds and "fathers_day" in kinds

    def test_us_household_can_skip_school_zone(self, client, auth_headers):
        headers, _ = auth_headers()
        # pas de zone fournie → accepté pour les US
        resp = client.post("/api/households", json={"name": "US fam", "country": "US"}, headers=headers)
        assert resp.status_code == 201


class TestSchoolVacations:
    def test_add_and_list(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_us_household(client, headers)
        resp = client.post(
            f"/api/households/{h['id']}/school-vacations",
            json={"label": "Winter Break", "start": "2026-12-21", "end": "2027-01-02"},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        mine = client.get("/api/households/mine", headers=headers).json()
        assert len(mine["school_vacations"]) == 1
        assert mine["school_vacations"][0]["label"] == "Winter Break"

    def test_reject_reversed_dates(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_us_household(client, headers)
        resp = client.post(
            f"/api/households/{h['id']}/school-vacations",
            json={"label": "Bad", "start": "2026-12-21", "end": "2026-12-01"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_delete(self, client, auth_headers):
        headers, _ = auth_headers()
        h = create_us_household(client, headers)
        pid = client.post(
            f"/api/households/{h['id']}/school-vacations",
            json={"label": "Spring", "start": "2026-03-16", "end": "2026-03-20"},
            headers=headers,
        ).json()["id"]
        assert client.delete(f"/api/households/{h['id']}/school-vacations/{pid}", headers=headers).status_code == 204
        assert client.get("/api/households/mine", headers=headers).json()["school_vacations"] == []


class TestUsCalendar:
    def _setup(self, client, headers, uid):
        h = create_us_household(client, headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": uid},
            headers=headers,
        )
        return h

    def test_manual_vacation_feeds_calendar(self, client, auth_headers):
        headers, user = auth_headers()
        h = self._setup(client, headers, user["id"])
        # enfant chez l'autre parent est calculé par le moteur ; on vérifie surtout
        # que la période manuelle est prise en compte (pas de 500, vacances chargées).
        client.post(
            f"/api/households/{h['id']}/school-vacations",
            json={"label": "Winter Break", "start": "2026-12-21", "end": "2027-01-02"},
            headers=headers,
        )
        # règle de partage des vacances requise pour que la période s'applique
        client.put(
            f"/api/households/{h['id']}/vacation-rule",
            json={"mode": "split_half", "even_year_first_half_parent_id": user["id"]},
            headers=headers,
        )
        resp = client.get(
            f"/api/households/{h['id']}/calendar",
            params={"start": "2026-12-15", "end": "2027-01-05"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["school_holidays_loaded"] is True
        # la période manuelle remonte dans les vacances scolaires
        labels = {p["label"] for p in body["school_holidays"]}
        assert "Winter Break" in labels
        # au moins une journée de la période est attribuée par la règle « vacances »
        assert any(d["source"] == "vacation" for d in body["days"] if "2026-12-21" <= d["date"] <= "2027-01-02")

    def test_us_federal_holiday_present(self, client, auth_headers):
        headers, user = auth_headers()
        h = self._setup(client, headers, user["id"])
        resp = client.get(
            f"/api/households/{h['id']}/calendar",
            params={"start": "2026-11-20", "end": "2026-11-30"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        holidays = {h["date"]: h["label"] for h in resp.json()["public_holidays"]}
        assert holidays.get("2026-11-26") == "Thanksgiving"  # férié fédéral US
