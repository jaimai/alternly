"""Jetons Apple côté serveur : obtenir un refresh token à la connexion, le révoquer à la
suppression du compte (exigé par l'App Store, consigne 5.1.1(v)).

À la connexion, l'app transmet le code d'autorisation d'Apple ; on l'échange contre un
refresh token (POST /auth/token), stocké chiffré. À la suppression du compte, on le révoque
(POST /auth/revoke). Les deux appels demandent un « client secret » : un JWT ES256 signé
avec la clé « Sign in with Apple » (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY).
Sans ces variables, tout est désactivé (no-op). Toujours au mieux : un échec ne bloque
jamais une connexion ni une suppression de compte.
"""
import base64
import hashlib
import logging
import time

import httpx
import jwt
from cryptography.fernet import Fernet, InvalidToken

from ..config import settings

log = logging.getLogger(__name__)

APPLE_AUTH = "https://appleid.apple.com"


def enabled() -> bool:
    return bool(settings.apple_team_id and settings.apple_key_id and settings.apple_private_key)


def _private_key() -> str:
    # Variable d'environnement sur une ligne : « \n » littéraux acceptés.
    return settings.apple_private_key.replace("\\n", "\n")


def client_secret(client_id: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": settings.apple_team_id, "iat": now, "exp": now + 300, "aud": APPLE_AUTH, "sub": client_id},
        _private_key(),
        algorithm="ES256",
        headers={"kid": settings.apple_key_id},
    )


def _fernet() -> Fernet:
    # Clé dérivée de SECRET_KEY : le refresh token n'est jamais stocké en clair.
    digest = hashlib.sha256(f"apple-refresh-token:{settings.secret_key}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt(stored: str) -> str | None:
    try:
        return _fernet().decrypt(stored.encode()).decode()
    except InvalidToken:  # SECRET_KEY changé : le jeton n'est plus lisible
        return None


def _post(path: str, data: dict) -> httpx.Response:
    with httpx.Client(timeout=10) as client:
        return client.post(f"{APPLE_AUTH}{path}", data=data)


def exchange_code(code: str, client_id: str) -> str | None:
    """Code d'autorisation → refresh token (None si désactivé ou refusé par Apple)."""
    if not enabled():
        return None
    data = {
        "client_id": client_id,
        "client_secret": client_secret(client_id),
        "code": code,
        "grant_type": "authorization_code",
    }
    # Parcours web (Android) : Apple exige la même redirect_uri que la demande initiale.
    if client_id == settings.apple_services_id and settings.apple_web_redirect_uri:
        data["redirect_uri"] = settings.apple_web_redirect_uri
    try:
        resp = _post("/auth/token", data)
    except httpx.HTTPError:
        log.warning("Apple /auth/token injoignable")
        return None
    if resp.status_code != 200:
        log.warning("Apple /auth/token a refusé le code (%s)", resp.status_code)
        return None
    return resp.json().get("refresh_token")


def revoke(refresh_token: str, client_id: str) -> bool:
    """Révoque l'autorisation « Se connecter avec Apple » de l'utilisateur."""
    if not enabled():
        return False
    try:
        resp = _post(
            "/auth/revoke",
            {
                "client_id": client_id,
                "client_secret": client_secret(client_id),
                "token": refresh_token,
                "token_type_hint": "refresh_token",
            },
        )
    except httpx.HTTPError:
        log.warning("Apple /auth/revoke injoignable")
        return False
    if resp.status_code != 200:
        log.warning("Apple /auth/revoke a échoué (%s)", resp.status_code)
        return False
    return True
