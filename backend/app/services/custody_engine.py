"""Moteur de garde : fonctions pures, aucune I/O.

Les parents sont des identifiants opaques (str). La granularité est le jour.
Priorité de résolution : exception > fête > vacances scolaires > rythme de base.
"""
from dataclasses import dataclass, field
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
