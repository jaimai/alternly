"""Vérification des jetons d'identité « Continuer avec Google » (Google Identity Services).

Le navigateur obtient un jeton d'identité (JWT RS256 signé par Google) et nous
l'envoie. On vérifie localement signature, audience (notre ID client), émetteur
et expiration avec les clés publiques de Google, mises en cache.
"""
from dataclasses import dataclass

import jwt

from ..config import settings

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")

# Clés publiques de Google mises en cache (rotation gérée par le kid du jeton).
_jwks_client = jwt.PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True, lifespan=6 * 3600)


class GoogleAuthError(Exception):
    pass


@dataclass
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    given_name: str
    name: str
    locale: str | None


def verify_credential(credential: str) -> GoogleIdentity:
    """Vérifie le jeton et renvoie l'identité Google ; lève GoogleAuthError sinon."""
    if not settings.google_client_id:
        raise GoogleAuthError("Connexion Google non configurée")
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(credential)
        claims = jwt.decode(
            credential,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.google_client_id,
            options={"require": ["exp", "iat", "iss", "sub", "aud"]},
            leeway=30,
        )
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        raise GoogleAuthError("Jeton Google invalide") from exc
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise GoogleAuthError("Jeton Google invalide")
    email = (claims.get("email") or "").lower()
    if not email:
        raise GoogleAuthError("Jeton Google sans adresse e-mail")
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=email,
        email_verified=claims.get("email_verified") in (True, "true"),
        given_name=(claims.get("given_name") or "").strip(),
        name=(claims.get("name") or "").strip(),
        locale=claims.get("locale"),
    )
