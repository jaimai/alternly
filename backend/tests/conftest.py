import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app


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
