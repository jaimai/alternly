"""App Store 5.1.1(v) : refresh token Apple obtenu à la connexion (stocké chiffré), révoqué
à la suppression du compte. Toujours au mieux : Apple injoignable ne bloque rien."""
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import settings
from app.models import User
from app.services import apple_tokens
from tests.test_apple_auth import RAW_NONCE, apple_enabled, identity_token  # noqa: F401 (fixture autouse)

_P8 = ec.generate_private_key(ec.SECP256R1())
P8_PEM = _P8.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()


class FakeApple:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.token_status = 200
        self.down = False

    def __call__(self, path, data):
        if self.down:
            raise httpx.ConnectError("down")
        self.calls.append((path, data))
        if path == "/auth/token":
            return httpx.Response(self.token_status, json={"refresh_token": "rt-123", "access_token": "at"})
        return httpx.Response(200)


@pytest.fixture
def apple(monkeypatch):
    monkeypatch.setattr(settings, "apple_team_id", "TEAM123456")
    monkeypatch.setattr(settings, "apple_key_id", "KEY1234567")
    # Variable d'environnement sur une ligne : « \n » littéraux.
    monkeypatch.setattr(settings, "apple_private_key", P8_PEM.replace("\n", "\\n"))
    fake = FakeApple()
    monkeypatch.setattr(apple_tokens, "_post", fake)
    return fake


def login(client, **extra):
    return client.post("/api/auth/apple", json={"nonce": RAW_NONCE, "identity_token": identity_token(), **extra})


def test_code_is_exchanged_and_stored_encrypted(client, db_session, apple):
    r = login(client, authorization_code="c-abc")
    assert r.status_code == 200, r.text
    path, data = apple.calls[0]
    assert path == "/auth/token" and data["code"] == "c-abc" and data["grant_type"] == "authorization_code"
    assert data["client_id"] == "com.alternly.app"
    # Client secret : JWT ES256 signé avec la clé Apple, adressé à Apple pour notre bundle.
    claims = jwt.decode(data["client_secret"], _P8.public_key(), algorithms=["ES256"], audience="https://appleid.apple.com")
    assert claims["iss"] == "TEAM123456" and claims["sub"] == "com.alternly.app"
    assert jwt.get_unverified_header(data["client_secret"])["kid"] == "KEY1234567"
    user = db_session.query(User).one()
    assert user.apple_refresh_token and "rt-123" not in user.apple_refresh_token
    assert apple_tokens.decrypt(user.apple_refresh_token) == "rt-123"
    assert user.apple_client_id == "com.alternly.app"


def test_account_deletion_revokes_the_token(client, db_session, apple):
    token = login(client, authorization_code="c-abc").json()["access_token"]
    assert client.delete("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 204
    path, data = apple.calls[-1]
    assert path == "/auth/revoke"
    assert data["token"] == "rt-123" and data["token_type_hint"] == "refresh_token" and data["client_id"] == "com.alternly.app"


def test_apple_outage_never_blocks_login_or_deletion(client, db_session, apple):
    apple.down = True
    r = login(client, authorization_code="c-abc")
    assert r.status_code == 200
    assert db_session.query(User).one().apple_refresh_token is None
    apple.down = False
    token = login(client, authorization_code="c-abc").json()["access_token"]
    apple.down = True
    assert client.delete("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 204


def test_refused_code_stores_nothing(client, db_session, apple):
    apple.token_status = 400
    assert login(client, authorization_code="expired").status_code == 200
    assert db_session.query(User).one().apple_refresh_token is None


def test_disabled_without_apple_key(client, db_session, monkeypatch):
    calls = []
    monkeypatch.setattr(apple_tokens, "_post", lambda *a: calls.append(a))
    monkeypatch.setattr(settings, "apple_private_key", "")
    assert login(client, authorization_code="c-abc").status_code == 200
    assert calls == []


def test_refresh_token_never_exported(client, db_session, apple):
    token = login(client, authorization_code="c-abc").json()["access_token"]
    export = client.get("/api/auth/me/export", headers={"Authorization": f"Bearer {token}"})
    assert export.status_code == 200
    assert "apple_refresh_token" not in export.text and "rt-123" not in export.text


def test_web_callback_passes_the_code_to_the_app(client):
    r = client.post(
        "/api/auth/apple/callback",
        data={"state": "abc123.alternly%3A%2F%2Fapple-callback", "id_token": identity_token(), "code": "c-web"},
        follow_redirects=False,
    )
    assert r.status_code == 303 and "code=c-web" in r.headers["location"]
