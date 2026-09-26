"""Jours fériés français (métropole) via calendrier.api.gouv.fr, avec cache DB."""
import time
from datetime import date

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import PublicHolidayCache

API_URL = "https://calendrier.api.gouv.fr/jours-feries/metropole/{year}.json"


# Injectable en test (httpx.MockTransport) ; None → transport réseau réel.
_transport: httpx.BaseTransport | None = None

EMPTY_TTL = 6 * 3600  # année pas encore publiée : on ne redemande pas avant 6 h
ERROR_TTL = 5 * 60  # API en panne : on ne la martèle pas (ni ne bloque chaque requête)


class PublicDataUnavailable(Exception):
    pass


class NegativeCache:
    """Mémo en processus des résultats vides / échecs (non persistés en DB)."""

    def __init__(self) -> None:
        self._entries: dict[tuple, tuple[float, str]] = {}

    def get(self, key: tuple) -> str | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry[0] <= time.monotonic():
            del self._entries[key]
            return None
        return entry[1]

    def set(self, key: tuple, kind: str) -> None:
        ttl = EMPTY_TTL if kind == "empty" else ERROR_TTL
        self._entries[key] = (time.monotonic() + ttl, kind)

    def clear(self) -> None:
        self._entries.clear()


def http_client() -> httpx.Client:
    return httpx.Client(transport=_transport, timeout=10)


def commit_cache(db: Session) -> None:
    """Commit des lignes de cache ; une requête concurrente a pu les insérer avant nous."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


_memo = NegativeCache()


def get(db: Session, year: int, client: httpx.Client | None = None) -> dict[date, str]:
    cached = db.scalars(
        select(PublicHolidayCache).where(
            PublicHolidayCache.date >= date(year, 1, 1),
            PublicHolidayCache.date <= date(year, 12, 31),
        )
    ).all()
    if cached:
        return {row.date: row.label for row in cached}

    key = ("public", year)
    memo = _memo.get(key)
    if memo == "empty":
        return {}
    if memo == "error":
        raise PublicDataUnavailable(f"jours fériés {year} indisponibles (échec récent)")

    try:
        own_client = client is None
        client = client or http_client()
        try:
            resp = client.get(API_URL.format(year=year))
            resp.raise_for_status()
            data = resp.json()
        finally:
            if own_client:
                client.close()
        holidays = {date.fromisoformat(d): label for d, label in data.items()}
    except (httpx.HTTPError, ValueError, AttributeError) as e:
        _memo.set(key, "error")
        raise PublicDataUnavailable(f"jours fériés {year} indisponibles : {e}") from e

    if not holidays:
        _memo.set(key, "empty")
        return {}
    for d, label in holidays.items():
        if not db.scalar(select(PublicHolidayCache).where(PublicHolidayCache.date == d)):
            db.add(PublicHolidayCache(date=d, label=label))
    commit_cache(db)
    return holidays
