from datetime import date, timedelta

from app.models import PublicHolidayCache, SchoolHolidayCache
from app.services.custody_engine import DayAssignment
from app.services.ical_export import build_ics, merge_blocks
from tests.test_rules import setup_family


class TestMergeBlocks:
    def test_merges_consecutive_days_same_parent(self):
        days = [
            DayAssignment(date(2026, 1, 5), "A", "rule"),
            DayAssignment(date(2026, 1, 6), "A", "rule"),
            DayAssignment(date(2026, 1, 7), "B", "rule"),
            DayAssignment(date(2026, 1, 8), "B", "rule"),
            DayAssignment(date(2026, 1, 9), "A", "rule"),
        ]
        assert merge_blocks(days) == [
            (date(2026, 1, 5), date(2026, 1, 6), "A"),
            (date(2026, 1, 7), date(2026, 1, 8), "B"),
            (date(2026, 1, 9), date(2026, 1, 9), "A"),
        ]

    def test_non_consecutive_same_parent_not_merged(self):
        days = [
            DayAssignment(date(2026, 1, 5), "A", "rule"),
            DayAssignment(date(2026, 1, 7), "A", "rule"),
        ]
        assert len(merge_blocks(days)) == 2


class TestBuildIcs:
    def test_valid_structure_and_dtend_exclusive(self):
        days = [
            DayAssignment(date(2026, 1, 5), "1", "rule"),
            DayAssignment(date(2026, 1, 6), "1", "rule"),
        ]
        ics = build_ics(days, {"1": "Camille"}, "tok12345")
        assert ics.startswith("BEGIN:VCALENDAR\r\n")
        assert ics.rstrip().endswith("END:VCALENDAR")
        assert "DTSTART;VALUE=DATE:20260105" in ics
        assert "DTEND;VALUE=DATE:20260107" in ics  # exclusif : lendemain du dernier jour
        assert "SUMMARY:🏠 Chez Camille" in ics


class TestIcalEndpoint:
    def seed(self, db_session):
        today = date.today()
        for y in {today.year - 1, today.year, today.year + 1}:
            db_session.add(PublicHolidayCache(date=date(y, 12, 25), label=f"Noël {y}"))
            for sy in (f"{y-1}-{y}", f"{y}-{y+1}"):
                db_session.add(
                    SchoolHolidayCache(
                        zone="B", label=f"Vacances test {sy}-{y}",
                        start=date(y, 2, 7), end=date(y, 2, 22), school_year=sy,
                    )
                )
        db_session.commit()

    def test_feed_and_regenerate(self, client, auth_headers, db_session):
        headers1, user1, _, _, h = setup_family(client, auth_headers)
        self.seed(db_session)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        me = client.get("/api/auth/me", headers=headers1)
        # le token iCal n'est pas exposé par /me : on le récupère via regenerate
        token = client.post("/api/ical/regenerate", headers=headers1).json()["ical_token"]

        resp = client.get(f"/api/ical/{token}.ics")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/calendar")
        assert "BEGIN:VEVENT" in resp.text
        assert "Chez Camille" in resp.text or "Chez Dominique" in resp.text

        # régénération : l'ancien lien meurt
        new = client.post("/api/ical/regenerate", headers=headers1).json()["ical_token"]
        assert client.get(f"/api/ical/{token}.ics").status_code == 404
        assert client.get(f"/api/ical/{new}.ics").status_code == 200


class TestNotifications:
    def test_list_and_mark_read(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2026-03-04", "date_end": "2026-03-04", "parent_id": user1["id"], "note": "x"},
            headers=headers1,
        )
        notifs = client.get("/api/notifications", headers=headers2).json()
        types = {n["type"] for n in notifs}
        assert "exchange_proposed" in types
        unread_ids = [n["id"] for n in notifs if n["read_at"] is None]
        assert unread_ids
        client.post("/api/notifications/read", json={"ids": unread_ids}, headers=headers2)
        notifs2 = client.get("/api/notifications", headers=headers2).json()
        assert all(n["read_at"] is not None for n in notifs2)
