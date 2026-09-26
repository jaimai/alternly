"""Moteur de garde : fonctions pures, aucune I/O.

Les parents sont des identifiants opaques (str). La granularité est le jour.
Priorité de résolution : exception > fête > vacances scolaires > rythme de base.
"""
import math
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass
class EngineRule:
    pattern: str  # alternate_weeks | two_two_three | every_other_weekend | custom
    start_date: date
    reference_parent: str
    other_parent: str
    handover_day: int = 0  # 0 = lundi
    custom_weeks: list[str] | None = None  # 14 x "ref"/"other"


@dataclass
class DayAssignment:
    day: date
    parent: str
    source: str  # rule | vacation | special | exception


@dataclass
class EngineVacationRule:
    mode: str  # split_half | alternate_full
    even_year_first_half_parent: str


@dataclass
class Period:
    """Période de vacances scolaires, bornes incluses (jours sans école)."""
    label: str
    start: date
    end: date


@dataclass
class EngineSpecialRule:
    kind: str  # christmas_eve | christmas_day | mothers_day | fathers_day
    parent: str | None = None       # mode fixe / auto : parent résolu
    enabled: bool = True
    # mode alternance annuelle : années paires → even_parent, impaires → odd_parent
    even_parent: str | None = None
    odd_parent: str | None = None

    def parent_for_year(self, year: int) -> str:
        if self.even_parent is not None:
            return self.even_parent if year % 2 == 0 else self.odd_parent
        return self.parent


@dataclass
class EngineException:
    start: date
    end: date
    parent: str


# Motif 2-2-3 standard sur 14 jours, ancré au lundi :
# sem 1 : 2 ref / 2 other / 3 ref — sem 2 : miroir.
_TWO_TWO_THREE = ["ref", "ref", "other", "other", "ref", "ref", "ref",
                  "other", "other", "ref", "ref", "other", "other", "other"]


def anchor_monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _pick(rule: EngineRule, token: str) -> str:
    return rule.reference_parent if token == "ref" else rule.other_parent


def base_pattern_parent(rule: EngineRule, day: date) -> str:
    if rule.pattern == "alternate_weeks":
        # Premier jour de bascule ≤ start_date : la "semaine 0" appartient au référent.
        offset = (rule.start_date.weekday() - rule.handover_day) % 7
        cycle_start = rule.start_date - timedelta(days=offset)
        weeks = (day - cycle_start).days // 7
        return rule.reference_parent if weeks % 2 == 0 else rule.other_parent

    if rule.pattern == "two_two_three":
        idx = (day - anchor_monday(rule.start_date)).days % 14
        return _pick(rule, _TWO_TWO_THREE[idx])

    if rule.pattern == "every_other_weekend":
        if day.weekday() < 4:  # lun-jeu
            return rule.other_parent
        weeks = (anchor_monday(day) - anchor_monday(rule.start_date)).days // 7
        return rule.reference_parent if weeks % 2 == 0 else rule.other_parent

    if rule.pattern == "custom":
        if not rule.custom_weeks or len(rule.custom_weeks) != 14:
            raise ValueError("custom_weeks doit contenir exactement 14 entrées")
        idx = (day - anchor_monday(rule.start_date)).days % 14
        return _pick(rule, rule.custom_weeks[idx])

    raise ValueError(f"pattern inconnu : {rule.pattern}")


def easter_sunday(year: int) -> date:
    """Dimanche de Pâques (algorithme de Butcher, calendrier grégorien)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _last_sunday_of_may(year: int) -> date:
    d = date(year, 5, 31)
    return d - timedelta(days=(d.weekday() - 6) % 7)


def mothers_day(year: int) -> date:
    """Dernier dimanche de mai, décalé au 1er dimanche de juin si Pentecôte."""
    candidate = _last_sunday_of_may(year)
    pentecost = easter_sunday(year) + timedelta(days=49)
    if candidate == pentecost:
        d = date(year, 6, 1)
        return d + timedelta(days=(6 - d.weekday()) % 7)
    return candidate


def fathers_day(year: int) -> date:
    """3e dimanche de juin (identique FR/US)."""
    d = date(year, 6, 1)
    first_sunday = d + timedelta(days=(6 - d.weekday()) % 7)
    return first_sunday + timedelta(days=14)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-ième `weekday` (0=lundi … 6=dimanche) du mois."""
    d = date(year, month, 1)
    first = d + timedelta(days=(weekday - d.weekday()) % 7)
    return first + timedelta(days=7 * (n - 1))


