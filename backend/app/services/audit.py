"""Journal d'audit du foyer (ajout seul) et formatage français des résumés."""
from datetime import date

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from ..models import AuditLog

_DAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]
_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def fr_date(d: date) -> str:
    """« jeu. 1 oct. »"""
    return f"{_DAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]}"


def fr_range(start: date, end: date) -> str:
    return fr_date(start) if start == end else f"{fr_date(start)} → {fr_date(end)}"


def euros(cents: int) -> str:
    """« 1 234,50 € »"""
    whole, frac = divmod(abs(int(cents)), 100)
    grouped = f"{whole:,}".replace(",", " ")
    sign = "-" if cents < 0 else ""
    return f"{sign}{grouped},{frac:02d} €"


def excerpt(text: str, limit: int = 60) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def record(
    db: Session,
    household_id: int,
    actor_id: int | None,
    action: str,
    entity: str,
    entity_id: int | None,
    summary: str,
    data: dict | None = None,
) -> None:
    """Ajoute une entrée au journal (sans commit : même transaction que la modification)."""
    db.add(
        AuditLog(
            household_id=household_id,
            actor_id=actor_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            summary=summary,
            data=jsonable_encoder(data) if data is not None else None,
        )
    )
