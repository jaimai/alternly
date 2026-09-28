"""Outil public « Qui a les enfants pendant les vacances ? » (sans compte).

Aucune réimplémentation : le partage est calculé par `resolve_calendar` du moteur
de garde, exactement comme pour un foyer de l'app, avec une règle construite en
mémoire (deux parents opaques « A » et « B », aucun foyer en base). Seules les
vacances scolaires officielles (cache DB + data.education.gouv.fr) sont lues.
"""
import threading
import time
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy.orm import Session

from . import school_holidays
from .custody_engine import EngineRule, EngineVacationRule, Period, resolve_calendar
from .public_holidays import PublicDataUnavailable

PARENTS = ("A", "B")
ZONES = ("A", "B", "C")
MODES = ("split_half", "alternate_full")

# Clé d'URL → (libellé affiché, mot-clé du libellé officiel, l'année civile de début
# est-elle celle de la rentrée ? (True : Toussaint/Noël, False : hiver/printemps/été))
PERIODS: dict[str, tuple[str, str, bool]] = {
    "toussaint": ("Toussaint", "toussaint", True),
    "noel": ("Noël", "noël", True),
    "hiver": ("Hiver", "hiver", False),
    "printemps": ("Printemps", "printemps", False),
    "ete": ("Été", "été", False),
}
# Fin approximative (mois, jour) de chaque période, pour choisir « la prochaine »
# sans appel réseau (année civile de début de la période).
_APPROX_END = {"toussaint": (11, 5), "noel": (1, 6), "hiver": (3, 10), "printemps": (5, 10), "ete": (8, 31)}

JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]
JOURS_LONGS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def today() -> date:
    """Point d'injection pour les tests (fenêtre d'années autorisées)."""
    return date.today()


def school_year_start(d: date) -> int:
    return d.year if d.month >= 8 else d.year - 1


def period_school_year(period: str, year: int) -> str:
    """Année scolaire d'une période désignée par son année civile de début."""
    y0 = year if PERIODS[period][2] else year - 1
    return f"{y0}-{y0 + 1}"


def period_options(ref: date | None = None) -> list[dict]:
    """Périodes proposées : année scolaire en cours et suivante, dans l'ordre."""
    ref = ref or today()
    sy = school_year_start(ref)
    out = []
    for y0 in (sy, sy + 1):
        for key, (label, _, starts_with_rentree) in PERIODS.items():
            year = y0 if starts_with_rentree else y0 + 1
            end_m, end_d = _APPROX_END[key]
            approx_end = date(year + 1 if key == "noel" else year, end_m, end_d)
            out.append({
                "key": key,
                "year": year,
                "value": f"{key}-{year}",
                "label": f"{label} {year}" if key != "noel" else f"Noël {year}-{year + 1}",
                "school_year": f"{y0}-{y0 + 1}",
                "past": approx_end < ref,
            })
    return out


def default_option(ref: date | None = None) -> dict:
    opts = period_options(ref)
    return next((o for o in opts if not o["past"]), opts[-1])


def allowed_years(ref: date | None = None) -> set[int]:
    return {o["year"] for o in period_options(ref)}


def fmt_day(d: date) -> str:
    """« sam. 17 oct. » — format court utilisé dans le résultat."""
    day = "1er" if d.day == 1 else str(d.day)
    return f"{JOURS[d.weekday()]} {day} {MOIS[d.month - 1]}"


def fmt_day_long(d: date) -> str:
    day = "1er" if d.day == 1 else str(d.day)
    return f"{JOURS_LONGS[d.weekday()]} {day} {MOIS[d.month - 1]} {d.year}"


class PeriodNotPublished(Exception):
    """Dates officielles pas (encore) disponibles pour cette zone / période."""


def find_period(periods: list[Period], period: str, year: int) -> Period | None:
    keyword = PERIODS[period][1]
    for p in periods:
        if keyword in p.label.lower() and p.start.year == year:
            return p
    return None


@dataclass
class _Entry:
    value: dict
    expires: float


