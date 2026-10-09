"""« Se connecter avec Apple » (app iOS) : vérification du jeton, création, liaison."""
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import settings
from app.models import User
from app.services import apple_auth

BUNDLE_ID = "com.alternly.app"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def apple_enabled(monkeypatch):
    monkeypatch.setattr(settings, "apple_client_ids", BUNDLE_ID)
    monkeypatch.setattr(
        apple_auth._jwks_client,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=_KEY.public_key()),
    )


def identity_token(**overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://appleid.apple.com",
        "aud": BUNDLE_ID,
        "sub": "001234.apple.5678",
        "email": "Camille@icloud.com",
        "email_verified": "true",
        "iat": now,
        "exp": now + 600,
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, _KEY, algorithm="RS256", headers={"kid": "k1"})


def test_creates_account_with_given_name(client, db_session):
    r = client.post("/api/auth/apple", json={"identity_token": identity_token(), "given_name": "Camille", "locale": "fr"})
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user["email"] == "camille@icloud.com"
    assert user["display_name"] == "Camille"
    assert user["has_password"] is False
    assert user["auth_method"] == "apple"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert me.status_code == 200


def test_second_login_reuses_account_without_email(client, db_session):
    first = client.post("/api/auth/apple", json={"identity_token": identity_token()}).json()
    # Connexions suivantes : ni prénom, et parfois pas d'e-mail dans le jeton → retrouvé par « sub ».
    second = client.post("/api/auth/apple", json={"identity_token": identity_token(email=None, email_verified=None)})
    assert second.status_code == 200, second.text
    assert first["user"]["id"] == second.json()["user"]["id"]
    assert db_session.query(User).count() == 1


def test_unknown_account_without_email_is_rejected(client):
    r = client.post("/api/auth/apple", json={"identity_token": identity_token(email=None, email_verified=None)})
    assert r.status_code == 401


def test_links_existing_password_account(client, db_session):
    uid = client.post(
        "/api/auth/register",
        json={"email": "camille@icloud.com", "password": "motdepasse1", "display_name": "Cam"},
    ).json()["user"]["id"]
    r = client.post("/api/auth/apple", json={"identity_token": identity_token()}).json()
    assert r["user"]["id"] == uid
    assert r["user"]["auth_method"] == "email"
    assert db_session.get(User, uid).apple_sub == "001234.apple.5678"


def test_unverified_email_never_links(client, db_session):
    client.post(
        "/api/auth/register",
        json={"email": "camille@icloud.com", "password": "motdepasse1", "display_name": "Cam"},
    )
    r = client.post("/api/auth/apple", json={"identity_token": identity_token(email_verified="false")})
    assert r.status_code == 401
    assert db_session.query(User).filter(User.apple_sub.isnot(None)).count() == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "com.autre.app"},
        {"iss": "https://evil.example.com"},
        {"exp": int(time.time()) - 3600},
    ],
)
def test_rejects_invalid_tokens(client, overrides):
    assert client.post("/api/auth/apple", json={"identity_token": identity_token(**overrides)}).status_code == 401


def test_rejects_token_signed_by_another_key(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    forged = jwt.encode(
        {"iss": "https://appleid.apple.com", "aud": BUNDLE_ID, "sub": "x", "email": "a@b.fr",
         "email_verified": "true", "iat": now, "exp": now + 600},
        other, algorithm="RS256",
    )
    assert client.post("/api/auth/apple", json={"identity_token": forged}).status_code == 401


def test_disabled_without_client_ids(client, monkeypatch):
    monkeypatch.setattr(settings, "apple_client_ids", "")
    assert client.post("/api/auth/apple", json={"identity_token": identity_token()}).status_code == 503


def test_deleted_account_unlinks_apple(client):
    token = client.post("/api/auth/apple", json={"identity_token": identity_token()}).json()["access_token"]
    assert client.delete("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 204
    again = client.post("/api/auth/apple", json={"identity_token": identity_token()})
    assert again.status_code == 200
    assert again.json()["user"]["has_password"] is False
