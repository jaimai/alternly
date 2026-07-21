"""Vacances scolaires officielles (zones A/B/C) via data.education.gouv.fr, cache DB.

Particularités du dataset `fr-en-calendrier-scolaire` :
- dates en datetime UTC (minuit Paris) → conversion Europe/Paris obligatoire ;
- end_date à minuit → le dernier jour vaqué est la veille (on stocke des bornes
  **incluses**) ;
- l'été n'est qu'un marqueur « Début des Vacances d'Été » : la fin se déduit de
  la « Rentrée scolaire des élèves » de l'année scolaire suivante (fallback 31/08) ;
- doublons fréquents (un enregistrement par académie) → déduplication.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SchoolHolidayCache
from .custody_engine import Period
from .public_holidays import PublicDataUnavailable

API_URL = (
    "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "fr-en-calendrier-scolaire/records"
)
PARIS = ZoneInfo("Europe/Paris")
SUMMER_START_LABEL = "Début des Vacances d'Été"
RENTREE_LABEL = "Rentrée scolaire des élèves"


def school_years_for_range(start: date, end: date) -> list[str]:
    """Années scolaires chevauchant [start, end] (bascule au 1er août)."""
    def year_start(d: date) -> int:
        return d.year if d.month >= 8 else d.year - 1

    return [f"{y}-{y + 1}" for y in range(year_start(start), year_start(end) + 1)]


def _parse_paris_date(value: str) -> date:
    return datetime.fromisoformat(value).astimezone(PARIS).date()


def _fetch_year(zone: str, school_year: str, client: httpx.Client) -> list[Period]:
    params = {
        "where": (
            f'zones="Zone {zone}" and annee_scolaire="{school_year}" '
            'and (population is null or population="-" or population="Élèves")'
        ),
        "limit": "60",
        "select": "description,start_date,end_date",
    }
    resp = client.get(API_URL, params=params)
    resp.raise_for_status()
    records = resp.json().get("results", [])

    periods: dict[tuple[str, date], Period] = {}
    for rec in records:
        if not rec.get("start_date") or not rec.get("end_date"):
            continue
        start = _parse_paris_date(rec["start_date"])
        end = _parse_paris_date(rec["end_date"])
        if end > start:
            end = end - timedelta(days=1)  # end_date à minuit → dernier jour vaqué = veille
        label = rec.get("description") or "Vacances"
        if label == SUMMER_START_LABEL:
            # marqueur : la vraie fin sera résolue via la rentrée suivante
            end = date(start.year, 8, 31)
        periods[(label, start)] = Period(label=label, start=start, end=end)
    return list(periods.values())


def _resolve_summer(periods: list[Period]) -> list[Period]:
    """Ajuste la fin de l'été avec la rentrée suivante, retire les marqueurs de rentrée."""
    rentrees = {p.start.year: p.start for p in periods if p.label == RENTREE_LABEL}
    out: list[Period] = []
    for p in periods:
        if p.label == RENTREE_LABEL:
            continue
        if p.label == SUMMER_START_LABEL:
            rentree = rentrees.get(p.start.year)
            end = rentree - timedelta(days=1) if rentree else p.end
            out.append(Period(label="Vacances d'Été", start=p.start, end=end))
        else:
            out.append(p)
    return out


def get(db: Session, zone: str, school_years: list[str], client: httpx.Client | None = None) -> list[Period]:
    """Périodes de vacances (bornes incluses) pour la zone, triées par date."""
    raw: list[Period] = []
    missing: list[str] = []

    for sy in school_years:
        cached = db.scalars(
            select(SchoolHolidayCache).where(
                SchoolHolidayCache.zone == zone,
                SchoolHolidayCache.school_year == sy,
            )
        ).all()
        if cached:
            raw.extend(Period(label=r.label, start=r.start, end=r.end) for r in cached)
        else:
            missing.append(sy)

    if missing:
        try:
            own_client = client is None
            client = client or httpx.Client(timeout=10)
            try:
                for sy in missing:
                    periods = _fetch_year(zone, sy, client)
                    for p in periods:
                        exists = db.scalar(
                            select(SchoolHolidayCache).where(
                                SchoolHolidayCache.zone == zone,
                                SchoolHolidayCache.label == p.label,
                                SchoolHolidayCache.school_year == sy,
                            )
                        )
                        if not exists:
                            db.add(
                                SchoolHolidayCache(
                                    zone=zone, label=p.label, start=p.start, end=p.end, school_year=sy
                                )
                            )
                    raw.extend(periods)
                db.commit()
            finally:
                if own_client:
                    client.close()
        except (httpx.HTTPError, ValueError) as e:
            raise PublicDataUnavailable(f"vacances scolaires indisponibles : {e}") from e

    return sorted(_resolve_summer(raw), key=lambda p: p.start)
