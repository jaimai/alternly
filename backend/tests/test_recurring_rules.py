"""Règles qui se répètent : jours de la semaine et périodes de l'année."""
from datetime import date, timedelta

from app.models import ChangeRequest
from app.services.custody_engine import EngineRecurringRule, EngineRule, EngineVacationRule, Period, resolve_calendar
from tests.test_household import create_household
from tests.test_rules import setup_family

RULE = EngineRule(pattern="alternate_weeks", start_date=date(2026, 1, 5), reference_parent="A", other_parent="B")
VAC = EngineVacationRule(mode="split_half", even_year_first_half_parent="A")
WINTER = Period("Hiver", date(2026, 2, 7), date(2026, 2, 22))


def resolve(start, end, rules, periods=(), vac=VAC):
    days = resolve_calendar(RULE, vac, [], [], list(periods), start, end, recurring_rules=rules)
    return {a.day: a for a in days}


class TestEngine:
    def test_every_wednesday_with_b_outside_holidays(self):
        rr = EngineRecurringRule(kind="weekly", parent="B", other="A", weekdays=(2,))
        days = resolve(date(2026, 1, 5), date(2026, 2, 28), [rr], [WINTER])
        assert days[date(2026, 1, 7)].parent == "B" and days[date(2026, 1, 7)].source == "recurring"
        assert days[date(2026, 1, 8)].parent == "A"  # jeudi : rythme habituel
        assert days[date(2026, 2, 11)].source == "vacation"  # mercredi pendant les vacances

    def test_every_other_week_and_include_vacations(self):
        rr = EngineRecurringRule(kind="weekly", parent="B", other="A", weekdays=(2,), every_other_week=True,
                                 anchor=date(2026, 2, 9), include_vacations=True)
        days = resolve(date(2026, 2, 9), date(2026, 2, 22), [rr], [WINTER])
        assert days[date(2026, 2, 11)].parent == "B" and days[date(2026, 2, 11)].source == "recurring"
        assert days[date(2026, 2, 18)].source == "vacation"  # semaine suivante : pas concernée

    def test_yearly_period_alternates_and_beats_holidays(self):
        rr = EngineRecurringRule(kind="yearly", parent="A", other="B", start_md=(7, 1), end_md=(7, 31), alternate=True)
        summer = [Period("Été", date(2026, 7, 4), date(2026, 8, 31)), Period("Été", date(2027, 7, 3), date(2027, 8, 31))]
        days = resolve(date(2026, 6, 30), date(2027, 8, 1), [rr], summer)
        assert days[date(2026, 7, 20)].parent == "A" and days[date(2026, 7, 20)].source == "recurring"
        assert days[date(2027, 7, 20)].parent == "B"
        assert days[date(2026, 8, 1)].source == "vacation"

    def test_yearly_period_over_new_year(self):
        rr = EngineRecurringRule(kind="yearly", parent="B", other="A", start_md=(12, 30), end_md=(1, 2))
        days = resolve(date(2026, 12, 28), date(2027, 1, 4), [rr], vac=None)
        assert [days[date(2026, 12, 28) + timedelta(i)].source for i in range(8)] == (
            ["rule", "rule"] + ["recurring"] * 4 + ["rule", "rule"]
        )


def put(client, headers, hid, rules):
    return client.put(f"/api/households/{hid}/recurring-rules", json=rules, headers=headers)


class TestApi:
    def test_solo_applies_and_calendar_uses_it(self, client, auth_headers):
        headers, user = auth_headers()
        h = create_household(client, headers)
        other = next(m["id"] for m in h["members"] if m["id"] != user["id"])
        client.put(f"/api/households/{h['id']}/custody-rule", json={
            "pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user["id"],
        }, headers=headers)
        resp = put(client, headers, h["id"], [{"kind": "weekly", "parent_id": other, "weekdays": [2]}])
        assert resp.status_code == 200, resp.text
        assert resp.json()[0]["weekdays"] == [2]
        household = client.get("/api/households/mine", headers=headers).json()
        assert len(household["recurring_rules"]) == 1
        # Un mercredi d'une semaine « chez moi », hors vacances (zone sans calendrier en test).
        wed = date(2026, 1, 7)
        cal = client.get(f"/api/households/{h['id']}/calendar", params={"start": wed, "end": wed}, headers=headers)
        assert cal.json()["days"][0]["parent_id"] == other

    def test_validation(self, client, auth_headers):
        headers, user = auth_headers()
        h = create_household(client, headers)
        assert put(client, headers, h["id"], [{"kind": "weekly", "parent_id": user["id"], "weekdays": []}]).status_code == 422
        too_long = {"kind": "yearly", "parent_id": user["id"], "start_md": "01-01", "end_md": "12-31"}
        assert put(client, headers, h["id"], [too_long]).status_code == 422
        bad_date = {"kind": "yearly", "parent_id": user["id"], "start_md": "02-30", "end_md": "03-02"}
        assert put(client, headers, h["id"], [bad_date]).status_code == 422

    def test_two_parents_need_consent(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        resp = put(client, headers1, h["id"], [
            {"kind": "yearly", "parent_id": user1["id"], "start_md": "07-01", "end_md": "07-31", "alternate": True},
        ])
        assert resp.status_code in (200, 202), resp.text
        cr = db_session.query(ChangeRequest).filter_by(household_id=h["id"], kind="recurring_rules").one()
        assert cr.status == "pending"
        ok = client.post(f"/api/households/{h['id']}/change-requests/{cr.id}/accept", headers=headers2)
        assert ok.status_code == 200, ok.text
        household = client.get("/api/households/mine", headers=headers1).json()
        assert household["recurring_rules"][0]["alternate"] is True


def test_nulls_from_the_app_are_accepted(client, auth_headers):
    headers, user = auth_headers()
    h = create_household(client, headers)
    rule = {"kind": "yearly", "parent_id": user["id"], "weekdays": None, "every_other_week": False,
            "anchor_date": None, "include_vacations": False, "start_md": "07-01", "end_md": "07-31", "alternate": True}
    assert put(client, headers, h["id"], [rule]).status_code == 200


def test_whats_new_seen_is_stored_per_account(client, auth_headers):
    headers, _ = auth_headers()
    assert client.get("/api/auth/me", headers=headers).json()["whats_new_seen"] is None
    r = client.patch("/api/auth/me", json={"whats_new_seen": "2026-10-calendar-tools"}, headers=headers)
    assert r.status_code == 200 and r.json()["whats_new_seen"] == "2026-10-calendar-tools"
