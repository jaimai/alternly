"""Notifications push vers l'app mobile (via le service Expo, relayé vers APNs / FCM).

Chaque `notify()` (deps.py) prépare ici un message pour les téléphones du
destinataire ; l'envoi a lieu après le commit de la requête, hors du fil de la
requête : jamais de push pour une action annulée, ni de latence réseau ajoutée.

Les textes reprennent ceux de la cloche du web (clés common.notif* de fr.json / en.json).
"""
import logging
import threading
from datetime import date

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import DeviceToken, User

log = logging.getLogger(__name__)

_BATCH = 100  # limite de l'API Expo par requête

# Catégories réglables par l'utilisateur (écran « Notifications » de l'app).
CATEGORIES = ("handover", "exchanges", "expenses", "wall", "household")


def category(type_: str) -> str:
    if type_.startswith(("exchange_", "change_")) or type_ == "exception_deleted":
        return "exchanges"
    if type_.startswith(("expense_", "settlement_")):
        return "expenses"
    if type_.startswith("wall_"):
        return "wall"
    if type_ == "handover_reminder":
        return "handover"
    return "household"


def wants_category(user: User, cat: str) -> bool:
    return (user.push_prefs or {}).get(cat, True) is not False


def wants(user: User, type_: str) -> bool:
    return wants_category(user, category(type_))


# ------------------------------------------------------------------ textes

_MONTHS = {
    "fr": ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
}


def _day(iso: str, locale: str) -> str:
    d = date.fromisoformat(iso[:10])
    month = _MONTHS[locale][d.month - 1]
    return f"{d.day} {month}" if locale == "fr" else f"{month} {d.day}"


def _range(p: dict, locale: str) -> str:
    start, end = p.get("date_start"), p.get("date_end") or p.get("date_start")
    if not start:
        return ""
    if start == end:
        return _day(start, locale)
    a, b = date.fromisoformat(start[:10]), date.fromisoformat(end[:10])
    if (a.year, a.month) == (b.year, b.month):  # « 17 → 18 oct. » / « Oct 17 → 18 », comme l'app
        return f"{a.day} → {_day(end, locale)}" if locale == "fr" else f"{_day(start, locale)} → {b.day}"
    return f"{_day(start, locale)} → {_day(end, locale)}"


def _money(cents, locale: str) -> str:
    try:
        value = int(cents) / 100
    except (TypeError, ValueError):
        return ""
    if locale == "fr":
        return f"{value:,.2f} €".replace(",", " ").replace(".", ",")
    return f"€{value:,.2f}"


_TITLES = {
    "fr": {"handover": "Passation", "exchanges": "Échange de garde", "expenses": "Dépenses", "wall": "Tableau", "household": "Alternly"},
    "en": {"handover": "Handover", "exchanges": "Custody swap", "expenses": "Expenses", "wall": "Wall", "household": "Alternly"},
}


def message(type_: str, p: dict, locale: str) -> tuple[str, str]:
    """(titre, texte) d'une notification, dans la langue du destinataire."""
    loc = "en" if locale == "en" else "fr"
    fr = loc == "fr"
    r = _range(p, loc)
    q = ("« ", " »") if fr else ("“", "”")
    texts = {
        "exchange_proposed": (
            (f"Nouvel échange proposé ({r}) — {q[0]}{p.get('note')}{q[1]} — à accepter ou refuser" if p.get("note")
             else f"Nouvel échange proposé ({r}) — à accepter ou refuser")
            if fr else
            (f"New swap proposed ({r}) — {q[0]}{p.get('note')}{q[1]} — accept or decline" if p.get("note")
             else f"New swap proposed ({r}) — accept or decline")
        ),
        "exchange_accepted": f"Votre proposition d'échange a été acceptée ({r})" if fr else f"Your swap request was accepted ({r})",
        "exchange_refused": f"Votre proposition d'échange a été refusée ({r})" if fr else f"Your swap request was declined ({r})",
        "exchange_withdrawn": f"Une proposition d'échange a été retirée ({r})" if fr else f"A swap request was withdrawn ({r})",
        "exception_deleted": f"Échange de garde annulé ({r})" if fr else f"Custody swap canceled ({r})",
        "change_requested": (f"Demande de changement à valider : {p.get('summary', '')}" if fr
                             else f"Change request awaiting your approval: {p.get('summary', '')}"),
        "change_accepted": f"Votre demande a été acceptée : {p.get('summary', '')}" if fr else f"Your request was accepted: {p.get('summary', '')}",
        "change_refused": f"Votre demande a été refusée : {p.get('summary', '')}" if fr else f"Your request was declined: {p.get('summary', '')}",
        "rule_changed": "Les règles de garde ont été modifiées" if fr else "The custody rules were changed",
        "invite_reminder": (
            "L'autre parent n'a pas encore rejoint le calendrier. Renvoyez-lui l'invitation." if fr
            else "Your co-parent hasn't joined the calendar yet. Resend the invitation."
        ),
        "parent_joined": f"{p.get('display_name', '')} a rejoint le foyer" if fr else f"{p.get('display_name', '')} joined the household",
        "parent_left": f"{p.get('display_name', '')} a supprimé son compte" if fr else f"{p.get('display_name', '')} deleted their account",
        "expense_added": (f"Nouvelle dépense {q[0]}{p.get('label')}{q[1]} ({_money(p.get('amount_cents'), loc)})" if fr
                          else f"New expense {q[0]}{p.get('label')}{q[1]} ({_money(p.get('amount_cents'), loc)})"),
        "expense_updated": (f"La dépense {q[0]}{p.get('label')}{q[1]} a été modifiée ({_money(p.get('amount_cents'), loc)})" if fr
                            else f"The expense {q[0]}{p.get('label')}{q[1]} was edited ({_money(p.get('amount_cents'), loc)})"),
        "expense_disputed": (f"Votre dépense {q[0]}{p.get('label')}{q[1]} a été contestée" if fr
                             else f"Your expense {q[0]}{p.get('label')}{q[1]} was disputed"),
        "expense_resolved": (f"La contestation sur {q[0]}{p.get('label')}{q[1]} a été levée" if fr
                             else f"The dispute on {q[0]}{p.get('label')}{q[1]} was resolved"),
        "expense_settled": f"{q[0]}{p.get('label')}{q[1]} a été marquée remboursée" if fr else f"{q[0]}{p.get('label')}{q[1]} was marked as reimbursed",
        "settlement_recorded": (f"Remboursement enregistré ({_money(p.get('amount_cents'), loc)})" if fr
                                else f"Reimbursement recorded ({_money(p.get('amount_cents'), loc)})"),
        "wall_post_added": f"Nouveau sur le tableau : {q[0]}{p.get('body')}{q[1]}" if fr else f"New on the wall: {q[0]}{p.get('body')}{q[1]}",
        "wall_reply_added": f"Nouvelle réponse : {q[0]}{p.get('body')}{q[1]}" if fr else f"New reply: {q[0]}{p.get('body')}{q[1]}",
        "wall_task_assigned": (f"Une tâche vous a été assignée : {q[0]}{p.get('body')}{q[1]}" if fr
                               else f"A task was assigned to you: {q[0]}{p.get('body')}{q[1]}"),
        "handover_reminder": p.get("text", ""),
    }
    body = texts.get(type_) or ("Nouvelle activité dans votre foyer" if fr else "New activity in your household")
    return _TITLES[loc][category(type_)], body


