"""« Continuer avec Google » : vérification du jeton, création, liaison, mot de passe."""
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import settings
from app.models import User
from app.services import google_auth

CLIENT_ID = "test-client.apps.googleusercontent.com"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def google_enabled(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(
        google_auth._jwks_client,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=_KEY.public_key()),
    )


def credential(**overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-123",
        "email": "Camille@Gmail.com",
        "email_verified": True,
        "given_name": "Camille",
        "name": "Camille Martin",
        "iat": now,
        "exp": now + 600,
    }
    claims.update(overrides)
    return jwt.encode(claims, _KEY, algorithm="RS256", headers={"kid": "k1"})


def test_creates_account_without_password(client, db_session):
    r = client.post("/api/auth/google", json={"credential": credential(), "locale": "fr"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == "camille@gmail.com"
    assert body["user"]["display_name"] == "Camille"
    assert body["user"]["has_password"] is False
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    # Aucun mot de passe : la connexion classique échoue proprement.
    assert client.post("/api/auth/login", json={"email": "camille@gmail.com", "password": ""}).status_code in (401, 422)
    assert client.post("/api/auth/login", json={"email": "camille@gmail.com", "password": "nimportequoi"}).status_code == 401


def test_second_login_reuses_account(client, db_session):
    first = client.post("/api/auth/google", json={"credential": credential()}).json()
    # Même compte Google, e-mail changé côté Google : retrouvé par « sub ».
    second = client.post("/api/auth/google", json={"credential": credential(email="new@gmail.com")}).json()
    assert first["user"]["id"] == second["user"]["id"]
    assert db_session.query(User).count() == 1


def test_links_existing_password_account(client, db_session):
    r = client.post(
        "/api/auth/register",
        json={"email": "camille@gmail.com", "password": "motdepasse1", "display_name": "Cam"},
    )
    uid = r.json()["user"]["id"]
    g = client.post("/api/auth/google", json={"credential": credential()}).json()
    assert g["user"]["id"] == uid
    assert g["user"]["has_password"] is True
    assert db_session.get(User, uid).google_sub == "google-123"
    # Le mot de passe existant fonctionne toujours.
    assert client.post("/api/auth/login", json={"email": "camille@gmail.com", "password": "motdepasse1"}).status_code == 200


def test_unverified_email_never_links(client, db_session):
    client.post(
        "/api/auth/register",
        json={"email": "camille@gmail.com", "password": "motdepasse1", "display_name": "Cam"},
    )
    r = client.post("/api/auth/google", json={"credential": credential(email_verified=False)})
    assert r.status_code == 401
    assert db_session.query(User).filter(User.google_sub.isnot(None)).count() == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "autre-client.apps.googleusercontent.com"},
        {"iss": "https://evil.example.com"},
        {"exp": int(time.time()) - 3600},
    ],
)
def test_rejects_invalid_tokens(client, overrides):
    r = client.post("/api/auth/google", json={"credential": credential(**overrides)})
    assert r.status_code == 401


def test_rejects_token_signed_by_another_key(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    forged = jwt.encode(
        {"iss": "accounts.google.com", "aud": CLIENT_ID, "sub": "x", "email": "a@b.fr",
         "email_verified": True, "iat": now, "exp": now + 600},
        other, algorithm="RS256",
    )
    assert client.post("/api/auth/google", json={"credential": forged}).status_code == 401


def test_disabled_without_client_id(client, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    assert client.post("/api/auth/google", json={"credential": credential()}).status_code == 503


def test_google_user_can_set_first_password(client):
    token = client.post("/api/auth/google", json={"credential": credential()}).json()["access_token"]
    r = client.post(
        "/api/auth/password/change",
        json={"new_password": "nouveaumdp1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["has_password"] is True
    assert client.post("/api/auth/login", json={"email": "camille@gmail.com", "password": "nouveaumdp1"}).status_code == 200
    # Ensuite, le mot de passe actuel redevient obligatoire.
    token2 = r.json()["access_token"]
    r2 = client.post(
        "/api/auth/password/change",
        json={"new_password": "encoreunautre1"},
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert r2.status_code == 400


def test_deleted_account_unlinks_google(client, db_session):
    token = client.post("/api/auth/google", json={"credential": credential()}).json()["access_token"]
    assert client.delete("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 204
    # Le compte Google peut recréer un compte neuf.
    again = client.post("/api/auth/google", json={"credential": credential()})
    assert again.status_code == 200
    assert again.json()["user"]["has_password"] is False


def test_accepts_mobile_client_ids(client, monkeypatch):
    # App mobile : jetons émis pour les ID clients iOS / Android, en plus de l'ID web.
    monkeypatch.setattr(settings, "google_mobile_client_ids", "ios.apps.googleusercontent.com, android.apps.googleusercontent.com")
    for aud in ("ios.apps.googleusercontent.com", "android.apps.googleusercontent.com", CLIENT_ID):
        assert client.post("/api/auth/google", json={"credential": credential(aud=aud)}).status_code == 200
    assert client.post("/api/auth/google", json={"credential": credential(aud="autre.apps.googleusercontent.com")}).status_code == 401
