"""Tests des surcharges : vacances scolaires, fêtes, exceptions.

Parents "A" (référent, 1re moitié les années paires) et "B".
La règle de base est semaine/semaine démarrant le lundi 2026-01-05 chez "A".
"""
from datetime import date, timedelta

from app.services.custody_engine import (
    EngineException,
    EngineRule,
    EngineSpecialRule,
    EngineVacationRule,
    Period,
    fathers_day,
    mothers_day,
    mothers_day_us,
    resolve_calendar,
    special_day_date,
    thanksgiving,
)

MON = date(2026, 1, 5)

RULE = EngineRule(
    pattern="alternate_weeks",
    start_date=MON,
    reference_parent="A",
    other_parent="B",
)
VAC = EngineVacationRule(mode="split_half", even_year_first_half_parent="A")


def resolve(start, end, *, vacation_rule=VAC, specials=(), exceptions=(), periods=()):
    days = resolve_calendar(
        rule=RULE,
        vacation_rule=vacation_rule,
        special_rules=list(specials),
        exceptions=list(exceptions),
        school_periods=list(periods),
        start=start,
        end=end,
    )
    return {a.day: a for a in days}


class TestVacationSplitHalf:
    def test_even_year_14_days_split_7_7(self):
        # Vacances de 14 jours en 2026 (paire) : 1re moitié "A", 2e moitié "B"
        p = Period("Hiver", date(2026, 2, 7), date(2026, 2, 20))
        res = resolve(p.start, p.end, periods=[p])
        for i in range(7):
            assert res[p.start + timedelta(days=i)].parent == "A"
            assert res[p.start + timedelta(days=i)].source == "vacation"
        for i in range(7, 14):
            assert res[p.start + timedelta(days=i)].parent == "B"

    def test_odd_length_first_half_gets_extra_day(self):
        # 15 jours → 8 / 7
        p = Period("Printemps", date(2026, 4, 4), date(2026, 4, 18))
        res = resolve(p.start, p.end, periods=[p])
        assert res[p.start + timedelta(days=7)].parent == "A"
        assert res[p.start + timedelta(days=8)].parent == "B"

    def test_odd_year_halves_are_swapped(self):
        p = Period("Hiver", date(2027, 2, 6), date(2027, 2, 19))
        res = resolve(p.start, p.end, periods=[p])
        assert res[p.start].parent == "B"
        assert res[p.end].parent == "A"

    def test_christmas_straddling_years_uses_start_year_parity(self):
        # Vacances commençant en décembre 2026 (paire) : parité 2026 pour toute la période
        p = Period("Noël", date(2026, 12, 19), date(2027, 1, 3))
        res = resolve(p.start, p.end, periods=[p])
        assert res[p.start].parent == "A"
        assert res[date(2027, 1, 3)].parent == "B"

    def test_outside_vacation_base_rule_applies(self):
        p = Period("Hiver", date(2026, 2, 7), date(2026, 2, 20))
        res = resolve(date(2026, 1, 5), date(2026, 1, 11), periods=[p])
        assert res[date(2026, 1, 5)].source == "rule"


class TestVacationAlternateFull:
    def test_even_year_entire_period_to_even_parent(self):
        vac = EngineVacationRule(mode="alternate_full", even_year_first_half_parent="A")
        p = Period("Hiver", date(2026, 2, 7), date(2026, 2, 20))
        res = resolve(p.start, p.end, vacation_rule=vac, periods=[p])
        assert all(res[p.start + timedelta(days=i)].parent == "A" for i in range(14))

    def test_odd_year_entire_period_to_other(self):
        vac = EngineVacationRule(mode="alternate_full", even_year_first_half_parent="A")
        p = Period("Hiver", date(2027, 2, 6), date(2027, 2, 19))
        res = resolve(p.start, p.end, vacation_rule=vac, periods=[p])
        assert all(a.parent == "B" for a in res.values())


class TestPriorities:
    def test_exception_wins_over_vacation(self):
        p = Period("Hiver", date(2026, 2, 7), date(2026, 2, 20))
        exc = EngineException(start=date(2026, 2, 9), end=date(2026, 2, 10), parent="B")
        res = resolve(p.start, p.end, periods=[p], exceptions=[exc])
        assert res[date(2026, 2, 9)].parent == "B"
        assert res[date(2026, 2, 9)].source == "exception"
        assert res[date(2026, 2, 11)].parent == "A"  # retour à la moitié de vacances

    def test_special_day_wins_over_vacation(self):
        p = Period("Noël", date(2026, 12, 19), date(2027, 1, 3))
        sp = EngineSpecialRule(kind="christmas_day", parent="B")
        res = resolve(p.start, p.end, periods=[p], specials=[sp])
        assert res[date(2026, 12, 25)].parent == "B"
        assert res[date(2026, 12, 25)].source == "special"
        assert res[date(2026, 12, 24)].parent == "A"  # veille non couverte par cette règle

    def test_exception_wins_over_special(self):
        sp = EngineSpecialRule(kind="christmas_day", parent="B")
        exc = EngineException(start=date(2026, 12, 25), end=date(2026, 12, 25), parent="A")
        res = resolve(date(2026, 12, 24), date(2026, 12, 26), specials=[sp], exceptions=[exc])
        assert res[date(2026, 12, 25)].parent == "A"
        assert res[date(2026, 12, 25)].source == "exception"

    def test_disabled_special_is_ignored(self):
        sp = EngineSpecialRule(kind="christmas_day", parent="B", enabled=False)
        res = resolve(date(2026, 12, 25), date(2026, 12, 25), specials=[sp])
        assert res[date(2026, 12, 25)].source == "rule"

    def test_mothers_and_fathers_day_rules(self):
        sp_m = EngineSpecialRule(kind="mothers_day", parent="B")
        sp_f = EngineSpecialRule(kind="fathers_day", parent="A")
        res = resolve(date(2026, 5, 1), date(2026, 6, 30), specials=[sp_m, sp_f])
        assert res[date(2026, 5, 31)].parent == "B"   # fête des mères 2026
        assert res[date(2026, 5, 31)].source == "special"
        assert res[date(2026, 6, 21)].parent == "A"   # fête des pères 2026