# ------------------------------------------------------------------ envoi

def prepare(db: Session, user_id: int, type_: str, payload: dict) -> list[dict]:
    """Messages Expo pour les téléphones de l'utilisateur (vide si aucun ou désactivé)."""
    user = db.get(User, user_id)
    if user is None or user.is_placeholder or not wants(user, type_):
        return []
    tokens = db.scalars(select(DeviceToken.token).where(DeviceToken.user_id == user_id)).all()
    if not tokens:
        return []
    title, body = message(type_, payload, user.locale)
    data = {"type": type_, **{k: v for k, v in payload.items() if k in ("id", "post_id", "date_start")}}
    return [{"to": t, "title": title, "body": body, "sound": "default", "data": data} for t in tokens]


def queue(db: Session, messages: list[dict]) -> None:
    """Réserve des messages, envoyés au commit de la session (cf. install_session_hooks)."""
    if messages:
        db.info.setdefault("pending_push", []).extend(messages)


def _post(messages: list[dict]) -> list[dict]:
    with httpx.Client(timeout=10) as client:
        resp = client.post(settings.push_api_url, json=messages, headers={"Accept": "application/json"})
        resp.raise_for_status()
        return resp.json().get("data", [])


def _forget(tokens: list[str]) -> None:
    """Supprime les jetons que le service déclare invalides (app désinstallée…)."""
    from ..db import SessionLocal

    with SessionLocal() as db:
        db.execute(delete(DeviceToken).where(DeviceToken.token.in_(tokens)))
        db.commit()


def deliver(messages: list[dict]) -> None:
    """Envoi par lots ; une erreur réseau ne remonte jamais jusqu'à l'utilisateur."""
    for i in range(0, len(messages), _BATCH):
        batch = messages[i:i + _BATCH]
        try:
            tickets = _post(batch)
        except Exception:  # noqa: BLE001 — le push est best effort
            log.warning("push : envoi Expo en échec (%d messages)", len(batch), exc_info=True)
            continue
        dead = [
            m["to"] for m, t in zip(batch, tickets)
            if t.get("status") == "error" and (t.get("details") or {}).get("error") == "DeviceNotRegistered"
        ]
        if dead:
            try:
                _forget(dead)
            except Exception:  # noqa: BLE001
                log.warning("push : nettoyage des jetons invalides en échec", exc_info=True)


def _run(fn, messages: list[dict]) -> None:
    """Hors du fil de la requête (remplacé par un appel direct dans les tests)."""
    threading.Thread(target=fn, args=(messages,), daemon=True).start()


def flush(messages: list[dict]) -> None:
    if messages:
        _run(deliver, messages)


def install_session_hooks(session_cls) -> None:
    """Envoie les push réservés après un commit réussi ; les oublie sur rollback."""
    from sqlalchemy import event

    @event.listens_for(session_cls, "after_commit")
    def _after_commit(session):  # noqa: ANN001
        flush(session.info.pop("pending_push", []))

    @event.listens_for(session_cls, "after_rollback")
    def _after_rollback(session):  # noqa: ANN001
        session.info.pop("pending_push", None)
