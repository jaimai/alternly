"""Désinscription des e-mails depuis un lien signé (sans connexion).

- GET  /api/email/unsubscribe?token=… : lien du pied de page → coupe les e-mails
  (`email_opt_in = false`) et affiche une petite page de confirmation ;
- POST /api/email/unsubscribe?token=… : désinscription « en un clic » des clients
  mail (en-têtes List-Unsubscribe / List-Unsubscribe-Post, RFC 8058).

Réactivation : case « e-mails » dans les réglages de l'app.
"""
import html

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import User
from ..ratelimit import HOUR, rate_limit
from ..services import analytics
from ..services.lifecycle_emails import verify_unsubscribe_token

router = APIRouter(prefix="/api/email", tags=["email"])

_COPY = {
    "fr": {
        "title": "Désinscription confirmée",
        "body": "Vous ne recevrez plus d'e-mails d'Alternly à l'adresse {email}. "
                "Vous pouvez les réactiver à tout moment dans vos réglages.",
        "cta": "Ouvrir mes réglages",
        "bad_title": "Lien invalide",
        "bad_body": "Ce lien de désinscription n'est pas valide. Vous pouvez couper les e-mails "
                    "directement dans vos réglages Alternly.",
    },
    "en": {
        "title": "You're unsubscribed",
        "body": "You will no longer receive emails from Alternly at {email}. "
                "You can turn them back on at any time in your settings.",
        "cta": "Open my settings",
        "bad_title": "Invalid link",
        "bad_body": "This unsubscribe link is not valid. You can turn emails off directly in "
                    "your Alternly settings.",
    },
}


def _page(lang: str, title: str, body: str, status: int = 200) -> HTMLResponse:
    c = _COPY[lang]
    settings_url = html.escape(f"{settings.app_url.rstrip('/')}/settings")
    return HTMLResponse(
        status_code=status,
        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"},
        content=(
            f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="robots" content="noindex">'
            f"<title>{html.escape(title)} · Alternly</title></head>"
            '<body style="margin:0;background:#fbfaf7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
            'color:#24312b;line-height:1.6">'
            '<main style="max-width:480px;margin:0 auto;padding:40px 16px">'
            '<p style="font-size:1.3rem;font-weight:600;margin:0 0 16px">altern<span style="color:#1f4d3f">ly</span></p>'
            '<div style="background:#f4f1ea;border-radius:16px;padding:24px">'
            f'<h1 style="font-size:1.25rem;margin:0 0 12px;color:#1f4d3f">{html.escape(title)}</h1>'
            f'<p style="margin:0 0 20px">{body}</p>'
            f'<a href="{settings_url}" style="display:inline-block;background:#1f4d3f;color:#fff;'
            f'padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">{c["cta"]}</a>'
            "</div></main></body></html>"
        ),
    )


def _unsubscribe(db: Session, token: str | None, source: str) -> User | None:
    user_id = verify_unsubscribe_token(token)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None or user.is_placeholder:
        return None
    if user.email_opt_in:
        user.email_opt_in = False
        db.commit()
        analytics.capture_for_user(user, "email_unsubscribed", {"source": source})
    return user


@router.get("/unsubscribe", response_class=HTMLResponse,
            dependencies=[Depends(rate_limit("unsubscribe", 30, HOUR))])
def unsubscribe_page(token: str | None = Query(default=None), db: Session = Depends(get_db)):
    user = _unsubscribe(db, token, "link")
    if user is None:
        c = _COPY["fr"]
        return _page("fr", c["bad_title"], html.escape(c["bad_body"]), status=400)
    lang = "en" if user.locale == "en" else "fr"
    c = _COPY[lang]
    body = html.escape(c["body"]).replace("{email}", f"<strong>{html.escape(user.email)}</strong>")
    return _page(lang, c["title"], body)


@router.post("/unsubscribe", dependencies=[Depends(rate_limit("unsubscribe", 30, HOUR))])
def unsubscribe_one_click(token: str | None = Query(default=None), db: Session = Depends(get_db)):
    if _unsubscribe(db, token, "one_click") is None:
        return JSONResponse(status_code=400, content={"detail": "Lien invalide"})
    return {"unsubscribed": True}
