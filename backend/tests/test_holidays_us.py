"""Jours fériés fédéraux américains (calcul hors-ligne, pas d'API)."""
from datetime import date

from app.services.holidays_us import federal_holidays


def test_2026_federal_holidays():
    h = federal_holidays(2026)
    assert h[date(2026, 1, 1)] == "New Year's Day"
    assert h[date(2026, 1, 19)] == "Martin Luther King Jr. Day"   # 3e lundi janvier
    assert h[date(2026, 2, 16)] == "Presidents' Day"              # 3e lundi février
    assert h[date(2026, 5, 25)] == "Memorial Day"                 # dernier lundi mai
    assert h[date(2026, 6, 19)] == "Juneteenth"
    assert h[date(2026, 7, 4)] == "Independence Day"
    assert h[date(2026, 9, 7)] == "Labor Day"                     # 1er lundi septembre
    assert h[date(2026, 10, 12)] == "Columbus Day"                # 2e lundi octobre
    assert h[date(2026, 11, 11)] == "Veterans Day"
    assert h[date(2026, 11, 26)] == "Thanksgiving"                # 4e jeudi novembre
    assert h[date(2026, 12, 25)] == "Christmas Day"


def test_count_is_eleven():
    assert len(federal_holidays(2027)) == 11
