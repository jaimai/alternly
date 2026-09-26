import os

# Hermétique : jamais la vraie base. Doit être défini AVANT d'importer app.config
# (les variables d'environnement priment sur le fichier .env dans pydantic-settings).
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "test-secret-key-uniquement-pour-les-tests"

import re

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.ratelimit import limiter
from app.services import public_holidays, school_holidays


# --- APIs publiques simulées : aucun appel réseau réel pendant les tests ---

_HIVER_PRINTEMPS_OFFSET = {"A": 0, "B": 7, "C": 14}  # décalage des zones (jours)


def _paris(y: int, m: int, d: int, offset_days: int = 0) -> str:
    from datetime import date, timedelta

    return (date(y, m, d) + timedelta(days=offset_days)).isoformat() + "T00:00:00+01:00"


def fake_school_holidays(zone: str, school_year: str) -> list[dict]:
    """Calendrier scolaire réaliste (format data.education.gouv.fr, end_date à minuit)."""
    y = int(school_year[:4])
    off = _HIVER_PRINTEMPS_OFFSET.get(zone, 0)
    return [
        {"description": "Rentrée scolaire des élèves", "start_date": _paris(y, 9, 1), "end_date": _paris(y, 9, 1)},
        {"description": "Vacances de la Toussaint", "start_date": _paris(y, 10, 17), "end_date": _paris(y, 11, 2)},
        {"description": "Vacances de Noël", "start_date": _paris(y, 12, 19), "end_date": _paris(y + 1, 1, 4)},
        {"description": "Vacances d'Hiver", "start_date": _paris(y + 1, 2, 7, off), "end_date": _paris(y + 1, 2, 23, off)},
        {"description": "Vacances de Printemps", "start_date": _paris(y + 1, 4, 4, off), "end_date": _paris(y + 1, 4, 20, off)},
        {"description": "Début des Vacances d'Été", "start_date": _paris(y + 1, 7, 4), "end_date": _paris(y + 1, 7, 4)},
    ]


def fake_public_holidays(year: int) -> dict[str, str]:
    return {
        f"{year}-01-01": "1er janvier",
        f"{year}-05-01": "1er mai",
        f"{year}-05-08": "8 mai",
        f"{year}-07-14": "14 juillet",
        f"{year}-08-15": "Assomption",
        f"{year}-11-01": "Toussaint",
        f"{year}-11-11": "11 novembre",
        f"{year}-12-25": "Jour de Noël",
    }


def _fake_gov_api(request: httpx.Request) -> httpx.Response:
    if request.url.host == "calendrier.api.gouv.fr":
        year = int(re.search(r"/(\d{4})\.json$", request.url.path).group(1))
        return httpx.Response(200, json=fake_public_holidays(year))
    if request.url.host == "data.education.gouv.fr":
        where = request.url.params["where"]
        zone = re.search(r'zones="Zone ([ABC])"', where).group(1)
        school_year = re.search(r'annee_scolaire="(\d{4}-\d{4})"', where).group(1)
        return httpx.Response(200, json={"results": fake_school_holidays(zone, school_year)})
    raise AssertionError(f"appel réseau inattendu : {request.url}")


@pytest.fixture(autouse=True)
def fake_public_apis(monkeypatch):
    """Remplace le transport HTTP par défaut des services de données publiques."""
    monkeypatch.setattr(public_holidays, "_transport", httpx.MockTransport(_fake_gov_api))
    public_holidays._memo.clear()
    school_holidays._memo.clear()
    yield
    public_holidays._memo.clear()
    school_holidays._memo.clear()


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    """Limitation de débit coupée par défaut ; réactivée dans tests/test_ratelimit.py."""
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers(client):
    """Crée un utilisateur et retourne ses en-têtes Bearer."""
    def make(email="parent1@test.fr", name="Camille", color="#4f7cac"):
        resp = client.post(
            "/api/auth/register",
            json={"email": email, "password": "motdepasse1", "display_name": name, "color": color},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        return {"Authorization": f"Bearer {data['access_token']}"}, data["user"]

    return make
