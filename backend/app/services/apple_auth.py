"""Vérification des jetons d'identité « Se connecter avec Apple » (app mobile).

L'iPhone (en natif) ou Android (par la page web d'Apple, cf. /auth/apple/callback)
obtient un jeton d'identité (JWT RS256 signé par Apple) et nous l'envoie.
On vérifie localement signature, audience (notre identifiant de bundle), émetteur
et expiration avec les clés publiques d'Apple, mises en cache.
"""
from dataclasses import dataclass

import jwt

from ..config import settings

APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

# Clés publiques d'Apple mises en cache (rotation gérée par le kid du jeton).
_jwks_client = jwt.PyJWKClient(APPLE_KEYS_URL, cache_keys=True, lifespan=6 * 3600)


class AppleAuthError(Exception):
    pass


@dataclass
class AppleIdentity:
    sub: str
    # Vide si Apple ne l'a pas transmis (rare : l'e-mail figure normalement à chaque connexion).
    email: str
    email_verified: bool


def _audiences() -> list[str]:
    ids = [*settings.apple_client_ids.split(","), settings.apple_services_id]
    return [a.strip() for a in ids if a.strip()]


def verify_identity_token(identity_token: str) -> AppleIdentity:
    """Vérifie le jeton et renvoie l'identité Apple ; lève AppleAuthError sinon."""
    audiences = _audiences()
    if not audiences:
        raise AppleAuthError("Connexion Apple non configurée")
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(identity_token)
        claims = jwt.decode(
            identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audiences,
            issuer=APPLE_ISSUER,
            options={"require": ["exp", "iat", "iss", "sub", "aud"]},
            leeway=30,
        )
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        raise AppleAuthError("Jeton Apple invalide") from exc
    return AppleIdentity(
        sub=str(claims["sub"]),
        email=(claims.get("email") or "").lower(),
        # Apple envoie « true » en chaîne ; les adresses relais (privaterelay) sont vérifiées.
        email_verified=claims.get("email_verified") in (True, "true"),
    )
