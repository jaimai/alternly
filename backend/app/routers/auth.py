import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..auth import create_token, get_current_user, hash_password, verify_password
from ..db import get_db
from ..models import PasswordResetToken, User, utcnow
from ..ratelimit import HOUR, MINUTE, rate_limit
from ..schemas import (
    ChangePasswordIn,
    ForgotPasswordIn,
    GoogleLoginIn,
    ResetPasswordIn,
    Token,
    UserCreate,
    UserLogin,
    UserOut,
    UserUpdate,
)
from ..services import account, analytics, google_auth, lifecycle, paddle_api
from ..services import email as email_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

RESET_TOKEN_TTL = timedelta(hours=1)
INVALID_RESET = "Lien invalide ou expiré"


def _token_response(user: User) -> Token:
    return Token(access_token=create_token(user), user=UserOut.model_validate(user))


def _hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _revoke_sessions(user: User) -> None:
    """Invalide tous les jetons émis jusqu'ici (claim "tv")."""
    user.token_version = (user.token_version or 0) + 1


def _invalidate_reset_tokens(db: Session, user_id: int) -> None:
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None))
        .values(used_at=utcnow())
    )


def _detect_locale(accept_language: str | None) -> str:
    """Langue de l'UI depuis l'en-tête Accept-Language. FR par défaut ; EN si la
    première langue préférée est l'anglais."""
    if not accept_language:
        return "fr"
    first = accept_language.split(",")[0].strip().lower()
    return "en" if first.startswith("en") else "fr"


@router.post(
    "/register",
    response_model=Token,
    status_code=201,
    dependencies=[Depends(rate_limit("register", 10, HOUR))],
)
def register(
    data: UserCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    accept_language: str | None = Header(default=None),
):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        # Énumération d'e-mails possible ici : compromis UX assumé au MVP
        # (login et mot de passe oublié restent uniformes ; inscription limitée en débit).
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
        analytics_consent=data.analytics_consent,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    analytics.capture_for_user(
        user, "user_signed_up", {"method": "email", "via_invite": data.via_invite, "locale": user.locale}
    )
    # J0 : le parent invité reçoit son propre accueil à l'acceptation de l'invitation.
    if not data.via_invite:
        lifecycle.queue_welcome(db, user, background)
    return _token_response(user)


@router.post(
    "/login",
    response_model=Token,
    dependencies=[
        Depends(rate_limit("login", 10, MINUTE)),
        Depends(rate_limit("login", 20, HOUR, by="body", field="email")),
    ],
)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or user.is_placeholder or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-mail ou mot de passe incorrect")
    return _token_response(user)


# Couleur par défaut d'un compte créé via Google (première couleur de la palette de l'app).
GOOGLE_DEFAULT_COLOR = "#2f6b57"


@router.post(
    "/google",
    response_model=Token,
    dependencies=[Depends(rate_limit("google", 20, MINUTE))],
)
def google_login(
    data: GoogleLoginIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    accept_language: str | None = Header(default=None),
):
    """« Continuer avec Google » : connecte, relie ou crée le compte à partir du jeton d'identité."""
    try:
        identity = google_auth.verify_credential(data.credential)
    except google_auth.GoogleAuthError as exc:
        status = 503 if "configurée" in str(exc) else 401
        raise HTTPException(status_code=status, detail=str(exc))
    if not identity.email_verified:
        # Sans e-mail vérifié par Google, relier un compte existant permettrait de l'usurper.
        raise HTTPException(status_code=401, detail="Adresse e-mail Google non vérifiée")

    user = db.scalar(select(User).where(User.google_sub == identity.sub))
    created = False
    if user is None:
        user = db.scalar(select(User).where(User.email == identity.email))
        if user is not None and not user.is_placeholder:
            # Compte existant avec le même e-mail (vérifié par Google) : on le relie.
            user.google_sub = identity.sub
        else:
            google_locale = "en" if (identity.locale or "").lower().startswith("en") else None
            user = User(
                email=identity.email,
                password_hash="",  # pas de mot de passe : défini plus tard si besoin
                display_name=(identity.given_name or identity.name or identity.email.split("@")[0])[:50],
                color=GOOGLE_DEFAULT_COLOR,
                subscription_status="free",
                locale=data.locale or google_locale or _detect_locale(accept_language),
                google_sub=identity.sub,
                analytics_consent=data.analytics_consent,
            )
            db.add(user)
            created = True
    elif user.is_placeholder:
        raise HTTPException(status_code=401, detail="Compte indisponible")
    db.commit()
    db.refresh(user)
    if created:
        analytics.capture_for_user(
            user, "user_signed_up", {"method": "google", "via_invite": data.via_invite, "locale": user.locale}
        )
        if not data.via_invite:
            lifecycle.queue_welcome(db, user, background)
    return _token_response(user)


