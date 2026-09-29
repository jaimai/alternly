"""Signalements « Problème / Idée / Question » envoyés depuis l'app ou le site.

Fonctionne connecté ou non. Chaque signalement est enregistré (table feedback)
puis envoyé par e-mail à `FEEDBACK_EMAIL`, avec l'adresse de l'utilisateur en
Reply-To pour répondre directement depuis la boîte mail.
"""
import html
import re
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_optional_user
from ..config import settings
from ..db import get_db
from ..deps import household_has_premium
from ..models import Feedback, HouseholdMember, User
from ..ratelimit import DAY, HOUR, check_account_limit, rate_limit
from ..services import analytics
from ..services import email as email_service

router = APIRouter(prefix="/api", tags=["feedback"])

KIND_LABELS = {"problem": "Problème", "idea": "Idée", "question": "Question"}


class FeedbackIn(BaseModel):
    kind: Literal["problem", "idea", "question"]
    message: str = Field(min_length=3, max_length=2000)
    # Obligatoire sans compte ; sinon l'e-mail du compte est utilisé par défaut.
    email: EmailStr | None = None
    source: Literal["fab", "settings", "footer"] = "fab"
    page: str = Field(default="", max_length=200)
    locale: Literal["fr", "en"] = "fr"
    # Champ piège : invisible pour un humain, rempli par les robots.
    website: str = ""


def _clean_page(page: str) -> str:
    """Route sans secret : les jetons d'invitation / de réinitialisation sont masqués."""
    path = page.split("?", 1)[0].split("#", 1)[0]
    path = re.sub(r"^/(join|reset-password)/[^/]+", r"/\1/…", path)
    return path[:120]


def _email_html(fb: Feedback, user: User | None) -> str:
    esc = html.escape
    rows = [
        ("Type", KIND_LABELS[fb.kind]),
        ("Répondre à", fb.reply_email),
        ("Page", fb.page or "—"),
        ("Source", fb.source),
        ("Langue", fb.locale),
        ("Compte", f"#{user.id}" if user else "non connecté"),
        ("Foyer", f"#{fb.household_id}" if fb.household_id else "—"),
        ("Premium", "oui" if fb.premium else "non"),
        ("Navigateur", fb.user_agent or "—"),
        ("Signalement", f"#{fb.id}"),
    ]
    table = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#5d6b63">{esc(k)}</td><td style="padding:4px 0">{esc(v)}</td></tr>'
        for k, v in rows
    )
    body = esc(fb.message).replace("\n", "<br>")
    return (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#24312b;font-size:15px">'
        f'<p style="white-space:normal;line-height:1.5;background:#faf6ef;padding:14px 16px;border-radius:10px">{body}</p>'
        f'<table style="font-size:13px;border-collapse:collapse">{table}</table>'
        "<p style=\"font-size:12px;color:#5d6b63\">Répondez directement à cet e-mail pour écrire à l'utilisateur.</p>"
        "</div>"
    )


def _send(bind, fb_id: int, to: str, subject: str, body: str, reply_to: str) -> None:
    """Tâche d'arrière-plan : envoi puis marquage `emailed` (session propre, même base)."""
    if not email_service.send_email(to, subject, body, reply_to=reply_to):
        return
    with Session(bind=bind) as db:
        fb = db.get(Feedback, fb_id)
        if fb is not None:
            fb.emailed = True
            db.commit()


@router.post(
    "/feedback",
    status_code=202,
    dependencies=[Depends(rate_limit("feedback", 5, HOUR))],
)
def send_feedback(
    data: FeedbackIn,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if data.website.strip():
        return {"ok": True}  # robot : réponse normale, rien n'est enregistré
    if user is not None:
        check_account_limit("feedback", user.id, 10, DAY)
    reply = (data.email or (user.email if user else "")).strip().lower()
    if not reply:
        raise HTTPException(status_code=422, detail="Indiquez une adresse e-mail pour que nous puissions vous répondre")

    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id)) if user else None
    fb = Feedback(
        kind=data.kind,
        message=data.message.strip(),
        reply_email=reply,
        user_id=user.id if user else None,
        household_id=member.household_id if member else None,
        premium=household_has_premium(db, member.household_id) if member else False,
        source=data.source,
        page=_clean_page(data.page),
        locale=data.locale,
        user_agent=(request.headers.get("user-agent") or "")[:200],
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)

    if settings.feedback_email:
        preview = re.sub(r"\s+", " ", fb.message)[:60]
        subject = f"[Alternly][{KIND_LABELS[fb.kind]}] {preview}"
        background.add_task(_send, db.get_bind(), fb.id, settings.feedback_email, subject, _email_html(fb, user), reply)
    analytics.capture_for_user(
        user, "feedback_sent", {"type": fb.kind, "source": fb.source}, household_id=fb.household_id
    )
    return {"ok": True}
