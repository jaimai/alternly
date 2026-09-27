"""Relances de la boucle d'invitation du coparent (appelées par le cron quotidien).

Idempotent : chaque relance est horodatée sur l'invitation (ou l'utilisateur)
et n'est jamais renvoyée, même si le cron tourne plusieurs fois par jour.

- inviteur : e-mail (si `email_opt_in`) + notification in-app à J+2 et J+5 ;
- invité (si son e-mail a été saisi) : un seul rappel doux à J+3 ;
- onboarding terminé sans aucune invitation après 24 h : une seule relance
  (fenêtre de 14 jours pour ne pas écrire aux comptes dormants anciens).

Seule la dernière invitation d'un foyer encore solo, non acceptée et non
expirée est relancée.
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import notify
from ..models import Child, CustodyRule, Household, HouseholdMember, Invitation, User, utcnow
from . import analytics
from . import email as email_service

INVITATION_TTL = timedelta(days=14)
INVITER_DAYS = (2, 5)
INVITEE_DAY = 3
NUDGE_AFTER = timedelta(hours=24)
NUDGE_WINDOW = timedelta(days=14)


def _created_at(inv: Invitation) -> datetime:
    # Invitations antérieures à la colonne created_at : déduite de l'expiration.
    return inv.created_at or (inv.expires_at - INVITATION_TTL)


def _real_member_ids(db: Session, household_id: int) -> list[int]:
    ids = []
    for m in db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household_id)):
        u = db.get(User, m.user_id)
        if u is not None and not u.is_placeholder:
            ids.append(u.id)
    return ids


def _latest_ids(db: Session) -> set[int]:
    latest: dict[int, int] = {}
    for inv_id, hid in db.execute(select(Invitation.id, Invitation.household_id)):
        if inv_id > latest.get(hid, 0):
            latest[hid] = inv_id
    return set(latest.values())


def _children(db: Session, household_id: int) -> list[str]:
    return [
        c.first_name
        for c in db.scalars(select(Child).where(Child.household_id == household_id).order_by(Child.id))
    ]


def run(db: Session, now: datetime | None = None) -> dict[str, int]:
    now = now or utcnow()
    stats = {"inviter_emails": 0, "inviter_notifications": 0, "invitee_emails": 0, "nudges": 0}
    latest = _latest_ids(db)
    pending = db.scalars(
        select(Invitation).where(Invitation.used_at.is_(None), Invitation.expires_at > now)
    ).all()
    for inv in pending:
        if inv.id not in latest or len(_real_member_ids(db, inv.household_id)) >= 2:
            continue
        age = now - _created_at(inv)
        inviter = db.get(User, inv.invited_by)
        # Inviteur : J+5 prime sur J+2 (jamais deux relances le même jour).
        day = None
        if age >= timedelta(days=5) and inv.inviter_reminder_d5_at is None:
            day = 5
            inv.inviter_reminder_d5_at = now
            inv.inviter_reminder_d2_at = inv.inviter_reminder_d2_at or now
        elif age >= timedelta(days=2) and inv.inviter_reminder_d2_at is None:
            day = 2
            inv.inviter_reminder_d2_at = now
        if day is not None and inviter is not None:
            notify(db, inviter.id, "invite_reminder", {"day": day})
            stats["inviter_notifications"] += 1
            if inviter.email_opt_in:
                subject, html = email_service.inviter_reminder_email(day, inviter.locale)
                if email_service.send_email(inviter.email, subject, html):
                    stats["inviter_emails"] += 1
            analytics.capture_for_user(
                inviter, "invite_reminder_sent",
                {"day": day, "target": "inviter", "email": bool(inviter.email_opt_in)},
                household_id=inv.household_id,
            )
        # Invité : un seul rappel doux à J+3, si son adresse a été saisie.
        if inv.invitee_email and inv.invitee_reminder_at is None and age >= timedelta(days=INVITEE_DAY):
            inv.invitee_reminder_at = now
            subject, html = email_service.invitation_email(
                inviter.display_name if inviter else "",
                _children(db, inv.household_id),
                inv.token,
                inv.invitee_locale,
                reminder=True,
            )
            if email_service.send_email(inv.invitee_email, subject, html):
                stats["invitee_emails"] += 1
            analytics.capture(None, "invite_reminder_sent", {"day": INVITEE_DAY, "target": "invitee"})
        db.commit()

    stats["nudges"] = _onboarding_nudges(db, now)
    return stats


def _onboarding_nudges(db: Session, now: datetime) -> int:
    """Onboarding terminé (règle de garde posée) depuis 24 h sans aucune invitation."""
    invited = set(db.scalars(select(Invitation.household_id).distinct()))
    sent = 0
    rows = db.execute(
        select(Household, HouseholdMember)
        .join(CustodyRule, CustodyRule.household_id == Household.id)
        .join(HouseholdMember, HouseholdMember.household_id == Household.id)
        .where(
            Household.created_at <= now - NUDGE_AFTER,
            Household.created_at >= now - NUDGE_WINDOW,
        )
    ).all()
    for household, member in rows:
        if household.id in invited:
            continue
        user = db.get(User, member.user_id)
        if user is None or user.is_placeholder or user.invite_nudge_sent_at is not None:
            continue
        if len(_real_member_ids(db, household.id)) >= 2:
            continue
        user.invite_nudge_sent_at = now  # marqué même si opt-out : jamais renvoyé
        if user.email_opt_in:
            subject, html = email_service.invite_nudge_email(user.locale)
            if email_service.send_email(user.email, subject, html):
                sent += 1
                analytics.capture_for_user(user, "invite_nudge_sent", {}, household_id=household.id)
        db.commit()
    return sent
