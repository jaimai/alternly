"""Tests du rythme de base du moteur de garde.

Repères : 2026-01-05 est un lundi. Parents notés "A" (référent) et "B".
"""
from datetime import date, timedelta

from app.services.custody_engine import EngineRule, base_pattern_parent

MON = date(2026, 1, 5)  # lundi


def rule(pattern, **kw):
    return EngineRule(
        pattern=pattern,
        start_date=kw.pop("start_date", MON),
        reference_parent="A",
        other_parent="B",
        **kw,
    )


def seq(r, start, n):
    return [base_pattern_parent(r, start + timedelta(days=i)) for i in range(n)]


class TestAlternateWeeks:
    def test_first_week_is_reference_parent(self):
        r = rule("alternate_weeks")
        assert seq(r, MON, 7) == ["A"] * 7

    def test_second_week_is_other_parent(self):
        r = rule("alternate_weeks")
        assert seq(r, MON + timedelta(days=7), 7) == ["B"] * 7

    def test_alternation_continues_years_later(self):
        r = rule("alternate_weeks")
        # 2027-01-04 est un lundi, 52 semaines après MON → semaine paire → "A"
        assert base_pattern_parent(r, date(2027, 1, 4)) == "A"
        assert base_pattern_parent(r, date(2027, 1, 11)) == "B"

    def test_handover_on_friday(self):
        # bascule le vendredi (4) : le jeudi 8 est encore semaine 0 ("A"),
        # le vendredi 9 commence la semaine 1 ("B")
        r = rule("alternate_weeks", handover_day=4)
        assert base_pattern_parent(r, date(2026, 1, 8)) == "A"
        assert base_pattern_parent(r, date(2026, 1, 9)) == "B"
        assert base_pattern_parent(r, date(2026, 1, 15)) == "B"
        assert base_pattern_parent(r, date(2026, 1, 16)) == "A"

    def test_days_before_start_still_deterministic(self):
        r = rule("alternate_weeks")
        # semaine juste avant le départ = parité -1 → "B"
        assert base_pattern_parent(r, MON - timedelta(days=1)) == "B"


class TestTwoTwoThree:
    def test_full_14_day_cycle(self):
        r = rule("two_two_three")
        expected = [
            "A", "A", "B", "B", "A", "A", "A",  # sem 1 : 2A 2B 3A
            "B", "B", "A", "A", "B", "B", "B",  # sem 2 : 2B 2A 3B
        ]
        assert seq(r, MON, 14) == expected

    def test_cycle_repeats(self):
        r = rule("two_two_three")
        assert seq(r, MON, 28) == seq(r, MON, 14) * 2

    def test_anchored_to_monday_of_start_week(self):
        # start un mercredi : l'ancre reste le lundi de cette semaine
        r = rule("two_two_three", start_date=date(2026, 1, 7))
        assert base_pattern_parent(r, MON) == "A"
        assert base_pattern_parent(r, MON + timedelta(days=2)) == "B"


class TestEveryOtherWeekend:
    def test_weekdays_belong_to_other_parent(self):
        r = rule("every_other_weekend")
        # lun-jeu toujours "B"
        for i in range(0, 4):
            assert base_pattern_parent(r, MON + timedelta(days=i)) == "B"
            assert base_pattern_parent(r, MON + timedelta(days=7 + i)) == "B"

    def test_reference_weekend_week0(self):
        r = rule("every_other_weekend")
        # ven 9, sam 10, dim 11 janvier → week-end du référent
        assert base_pattern_parent(r, date(2026, 1, 9)) == "A"
        assert base_pattern_parent(r, date(2026, 1, 10)) == "A"
        assert base_pattern_parent(r, date(2026, 1, 11)) == "A"

    def test_other_weekend_week1(self):
        r = rule("every_other_weekend")
        assert base_pattern_parent(r, date(2026, 1, 16)) == "B"
        assert base_pattern_parent(r, date(2026, 1, 17)) == "B"
        assert base_pattern_parent(r, date(2026, 1, 18)) == "B"


class TestCustom:
    def test_custom_cycle(self):
        pattern = (["ref"] * 3 + ["other"] * 4) + (["other"] * 3 + ["ref"] * 4)
        r = rule("custom", custom_weeks=pattern)
        expected = ["A", "A", "A", "B", "B", "B", "B", "B", "B", "B", "A", "A", "A", "A"]
        assert seq(r, MON, 14) == expected