class _TTLCache:
    """Petit cache mémoire des résultats (par processus, comme le rate limit)."""

    def __init__(self, ttl: int = 6 * 3600, max_size: int = 512):
        self.ttl, self.max_size = ttl, max_size
        self._data: dict[tuple, _Entry] = {}
        self._lock = threading.Lock()

    def get(self, key: tuple) -> dict | None:
        with self._lock:
            e = self._data.get(key)
            if e and e.expires > time.monotonic():
                return e.value
            self._data.pop(key, None)
            return None

    def set(self, key: tuple, value: dict) -> None:
        with self._lock:
            if len(self._data) >= self.max_size:
                self._data.clear()
            self._data[key] = _Entry(value, time.monotonic() + self.ttl)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


cache = _TTLCache()


def compute_split(period: Period, mode: str, even_first: str) -> list[dict]:
    """Segments consécutifs [{parent, start, end}] via le moteur de garde.

    Règle en mémoire : les parents sont « A » et « B » ; le rythme de base
    (semaine/semaine) n'intervient pas puisqu'on ne résout que les jours de la
    période, tous couverts par la règle de vacances.
    """
    rule = EngineRule(
        pattern="alternate_weeks", start_date=period.start,
        reference_parent="A", other_parent="B",
    )
    vac = EngineVacationRule(mode=mode, even_year_first_half_parent=even_first)
    days = resolve_calendar(
        rule=rule, vacation_rule=vac, special_rules=[], exceptions=[],
        school_periods=[period], start=period.start, end=period.end,
    )
    segments: list[dict] = []
    for d in days:
        if segments and segments[-1]["parent"] == d.parent:
            segments[-1]["end"] = d.day
        else:
            segments.append({"parent": d.parent, "start": d.day, "end": d.day})
    return segments


def vacation_split(db: Session, zone: str, period: str, year: int, mode: str, even_first: str) -> dict:
    """Dates officielles + partage. Lève PublicDataUnavailable / PeriodNotPublished."""
    key = (zone, period, year, mode, even_first)
    hit = cache.get(key)
    if hit is not None:
        return hit

    school_year = period_school_year(period, year)
    periods = school_holidays.get(db, zone, [school_year])
    if period == "ete":
        # La fin de l'été se déduit de la rentrée de l'année scolaire suivante
        # (même logique que le calendrier de l'app) ; à défaut, 31 août.
        y1 = int(school_year[:4]) + 1
        try:
            periods = school_holidays.get(db, zone, [school_year, f"{y1}-{y1 + 1}"])
        except PublicDataUnavailable:
            pass
    p = find_period(periods, period, year)
    if p is None:
        raise PeriodNotPublished(f"{period} {year} zone {zone}")

    segments = compute_split(p, mode, even_first)
    n_days = (p.end - p.start).days + 1
    handover = segments[1]["start"] if len(segments) > 1 else None
    result = {
        "zone": zone,
        "period": {
            "key": period,
            "label": p.label,
            "school_year": school_year,
            "start": p.start.isoformat(),
            "end": p.end.isoformat(),
            "days": n_days,
            "resume": (p.end + timedelta(days=1)).isoformat(),
            "start_label": fmt_day(p.start),
            "end_label": fmt_day(p.end),
            "resume_label": fmt_day(p.end + timedelta(days=1)),
        },
        "mode": mode,
        "even_first": even_first,
        "year_parity": "paire" if p.start.year % 2 == 0 else "impaire",
        "segments": [
            {
                "parent": s["parent"],
                "start": s["start"].isoformat(),
                "end": s["end"].isoformat(),
                "days": (s["end"] - s["start"]).days + 1,
                "start_label": fmt_day(s["start"]),
                "end_label": fmt_day(s["end"]),
            }
            for s in segments
        ],
        "timeline": [
            {
                "date": (s["start"] + timedelta(days=i)).isoformat(),
                "parent": s["parent"],
                "day": (s["start"] + timedelta(days=i)).day,
                "dow": "LMMJVSD"[(s["start"] + timedelta(days=i)).weekday()],
            }
            for s in segments
            for i in range((s["end"] - s["start"]).days + 1)
        ],
        "handover": {"date": handover.isoformat(), "label": fmt_day(handover)} if handover else None,
        "source": "Calendrier scolaire officiel (data.education.gouv.fr)",
    }
    cache.set(key, result)
    return result


__all__ = [
    "PARENTS", "ZONES", "MODES", "PERIODS", "PeriodNotPublished", "PublicDataUnavailable",
    "allowed_years", "compute_split", "default_option", "period_options", "vacation_split",
]