class TestUsHolidayDates:
    def test_mothers_day_us_is_second_sunday_of_may(self):
        assert mothers_day_us(2024) == date(2024, 5, 12)
        assert mothers_day_us(2025) == date(2025, 5, 11)
        assert mothers_day_us(2026) == date(2026, 5, 10)

    def test_fathers_day_same_in_us(self):
        # 3e dimanche de juin : identique FR/US
        assert fathers_day(2026) == date(2026, 6, 21)

    def test_thanksgiving_is_fourth_thursday_of_november(self):
        assert thanksgiving(2024) == date(2024, 11, 28)
        assert thanksgiving(2025) == date(2025, 11, 27)
        assert thanksgiving(2026) == date(2026, 11, 26)

    def test_special_day_date_country_aware(self):
        # Mother's Day dépend du pays ; Thanksgiving n'existe qu'aux US.
        assert special_day_date("mothers_day", 2026, "FR") == date(2026, 5, 31)
        assert special_day_date("mothers_day", 2026, "US") == date(2026, 5, 10)
        assert special_day_date("thanksgiving", 2026, "US") == date(2026, 11, 26)
        assert special_day_date("christmas_day", 2026, "US") == date(2026, 12, 25)


class TestFeteDates:
    def test_mothers_day_truth_table(self):
        assert mothers_day(2024) == date(2024, 5, 26)
        assert mothers_day(2025) == date(2025, 5, 25)
        assert mothers_day(2026) == date(2026, 5, 31)

    def test_mothers_day_pentecost_shift(self):
        # 2038 : Pâques 25/04 → Pentecôte 13/06 ; dernier dimanche de mai = 30/05,
        # pas de conflit. Cas de conflit réel : 2016 ? Pentecôte 15/05 — non.
        # Conflit vérifié : 2071 (Pâques 19/04 → Pentecôte 07/06) non plus.
        # On teste le mécanisme directement : si dernier dimanche de mai == Pentecôte,
        # la fête passe au 1er dimanche de juin. Cas réel documenté : 2008
        # (Pentecôte 11 mai... non). Utiliser 1997 : Pentecôte 18 mai — non.
        # Cas avéré : 2028 ? Pâques 16/04 → Pentecôte 04/06 → dernier dim. mai 28/05 ok.
        # → cas historique connu : fête des mères 2059 ; plus simple : année où
        # Pâques tombe le 25/04 max → Pentecôte 13/06 jamais en mai.
        # Le conflit n'arrive que si Pentecôte == dernier dimanche de mai :
        # Pâques 06/04/2042 → Pentecôte 25/05/2042, dernier dimanche de mai 2042 = 25/05 → conflit !
        assert mothers_day(2042) == date(2042, 6, 1)

    def test_fathers_day(self):
        assert fathers_day(2026) == date(2026, 6, 21)
        assert fathers_day(2025) == date(2025, 6, 15)


class TestSpecialAlternation:
    """Alternance annuelle : parent des années paires = even_parent, sinon odd_parent."""

    def test_even_year_goes_to_even_parent(self):
        sp = EngineSpecialRule(kind="christmas_day", even_parent="A", odd_parent="B")
        res = resolve(date(2026, 12, 25), date(2026, 12, 25), specials=[sp])
        assert res[date(2026, 12, 25)].parent == "A"  # 2026 pair
        assert res[date(2026, 12, 25)].source == "special"

    def test_odd_year_goes_to_odd_parent(self):
        sp = EngineSpecialRule(kind="christmas_day", even_parent="A", odd_parent="B")
        res = resolve(date(2027, 12, 25), date(2027, 12, 25), specials=[sp])
        assert res[date(2027, 12, 25)].parent == "B"  # 2027 impair

    def test_eve_and_day_together_same_year(self):
        # 24 et 25 configurés avec le même parent des années paires → ensemble
        eve = EngineSpecialRule(kind="christmas_eve", even_parent="A", odd_parent="B")
        day = EngineSpecialRule(kind="christmas_day", even_parent="A", odd_parent="B")
        res = resolve(date(2026, 12, 24), date(2026, 12, 25), specials=[eve, day])
        assert res[date(2026, 12, 24)].parent == "A"
        assert res[date(2026, 12, 25)].parent == "A"

    def test_alternation_flips_between_consecutive_years(self):
        sp = EngineSpecialRule(kind="christmas_day", even_parent="A", odd_parent="B")
        res = resolve(date(2026, 12, 1), date(2027, 12, 31), specials=[sp])
        assert res[date(2026, 12, 25)].parent == "A"
        assert res[date(2027, 12, 25)].parent == "B"

    def test_fixed_parent_still_supported(self):
        # rétro-compat : parent fixe inchangé
        sp = EngineSpecialRule(kind="christmas_day", parent="B")
        res = resolve(date(2026, 12, 25), date(2026, 12, 25), specials=[sp])
        assert res[date(2026, 12, 25)].parent == "B"
