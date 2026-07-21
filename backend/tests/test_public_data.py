import json
from datetime import date

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import PublicHolidayCache, SchoolHolidayCache
from app.services import public_holidays, school_holidays


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def make_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestPublicHolidays:
    def test_fetch_and_cache(self, db):
        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, json={"2026-01-01": "Jour de l'an", "2026-07-14": "Fête nationale"})

        client = make_client(handler)
        result = public_holidays.get(db, 2026, client=client)
        assert result[date(2026, 7, 14)] == "Fête nationale"
        assert len(calls) == 1

        # 2e appel : servi par le cache DB, pas de requête réseau
        result2 = public_holidays.get(db, 2026, client=client)
        assert result2 == result
        assert len(calls) == 1

    def test_network_error_raises(self, db):
        def handler(request):
            raise httpx.ConnectError("down")

        with pytest.raises(public_holidays.PublicDataUnavailable):
            public_holidays.get(db, 2026, client=make_client(handler))


class TestSchoolYears:
    def test_range_within_one_school_year(self):
        assert school_holidays.school_years_for_range(date(2026, 9, 1), date(2027, 6, 30)) == ["2026-2027"]

    def test_range_spanning_two(self):
        assert school_holidays.school_years_for_range(date(2026, 1, 1), date(2026, 12, 31)) == [
            "2025-2026",
            "2026-2027",
        ]


class TestSchoolHolidays:
    def test_fetch_parse_and_cache(self, db):
        calls = []

        def handler(request):
            calls.append(dict(request.url.params))
            return httpx.Response(200, json={
                "results": [
                    {   # dates UTC = minuit Paris (hiver : UTC+1)
                        "description": "Vacances d'Hiver",
                        "start_date": "2026-02-06T23:00:00+00:00",
                        "end_date": "2026-02-22T23:00:00+00:00",
                    },
                    {   # doublon (le dataset en contient) → dédupliqué
                        "description": "Vacances d'Hiver",
                        "start_date": "2026-02-06T23:00:00+00:00",
                        "end_date": "2026-02-22T23:00:00+00:00",
                    },
                    {"description": "Début des cours", "start_date": None, "end_date": "2026-09-01T00:00:00+02:00"},
                ]
            })

        periods = school_holidays.get(db, "B", ["2025-2026"], client=make_client(handler))
        assert len(periods) == 1
        p = periods[0]
        assert p.label == "Vacances d'Hiver"
        assert p.start == date(2026, 2, 7)   # UTC 23h → minuit Paris
        assert p.end == date(2026, 2, 22)    # end_date minuit → veille incluse
        assert 'zones="Zone B"' in calls[0]["where"]

        # cache
        periods2 = school_holidays.get(db, "B", ["2025-2026"], client=make_client(handler))
        assert len(calls) == 1
        assert periods2[0].start == p.start

    def test_summer_reconstructed_from_next_rentree(self, db):
        def handler(request):
            year = dict(request.url.params)["where"]
            if "2025-2026" in year:
                results = [{
                    "description": "Début des Vacances d'Été",
                    "start_date": "2026-07-03T22:00:00+00:00",  # 4 juillet Paris
                    "end_date": "2026-07-03T22:00:00+00:00",
                }]
            else:  # 2026-2027
                results = [{
                    "description": "Rentrée scolaire des élèves",
                    "start_date": "2026-09-01T22:00:00+00:00",  # 2 septembre Paris
                    "end_date": "2026-09-01T22:00:00+00:00",
                }]
            return httpx.Response(200, json={"results": results})

        periods = school_holidays.get(db, "A", ["2025-2026", "2026-2027"], client=make_client(handler))
        assert len(periods) == 1
        summer = periods[0]
        assert summer.label == "Vacances d'Été"
        assert summer.start == date(2026, 7, 4)
        assert summer.end == date(2026, 9, 1)  # veille de la rentrée (2 sept.)

    def test_summer_fallback_without_next_year(self, db):
        def handler(request):
            return httpx.Response(200, json={"results": [{
                "description": "Début des Vacances d'Été",
                "start_date": "2026-07-03T22:00:00+00:00",
                "end_date": "2026-07-03T22:00:00+00:00",
            }]})

        periods = school_holidays.get(db, "A", ["2025-2026"], client=make_client(handler))
        assert periods[0].end == date(2026, 8, 31)