@router.post(
    "/password/forgot",
    status_code=202,
    dependencies=[
        Depends(rate_limit("forgot", 5, HOUR)),
        Depends(rate_limit("forgot", 3, HOUR, by="body", field="email")),
    ],
)
def forgot_password(data: ForgotPasswordIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Toujours 202 : ne révèle pas si un compte existe pour cet e-mail."""
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user is not None and not user.is_placeholder:
        raw = secrets.token_urlsafe(32)
        db.add(PasswordResetToken(
            user_id=user.id, token_hash=_hash_reset_token(raw), expires_at=utcnow() + RESET_TOKEN_TTL,
        ))
        db.commit()
        subject, html = email_service.password_reset_email(raw, user.locale)
        # Après la réponse : ni latence Resend, ni différence de temps de réponse exploitable.
        background.add_task(email_service.send_email, user.email, subject, html)
    return {"ok": True}


@router.post(
    "/password/reset",
    response_model=Token,
    dependencies=[Depends(rate_limit("reset", 10, HOUR))],
)
def reset_password(data: ResetPasswordIn, db: Session = Depends(get_db)):
    reset = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash_reset_token(data.token))
    )
    if reset is None or reset.used_at is not None or reset.expires_at < utcnow():
        raise HTTPException(status_code=400, detail=INVALID_RESET)
    user = db.get(User, reset.user_id)
    if user is None or user.is_placeholder:
        raise HTTPException(status_code=400, detail=INVALID_RESET)
    user.password_hash = hash_password(data.password)
    _revoke_sessions(user)
    _invalidate_reset_tokens(db, user.id)  # celui-ci compris (usage unique)
    db.commit()
    db.refresh(user)
    analytics.capture_for_user(user, "password_reset_completed")
    return _token_response(user)


@router.post(
    "/password/change",
    response_model=Token,
    # vérifie le mot de passe actuel : borne le brute-force avec un jeton volé
    dependencies=[Depends(rate_limit("password_change", 10, HOUR))],
)
def change_password(data: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Compte Google sans mot de passe : première définition, sans mot de passe actuel.
    if user.has_password and not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")
    user.password_hash = hash_password(data.new_password)
    _revoke_sessions(user)  # déconnecte les autres appareils ; nouveau jeton renvoyé
    _invalidate_reset_tokens(db, user.id)
    db.commit()
    db.refresh(user)
    return _token_response(user)


@router.post("/logout-all", status_code=204)
def logout_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _revoke_sessions(user)
    db.commit()
    return Response(status_code=204)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.get("/me/export")
def export_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Export RGPD (droit d'accès / portabilité) : fichier JSON téléchargeable."""
    return JSONResponse(
        content=jsonable_encoder(account.export_user_data(db, user)),
        headers={"Content-Disposition": 'attachment; filename="alternly-export.json"'},
    )


@router.delete("/me", status_code=204)
def delete_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Supprime le compte et les données personnelles (droit à l'effacement)."""
    # Résilie au mieux l'abonnement Paddle pour ne plus facturer un compte supprimé.
    if user.paddle_subscription_id:
        try:
            paddle_api.cancel_subscription(user.paddle_subscription_id)
        except paddle_api.PaddleUnavailable:
            pass
    analytics.capture_for_user(user, "account_deleted", {"had_subscription": bool(user.paddle_subscription_id)})
    account.delete_account(db, user)
    db.commit()


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
    if data.analytics_consent is not None:
        user.analytics_consent = data.analytics_consent
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