def mothers_day_us(year: int) -> date:
    """Mother's Day US : 2e dimanche de mai."""
    return _nth_weekday(year, 5, 6, 2)


def thanksgiving(year: int) -> date:
    """Thanksgiving US : 4e jeudi de novembre."""
    return _nth_weekday(year, 11, 3, 4)


def special_day_date(kind: str, year: int, country: str = "FR") -> date:
    if kind == "christmas_eve":
        return date(year, 12, 24)
    if kind == "christmas_day":
        return date(year, 12, 25)
    if kind == "new_years_day":
        return date(year, 1, 1)
    if kind == "independence_day":  # US : 4 juillet
        return date(year, 7, 4)
    if kind == "halloween":
        return date(year, 10, 31)
    if kind == "thanksgiving":
        return thanksgiving(year)
    if kind == "mothers_day":
        return mothers_day_us(year) if country == "US" else mothers_day(year)
    if kind == "fathers_day":
        return fathers_day(year)
    raise ValueError(f"fête inconnue : {kind}")


# Compat : ancien nom interne (sans pays).
def _special_day_date(kind: str, year: int) -> date:
    return special_day_date(kind, year, "FR")


def _vacation_parent(vac: EngineVacationRule, period: Period, day: date, other_parent_of: dict[str, str]) -> str:
    even_parent = vac.even_year_first_half_parent
    odd_parent = other_parent_of[even_parent]
    first_half_parent = even_parent if period.start.year % 2 == 0 else odd_parent
    second_half_parent = other_parent_of[first_half_parent]

    if vac.mode == "alternate_full":
        return first_half_parent

    n_days = (period.end - period.start).days + 1
    first_half_len = math.ceil(n_days / 2)
    idx = (day - period.start).days
    return first_half_parent if idx < first_half_len else second_half_parent


def resolve_calendar(
    rule: EngineRule,
    vacation_rule: EngineVacationRule | None,
    special_rules: list[EngineSpecialRule],
    exceptions: list[EngineException],
    school_periods: list[Period],
    start: date,
    end: date,
    country: str = "FR",
) -> list[DayAssignment]:
    """Attribue chaque jour de [start, end] (bornes incluses) à un parent.

    Priorité : exception > fête > vacances scolaires > rythme de base.
    `country` fixe les dates dépendant du pays (Mother's Day, Thanksgiving…).
    """
    other_parent_of = {
        rule.reference_parent: rule.other_parent,
        rule.other_parent: rule.reference_parent,
    }

    special_dates: dict[date, str] = {}
    for sp in special_rules:
        if not sp.enabled:
            continue
        for year in range(start.year - 1, end.year + 2):
            special_dates[special_day_date(sp.kind, year, country)] = sp.parent_for_year(year)

    result: list[DayAssignment] = []
    day = start
    while day <= end:
        assignment = None
        for exc in exceptions:
            if exc.start <= day <= exc.end:
                assignment = DayAssignment(day, exc.parent, "exception")
                break
        if assignment is None and day in special_dates:
            assignment = DayAssignment(day, special_dates[day], "special")
        if assignment is None and vacation_rule is not None:
            for period in school_periods:
                if period.start <= day <= period.end:
                    parent = _vacation_parent(vacation_rule, period, day, other_parent_of)
                    assignment = DayAssignment(day, parent, "vacation")
                    break
        if assignment is None:
            assignment = DayAssignment(day, base_pattern_parent(rule, day), "rule")
        result.append(assignment)
        day += timedelta(days=1)
    return result
