"""Pension alimentaire : échéancier, paiements, revalorisation, rappel annuel."""
from datetime import date

from sqlalchemy import select

from app.models import Notification, Pension, PensionPayment, PensionRate
from app.services.pension import add_months, first_of_month, month_statuses, revalued_cents, send_reminders
from tests.test_expenses_v2 import premium_solo
from tests.test_rules import premium_family, setup_family


def setup(client, headers, hid, payer_id, **kw):
    body = {"payer_id": payer_id, "amount_cents": 20000, "due_day": 5, "start_month": "2026-01-01"}
    body.update(kw)
    return client.put(f"/api/households/{hid}/pension", json=body, headers=headers)


class TestPure:
    def test_revalued_cents_rounds_half_up(self):
        # 200 € × 118,52 / 112,03 = 211,5862… → 211,59 €
        assert revalued_cents(20000, 112.03, 118.52) == 21159
        assert revalued_cents(15000, 100.0, 100.0) == 15000

    def test_add_months_across_years(self):
        assert add_months(date(2026, 11, 1), 3) == date(2027, 2, 1)
        assert add_months(date(2026, 1, 1), -1) == date(2025, 12, 1)

    def test_statuses_and_arrears(self):
        pension = Pension(due_day=5, start_month=date(2026, 7, 1))
        rates = [
            PensionRate(id=1, effective_from=date(2026, 7, 1), amount_cents=20000),
            PensionRate(id=2, effective_from=date(2026, 9, 1), amount_cents=21000),
        ]
        payments = [
            PensionPayment(month=date(2026, 7, 1), amount_cents=20000),
            PensionPayment(month=date(2026, 8, 1), amount_cents=5000),
            PensionPayment(month=date(2026, 9, 1), amount_cents=21000),
        ]
        months, arrears = month_statuses(pension, rates, payments, date(2026, 11, 3))
        by_month = {m["month"].month: (m["status"], m["due_cents"]) for m in months}
        assert by_month == {
            7: ("paid", 20000), 8: ("partial", 20000), 9: ("paid", 21000),
            10: ("missing", 21000), 11: ("upcoming", 21000),
        }
        assert arrears == 15000 + 21000
        assert months[0]["month"] == first_of_month(date(2026, 11, 3))  # plus récent d'abord


class TestPensionApi:
    def test_solo_parent_sets_up_and_records_payments(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        assert client.get(f"/api/households/{h['id']}/pension", headers=headers1).json() is None
        resp = setup(client, headers1, h["id"], placeholder_id)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["payer_id"] == placeholder_id and data["payee_id"] == user1["id"]
        assert data["amount_cents"] == 20000
        assert data["arrears_cents"] > 0  # mois de 2026 sans versement

        paid = client.post(
            f"/api/households/{h['id']}/pension/payments",
            json={"month": "2026-01-15", "amount_cents": 20000, "paid_on": "2026-01-04"},
            headers=headers1,
        )
        assert paid.status_code == 201, paid.text
        january = next(m for m in paid.json()["months"] if m["month"] == "2026-01-01")
        assert january["status"] == "paid"

        pid = paid.json()["payments"][0]["id"]
        after = client.delete(f"/api/households/{h['id']}/pension/payments/{pid}", headers=headers1)
        assert after.status_code == 200 and after.json()["payments"] == []

    def test_revaluation_preview_then_apply(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        base = f"/api/households/{h['id']}/pension"
        setup(client, headers1, h["id"], placeholder_id)
        # Sans base de revalorisation : impossible de calculer.
        assert client.post(f"{base}/revaluation", json={"new_index": 120}, headers=headers1).status_code == 409

        setup(client, headers1, h["id"], placeholder_id, base_amount_cents=20000, base_index=112.03, revaluation_month=1)
        preview = client.post(f"{base}/revaluation", json={"new_index": 118.52}, headers=headers1).json()
        assert preview["new_cents"] == 21159 and preview["applied"] is False
        assert client.get(base, headers=headers1).json()["amount_cents"] == 20000

        applied = client.post(f"{base}/revaluation", json={"new_index": 118.52, "apply": True}, headers=headers1)
        assert applied.json()["applied"] is True
        state = client.get(base, headers=headers1).json()
        assert state["amount_cents"] == 21159
        assert state["rates"][0]["index_value"] == 118.52

    def test_visible_to_both_parents_and_history(self, client, auth_headers, db_session):
        headers1, user1, headers2, user2, h = premium_family(client, auth_headers, db_session)
        setup(client, headers1, h["id"], user2["id"])
        assert client.get(f"/api/households/{h['id']}/pension", headers=headers2).json()["payer_id"] == user2["id"]
        history = client.get(f"/api/households/{h['id']}/history", headers=headers2).json()
        assert any("pension" in e["summary"] for e in history)

    def test_validation(self, client, auth_headers, db_session):
        headers1, user1, h, _ = premium_solo(client, auth_headers, db_session)
        assert setup(client, headers1, h["id"], 999999).status_code == 422
        assert setup(client, headers1, h["id"], user1["id"], amount_cents=0).status_code == 422

    def test_requires_premium(self, client, auth_headers):
        free_headers, _, _, _, free_h = setup_family(client, auth_headers)
        assert client.get(f"/api/households/{free_h['id']}/pension", headers=free_headers).status_code == 402

    def test_delete_pension(self, client, auth_headers, db_session):
        headers1, _, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        setup(client, headers1, h["id"], placeholder_id)
        assert client.delete(f"/api/households/{h['id']}/pension", headers=headers1).status_code == 204
        assert db_session.scalars(select(PensionRate)).all() == []

    def test_partner_joining_takes_over_placeholder(self, client, auth_headers, db_session):
        from app.services.parents import claim_placeholder

        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        setup(client, headers1, h["id"], placeholder_id)
        _, user2 = auth_headers(email="parent2@test.fr", name="Sam")
        claim_placeholder(db_session, h["id"], user2["id"])
        db_session.commit()
        pension = db_session.scalar(select(Pension))
        assert pension.payer_id == user2["id"]


class TestReminder:
    def test_reminder_once_per_year(self, client, auth_headers, db_session):
        headers1, user1, h, placeholder_id = premium_solo(client, auth_headers, db_session)
        setup(client, headers1, h["id"], placeholder_id, base_amount_cents=20000, base_index=112.0, revaluation_month=3)
        assert send_reminders(db_session, date(2027, 2, 10)) == 0
        assert send_reminders(db_session, date(2027, 3, 1)) == 1  # placeholder ignoré
        assert send_reminders(db_session, date(2027, 3, 2)) == 0
        db_session.commit()
        notifs = db_session.scalars(
            select(Notification).where(Notification.user_id == user1["id"], Notification.type == "pension_revaluation_due")
        ).all()
        assert len(notifs) == 1
