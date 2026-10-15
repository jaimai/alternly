"""« Ajuster mon planning » : jours personnalisés (exceptions d'un jour, kind=adjustment)."""
from datetime import date, timedelta

from app.models import AuditLog, ScheduleException
from tests.test_household import create_household
from tests.test_rules import setup_family

# Lundi de référence (rythme semaine/semaine) et une semaine à venir chez parent 1.
BASE = date.today() - timedelta(days=date.today().weekday() + 7 * 10)
WEEK1 = BASE + timedelta(weeks=12)  # semaine paire depuis BASE → parent de référence


def set_rule(client, headers, hid, ref_id):
    resp = client.put(
        f"/api/households/{hid}/custody-rule",
        json={"pattern": "alternate_weeks", "start_date": BASE.isoformat(), "reference_parent_id": ref_id},
        headers=headers,
    )
    assert resp.status_code in (200, 202), resp.text


def calendar(client, headers, hid, start, end):
    resp = client.get(
        f"/api/households/{hid}/calendar",
        params={"start": start.isoformat(), "end": end.isoformat()},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return {d["date"]: d for d in resp.json()["days"]}


def solo_household(client, auth_headers):
    headers, user = auth_headers()
    h = create_household(client, headers)
    other = next(m["id"] for m in h["members"] if m["id"] != user["id"])
    set_rule(client, headers, h["id"], user["id"])
    return headers, user, h, other


def adjust(client, headers, hid, **body):
    return client.post(f"/api/households/{hid}/adjustments", json=body, headers=headers)


class TestSolo:
    def test_days_apply_directly_without_touching_the_rule(self, client, auth_headers, db_session):
        headers, user, h, other = solo_household(client, auth_headers)
        d1, d2 = WEEK1 + timedelta(days=3), WEEK1 + timedelta(days=4)
        resp = adjust(client, headers, h["id"], set=[
            {"date": d1.isoformat(), "parent_id": other},
            {"date": d2.isoformat(), "parent_id": other},
        ])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "applied", "created": 2, "cleared": 0}

        days = calendar(client, headers, h["id"], WEEK1, WEEK1 + timedelta(days=6))
        assert days[d1.isoformat()]["parent_id"] == other
        assert days[d1.isoformat()]["source"] == "adjustment"
        assert days[(WEEK1 + timedelta(days=5)).isoformat()]["parent_id"] == user["id"]  # rythme intact
        rows = db_session.query(ScheduleException).filter_by(household_id=h["id"]).all()
        assert {(r.kind, r.status, r.date_start == r.date_end) for r in rows} == {("adjustment", "accepted", True)}
        log = db_session.query(AuditLog).filter_by(household_id=h["id"], action="adjustment.apply").one()
        assert log.data["solo"] is True and len(log.data["days"]) == 2

    def test_clear_puts_day_back_on_rhythm(self, client, auth_headers):
        headers, user, h, other = solo_household(client, auth_headers)
        d1 = WEEK1 + timedelta(days=2)
        adjust(client, headers, h["id"], set=[{"date": d1.isoformat(), "parent_id": other}])
        exc = client.get(f"/api/households/{h['id']}/exceptions", headers=headers).json()[0]
        assert exc["kind"] == "adjustment"
        resp = adjust(client, headers, h["id"], clear=[exc["id"]])
        assert resp.json() == {"status": "applied", "created": 0, "cleared": 1}
        days = calendar(client, headers, h["id"], d1, d1)
        assert days[d1.isoformat()]["parent_id"] == user["id"]
        assert days[d1.isoformat()]["source"] == "rule"

    def test_resetting_a_day_replaces_the_previous_adjustment(self, client, auth_headers, db_session):
        headers, user, h, other = solo_household(client, auth_headers)
        d1 = WEEK1 + timedelta(days=1)
        adjust(client, headers, h["id"], set=[{"date": d1.isoformat(), "parent_id": other}])
        adjust(client, headers, h["id"], set=[{"date": d1.isoformat(), "parent_id": user["id"]}])
        rows = db_session.query(ScheduleException).filter_by(household_id=h["id"], kind="adjustment").all()
        assert [(r.parent_id, r.status) for r in rows] == [(user["id"], "accepted")]

    def test_adjustment_wins_over_an_exchange_on_the_same_day(self, client, auth_headers):
        headers, user, h, other = solo_household(client, auth_headers)
        start = WEEK1 + timedelta(days=1)
        client.post(f"/api/households/{h['id']}/exceptions", json={
            "date_start": start.isoformat(), "date_end": (start + timedelta(days=3)).isoformat(),
            "parent_id": other,
        }, headers=headers)
        d = start + timedelta(days=1)
        adjust(client, headers, h["id"], set=[{"date": d.isoformat(), "parent_id": user["id"]}])
        days = calendar(client, headers, h["id"], start, start + timedelta(days=3))
        assert days[d.isoformat()]["parent_id"] == user["id"]
        assert days[start.isoformat()]["parent_id"] == other  # le reste de l'échange tient

    def test_validation(self, client, auth_headers):
        headers, user, h, other = solo_household(client, auth_headers)
        assert adjust(client, headers, h["id"]).status_code == 422
        far = date.today() + timedelta(days=900)
        assert adjust(client, headers, h["id"], set=[{"date": far.isoformat(), "parent_id": other}]).status_code == 422
        assert adjust(client, headers, h["id"], clear=[999999]).status_code == 404


