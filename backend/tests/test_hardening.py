"""Durcissement : bornes d'entrée, iCal 503, cache négatif, en-têtes, migrations."""
from datetime import date

import httpx

from app.services import public_holidays, school_holidays


def _down(request):
    raise httpx.ConnectError("down")


class TestNegativeCache:
    def test_empty_year_not_refetched(self, db_session):
        calls = []

        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, json={"results": []})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        assert school_holidays.get(db_session, "A", ["2030-2031"], client=client) == []
        assert school_holidays.get(db_session, "A", ["2030-2031"], client=client) == []
        assert len(calls) == 1

    def test_failure_memoized(self, db_session):
        calls = []

        def handler(request):
            calls.append(request.url)
            raise httpx.ConnectError("down")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        for _ in range(2):
            try:
                public_holidays.get(db_session, 2031, client=client)
            except public_holidays.PublicDataUnavailable:
                pass
            else:
                raise AssertionError("PublicDataUnavailable attendue")
        assert len(calls) == 1

    def test_fake_api_serves_realistic_periods(self, db_session):
        periods = school_holidays.get(db_session, "B", ["2025-2026"])
        hiver = next(p for p in periods if p.label == "Vacances d'Hiver")
        assert hiver.start == date(2026, 2, 14) and hiver.end == date(2026, 3, 1)
        assert public_holidays.get(db_session, 2026)[date(2026, 7, 14)] == "14 juillet"
