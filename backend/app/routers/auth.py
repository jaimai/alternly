from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from datetime import timedelta

from ..auth import create_token, get_current_user, hash_password, verify_password
from ..config import settings
from ..db import get_db
from ..models import User, utcnow
from ..schemas import Token, UserCreate, UserLogin, UserOut, UserUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _detect_locale(accept_language: str | None) -> str:
    """Langue de l'UI depuis l'en-tête Accept-Language. FR par défaut ; EN si la
    première langue préférée est l'anglais."""
    if not accept_language:
        return "fr"
    first = accept_language.split(",")[0].strip().lower()
    return "en" if first.startswith("en") else "fr"


@router.post("/register", response_model=Token, status_code=201)
def register(
    data: UserCreate,
    db: Session = Depends(get_db),
    accept_language: str | None = Header(default=None),
):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        # Énumération d'e-mails possible ici : compromis UX assumé au MVP
        # (le login reste uniforme ; pas de reset de mot de passe exposé).
        raise HTTPException(status_code=409, detail="Un compte existe déjà avec cet e-mail")
    # Modèle freemium : le calendrier est gratuit ; les fonctions premium
    # (dépenses, mur, e-mails, sync) nécessitent un abonnement.
    user = User(
        email=email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        color=data.color,
        subscription_status="free",
        # Langue explicite du client (landing) prioritaire, sinon Accept-Language.
        locale=data.locale or _detect_locale(accept_language),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return Token(access_token=create_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-mail ou mot de passe incorrect")
    return Token(access_token=create_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(data: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.display_name is not None:
        user.display_name = data.display_name
    if data.color is not None:
        user.color = data.color
    if data.email_opt_in is not None:
        user.email_opt_in = data.email_opt_in
    if data.onboarding_seen is not None:
        user.onboarding_seen = data.onboarding_seen
    if data.locale is not None:
        user.locale = data.locale
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
