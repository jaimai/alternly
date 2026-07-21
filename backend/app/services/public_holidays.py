"""Jours fériés français (métropole) via calendrier.api.gouv.fr, avec cache DB."""
from datetime import date

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import PublicHolidayCache

API_URL = "https://calendrier.api.gouv.fr/jours-feries/metropole/{year}.json"


class PublicDataUnavailable(Exception):
    pass


def get(db: Session, year: int, client: httpx.Client | None = None) -> dict[date, str]:
    cached = db.scalars(
        select(PublicHolidayCache).where(
            PublicHolidayCache.date >= date(year, 1, 1),
            PublicHolidayCache.date <= date(year, 12, 31),
        )
    ).all()
    if cached:
        return {row.date: row.label for row in cached}

    try:
        own_client = client is None
        client = client or httpx.Client(timeout=10)
        try:
            resp = client.get(API_URL.format(year=year))
            resp.raise_for_status()
            data = resp.json()
        finally:
            if own_client:
                client.close()
    except (httpx.HTTPError, ValueError) as e:
        raise PublicDataUnavailable(f"jours fériés {year} indisponibles : {e}") from e

    holidays = {date.fromisoformat(d): label for d, label in data.items()}
    for d, label in holidays.items():
        if not db.scalar(select(PublicHolidayCache).where(PublicHolidayCache.date == d)):
            db.add(PublicHolidayCache(date=d, label=label))
    db.commit()
    return holidays
