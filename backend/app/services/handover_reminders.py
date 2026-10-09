"""Rappel push la veille d'une passation (changement de parent le lendemain).

Lancé chaque soir par le planificateur (POST /api/cron/handover-reminders).
Push seulement (pas de notification in-app ni d'e-mail) ; idempotent grâce à
email_log, qui journalise aussi ce type d'envoi (kind « push:handover:<date> »).
"""
import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import household_members
from ..models import Child, CustodyRule, EmailLog, Household, User
from . import push
from .calendar_service import NoCustodyRule, build_calendar

log = logging.getLogger(__name__)


def _kids(names: list[str], locale: str) -> str:
    if not names:
        return "les enfants" if locale == "fr" else "the kids"
    if len(names) == 1:
        return names[0]
    joiner = " et " if locale == "fr" else " and "
    return ", ".join(names[:-1]) + joiner + names[-1]


def reminder_text(locale: str, kids: str, receiving: bool, other_name: str, time: str | None) -> str:
    """« Demain, Léa et Hugo arrivent chez vous (vers 18:00). » et ses variantes."""
    if locale == "en":
        at = f" (around {time})" if time else ""
        return f"Tomorrow, {kids} come to you{at}." if receiving else f"Tomorrow, {kids} go to {other_name}'s{at}."
    at = f" (vers {time})" if time else ""
    return f"Demain, {kids} arrivent chez vous{at}." if receiving else f"Demain, {kids} partent chez {other_name}{at}."


def run(db: Session, today: date | None = None) -> dict:
    today = today or date.today()
    tomorrow = today + timedelta(days=1)
    kind = f"push:handover:{tomorrow.isoformat()}"
    households = db.scalars(select(Household).where(Household.id.in_(select(CustodyRule.household_id)))).all()
    sent = 0
    for household in households:
        try:
            days = {d.day: d for d in build_calendar(db, household, today, tomorrow).days}
        except NoCustodyRule:
            continue
        except Exception:  # noqa: BLE001 — un foyer en erreur ne bloque pas les autres
            log.warning("handover-reminders : calendrier du foyer %s en échec", household.id, exc_info=True)
            continue
        now, nxt = days.get(today), days.get(tomorrow)
        if now is None or nxt is None or now.parent == nxt.parent:
            continue
        time = days[tomorrow].source == "rule" and _handover_time(db, household.id) or None
        names = [c.first_name for c in db.scalars(select(Child).where(Child.household_id == household.id).order_by(Child.id))]
        users = {m.user_id: db.get(User, m.user_id) for m in household_members(db, household.id)}
        receiver_id = int(nxt.parent)
        for uid, user in users.items():
            if user is None or user.is_placeholder:
                continue
            if db.scalar(select(EmailLog).where(EmailLog.user_id == uid, EmailLog.kind == kind)):
                continue  # déjà prévenu (le cron est rejoué)
            loc = "en" if user.locale == "en" else "fr"
            other = next((u for i, u in users.items() if i != uid and u is not None), None)
            other_name = (
                other.display_name if other is not None and not other.is_placeholder
                else ("l'autre parent" if loc == "fr" else "the other parent")
            )
            text = reminder_text(loc, _kids(names, loc), uid == receiver_id, other_name, time)
            messages = push.prepare(db, uid, "handover_reminder", {"text": text, "date_start": tomorrow.isoformat()})
            if not messages:
                continue
            db.add(EmailLog(user_id=uid, kind=kind))
            try:
                db.commit()  # journalisé d'abord : un rejeu n'enverra jamais deux fois
            except IntegrityError:
                db.rollback()
                continue
            push.flush(messages)
            sent += len(messages)
    return {"sent": sent}


def _handover_time(db: Session, household_id: int) -> str | None:
    rule = db.scalar(select(CustodyRule).where(CustodyRule.household_id == household_id))
    return rule.handover_time if rule else None
