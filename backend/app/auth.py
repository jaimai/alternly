from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:  # > 72 octets (bcrypt ≥ 5) ou hash vide/corrompu → simple échec
        return False


def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        # Version de session : l'incrémenter révoque tous les jetons existants.
        "tv": user.token_version or 0,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentification requise")
    try:
        payload = jwt.decode(credentials.credentials, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload["sub"])
        token_version = int(payload.get("tv", 0))  # jetons antérieurs sans "tv" → 0
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Jeton invalide ou expiré")
    user = db.get(User, user_id)
    # Placeholder (second parent fantôme ou compte supprimé/anonymisé) : jamais connecté.
    if user is None or user.is_placeholder:
        raise HTTPException(status_code=401, detail="Utilisateur inconnu")
    if token_version != (user.token_version or 0):
        raise HTTPException(status_code=401, detail="Session expirée, reconnectez-vous")
    return user