class TestWithOtherParent:
    def test_days_are_proposed_together_then_accepted(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        set_rule(client, headers1, h["id"], user1["id"])
        d1, d2 = WEEK1 + timedelta(days=3), WEEK1 + timedelta(days=4)
        resp = adjust(client, headers1, h["id"], set=[
            {"date": d1.isoformat(), "parent_id": user2["id"]},
            {"date": d2.isoformat(), "parent_id": user2["id"]},
        ], note="déplacement pro")
        assert resp.json()["status"] == "proposed"
        rows = db_session.query(ScheduleException).filter_by(household_id=h["id"], kind="adjustment").all()
        assert {r.status for r in rows} == {"pending"} and len({r.group_id for r in rows}) == 1
        # rien ne change tant que l'autre parent n'a pas accepté
        assert calendar(client, headers1, h["id"], d1, d1)[d1.isoformat()]["parent_id"] == user1["id"]
        for r in rows:
            ok = client.post(f"/api/households/{h['id']}/exceptions/{r.id}/accept", json={}, headers=headers2)
            assert ok.status_code == 200, ok.text
        assert calendar(client, headers1, h["id"], d1, d1)[d1.isoformat()]["parent_id"] == user2["id"]

    def test_clearing_an_agreed_day_needs_consent(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        set_rule(client, headers1, h["id"], user1["id"])
        d1 = WEEK1 + timedelta(days=2)
        adjust(client, headers1, h["id"], set=[{"date": d1.isoformat(), "parent_id": user2["id"]}])
        exc = db_session.query(ScheduleException).filter_by(household_id=h["id"], kind="adjustment").one()
        client.post(f"/api/households/{h['id']}/exceptions/{exc.id}/accept", json={}, headers=headers2)
        resp = adjust(client, headers1, h["id"], clear=[exc.id])
        assert resp.json() == {"status": "pending_consent", "created": 0, "cleared": 0}
        db_session.refresh(exc)
        assert exc.status == "accepted"


def test_history_lists_customised_days(client, auth_headers):
    headers, user, h, other = solo_household(client, auth_headers)
    d1 = WEEK1 + timedelta(days=3)
    adjust(client, headers, h["id"], set=[{"date": d1.isoformat(), "parent_id": other}])
    exc = client.get(f"/api/households/{h['id']}/exceptions", headers=headers).json()[0]
    adjust(client, headers, h["id"], clear=[exc["id"]])
    resp = client.get(f"/api/households/{h['id']}/history", headers=headers)
    assert resp.status_code == 200, resp.text
    summaries = [e["summary"] for e in resp.json()]
    assert any(s.startswith("a personnalisé 1 jour : ") for s in summaries), summaries
    assert any(s.startswith("a remis au rythme habituel : ") for s in summaries), summaries
