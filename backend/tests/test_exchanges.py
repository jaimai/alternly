"""Flux d'échange proposer/accepter (V1) sur ScheduleException."""
from datetime import date, timedelta

from sqlalchemy import select

from app.models import Notification, ScheduleException
from tests.test_household import create_household
from tests.test_rules import setup_family


def create_solo(client, auth_headers):
    """Foyer à un seul parent. Retourne (headers, user, household)."""
    headers, user = auth_headers()
    h = create_household(client, headers)
    return headers, user, h


def iso(d: date) -> str:
    return d.isoformat()


class TestProposalCreation:
    def test_two_parents_creates_pending(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        resp = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"], "note": "échange"},
            headers=headers1,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"

    def test_two_parents_notifies_recipient_as_proposed(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        )
        notifs = db_session.scalars(
            select(Notification).where(
                Notification.user_id == user2["id"], Notification.type == "exchange_proposed"
            )
        ).all()
        assert len(notifs) == 1

    def test_solo_creates_accepted(self, client, auth_headers):
        headers, user, h = create_solo(client, auth_headers)
        resp = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user["id"]},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "accepted"


class TestAcceptRefuseWithdraw:
    def _propose(self, client, headers, h, parent_id, start="2099-03-04", end="2099-03-04"):
        return client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": start, "date_end": end, "parent_id": parent_id},
            headers=headers,
        ).json()["id"]

    def test_recipient_accepts(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        eid = self._propose(client, headers1, h, user2["id"])
        resp = client.post(
            f"/api/households/{h['id']}/exceptions/{eid}/accept",
            json={"response_note": "ok pour moi"},
            headers=headers2,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "accepted"
        assert body["resolved_by"] == user2["id"]
        assert body["response_note"] == "ok pour moi"
        # le proposeur est notifié
        notifs = db_session.scalars(
            select(Notification).where(
                Notification.user_id == user1["id"], Notification.type == "exchange_accepted"
            )
        ).all()
        assert len(notifs) == 1

    def test_proposer_cannot_accept(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        eid = self._propose(client, headers1, h, user2["id"])
        resp = client.post(
            f"/api/households/{h['id']}/exceptions/{eid}/accept", json={}, headers=headers1
        )
        assert resp.status_code == 403

    def test_recipient_refuses_with_note(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        eid = self._propose(client, headers1, h, user2["id"])
        resp = client.post(
            f"/api/households/{h['id']}/exceptions/{eid}/refuse",
            json={"response_note": "impossible"},
            headers=headers2,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "refused"
        assert resp.json()["response_note"] == "impossible"
        notifs = db_session.scalars(
            select(Notification).where(
                Notification.user_id == user1["id"], Notification.type == "exchange_refused"
            )
        ).all()
        assert len(notifs) == 1

    def test_proposer_withdraws(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        eid = self._propose(client, headers1, h, user2["id"])
        resp = client.post(
            f"/api/households/{h['id']}/exceptions/{eid}/withdraw", json={}, headers=headers1
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "withdrawn"
        notifs = db_session.scalars(
            select(Notification).where(
                Notification.user_id == user2["id"], Notification.type == "exchange_withdrawn"
            )
        ).all()
        assert len(notifs) == 1

    def test_recipient_cannot_withdraw(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        eid = self._propose(client, headers1, h, user2["id"])
        resp = client.post(
            f"/api/households/{h['id']}/exceptions/{eid}/withdraw", json={}, headers=headers2
        )
        assert resp.status_code == 403

    def test_cannot_accept_twice(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        eid = self._propose(client, headers1, h, user2["id"])
        client.post(f"/api/households/{h['id']}/exceptions/{eid}/accept", json={}, headers=headers2)
        resp = client.post(
            f"/api/households/{h['id']}/exceptions/{eid}/accept", json={}, headers=headers2
        )
        assert resp.status_code == 409

    def test_cannot_accept_expired(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        past = iso(date.today() - timedelta(days=2))
        eid = self._propose(client, headers1, h, user2["id"], start=past, end=past)
        resp = client.post(
            f"/api/households/{h['id']}/exceptions/{eid}/accept", json={}, headers=headers2
        )
        assert resp.status_code == 409


class TestCounterProposal:
    def test_counter_links_replaces(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        first = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        ).json()["id"]
        client.post(f"/api/households/{h['id']}/exceptions/{first}/refuse", json={}, headers=headers2)
        counter = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={
                "date_start": "2099-03-05", "date_end": "2099-03-05",
                "parent_id": user1["id"], "replaces_id": first,
            },
            headers=headers2,
        )
        assert counter.status_code == 201, counter.text
        assert counter.json()["replaces_id"] == first
        assert counter.json()["status"] == "pending"


class TestListFilter:
    def test_filter_pending(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        a = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        ).json()["id"]
        b = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-06", "date_end": "2099-03-06", "parent_id": user2["id"]},
            headers=headers1,
        ).json()["id"]
        client.post(f"/api/households/{h['id']}/exceptions/{b}/accept", json={}, headers=headers2)

        pending = client.get(f"/api/households/{h['id']}/exceptions?status=pending", headers=headers1).json()
        assert [e["id"] for e in pending] == [a]
        accepted = client.get(f"/api/households/{h['id']}/exceptions?status=accepted", headers=headers1).json()
        assert [e["id"] for e in accepted] == [b]


class TestCalendarIntegration:
    def _rule(self, client, headers, h, ref_id):
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2099-01-05", "reference_parent_id": ref_id},
            headers=headers,
        )

    def test_pending_does_not_change_custody(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        self._rule(client, headers1, h, user1["id"])
        # garde de référence sans échange
        base = client.get(
            f"/api/households/{h['id']}/calendar?start=2099-03-02&end=2099-03-08", headers=headers1
        ).json()
        base_day = next(d for d in base["days"] if d["date"] == "2099-03-04")

        # proposition pending attribuant ce jour à user2
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        )
        after = client.get(
            f"/api/households/{h['id']}/calendar?start=2099-03-02&end=2099-03-08", headers=headers1
        ).json()
        after_day = next(d for d in after["days"] if d["date"] == "2099-03-04")
        # la garde résolue est inchangée par une proposition en attente
        assert after_day["parent_id"] == base_day["parent_id"]
        # mais la proposition apparaît dans le bloc provisoire
        assert any(px["date_start"] == "2099-03-04" for px in after["pending_exchanges"])

    def test_accepted_changes_custody(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        self._rule(client, headers1, h, user1["id"])
        eid = client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": "2099-03-04", "date_end": "2099-03-04", "parent_id": user2["id"]},
            headers=headers1,
        ).json()["id"]
        client.post(f"/api/households/{h['id']}/exceptions/{eid}/accept", json={}, headers=headers2)
        cal = client.get(
            f"/api/households/{h['id']}/calendar?start=2099-03-02&end=2099-03-08", headers=headers1
        ).json()
        day = next(d for d in cal["days"] if d["date"] == "2099-03-04")
        assert day["parent_id"] == user2["id"]
        assert day["source"] == "exception"
        assert cal["pending_exchanges"] == []

    def test_expired_pending_excluded(self, client, auth_headers):
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        self._rule(client, headers1, h, user1["id"])
        past = iso(date.today() - timedelta(days=2))
        client.post(
            f"/api/households/{h['id']}/exceptions",
            json={"date_start": past, "date_end": past, "parent_id": user2["id"]},
            headers=headers1,
        )
        start = iso(date.today() - timedelta(days=7))
        end = iso(date.today() + timedelta(days=1))
        cal = client.get(
            f"/api/households/{h['id']}/calendar?start={start}&end={end}", headers=headers1
        ).json()
        assert cal["pending_exchanges"] == []
