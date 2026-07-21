from datetime import date

from app.models import PublicHolidayCache, SchoolHolidayCache
from tests.test_rules import setup_family


def seed_public_data(db_session):
    """Préremplit les caches pour éviter tout appel réseau."""
    db_session.add(PublicHolidayCache(date=date(2026, 5, 1), label="1er mai"))
    db_session.add(
        SchoolHolidayCache(
            zone="B", label="Vacances d'Hiver",
            start=date(2026, 2, 7), end=date(2026, 2, 22), school_year="2025-2026",
        )
    )
    # années scolaires adjacentes : cache non vide pour court-circuiter l'API
    db_session.add(
        SchoolHolidayCache(
            zone="B", label="Vacances de Noël",
            start=date(2026, 12, 19), end=date(2027, 1, 3), school_year="2026-2027",
        )
    )
    db_session.commit()


class TestCalendarEndpoint:
    def test_calendar_happy_path(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        seed_public_data(db_session)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        client.put(
            f"/api/households/{h['id']}/vacation-rule",
            json={"mode": "split_half", "even_year_first_half_parent_id": user1["id"]},
            headers=headers1,
        )
        resp = client.get(
            f"/api/households/{h['id']}/calendar",
            params={"start": "2026-01-05", "end": "2026-03-01"},
            headers=headers2,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        days = {d["date"]: d for d in data["days"]}

        # semaine 0 → parent1, semaine 1 → parent2
        assert days["2026-01-05"]["parent_id"] == user1["id"]
        assert days["2026-01-12"]["parent_id"] == user2["id"]
        # vacances d'hiver 2026 (année paire, 16 jours) : 1re moitié parent1
        assert days["2026-02-07"]["source"] == "vacation"
        assert days["2026-02-07"]["parent_id"] == user1["id"]
        assert days["2026-02-22"]["parent_id"] == user2["id"]
        # décorations
        assert data["school_holidays"][0]["label"] == "Vacances d'Hiver"
        assert data["school_holidays_loaded"] is True
        assert data["members"][0]["display_name"] == "Camille"

    def test_no_rule_409(self, client, auth_headers, db_session):
        headers1, _, _, _, h = setup_family(client, auth_headers)
        seed_public_data(db_session)
        resp = client.get(
            f"/api/households/{h['id']}/calendar",
            params={"start": "2026-01-05", "end": "2026-01-11"},
            headers=headers1,
        )
        assert resp.status_code == 409

    def test_range_too_large_422(self, client, auth_headers):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        resp = client.get(
            f"/api/households/{h['id']}/calendar",
            params={"start": "2026-01-01", "end": "2028-06-01"},
            headers=headers1,
        )
        assert resp.status_code == 422
