"""Génération d'un flux iCalendar (RFC 5545) : blocs de garde fusionnés par parent."""
from datetime import date, timedelta

from .custody_engine import DayAssignment


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def merge_blocks(days: list[DayAssignment]) -> list[tuple[date, date, str]]:
    """Fusionne les jours consécutifs du même parent en blocs (start, end inclus, parent)."""
    blocks: list[tuple[date, date, str]] = []
    for a in sorted(days, key=lambda d: d.day):
        if blocks and blocks[-1][2] == a.parent and blocks[-1][1] + timedelta(days=1) == a.day:
            blocks[-1] = (blocks[-1][0], a.day, a.parent)
        else:
            blocks.append((a.day, a.day, a.parent))
    return blocks


def build_ics(days: list[DayAssignment], parent_names: dict[str, str], token: str) -> str:
    """Flux ICS avec un VEVENT « journée entière » par bloc de garde."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Coparent//Calendrier de garde//FR",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:Garde des enfants",
    ]
    for start, end, parent in merge_blocks(days):
        name = parent_names.get(parent, "Parent")
        dtend = end + timedelta(days=1)  # DTEND exclusif
        lines += [
            "BEGIN:VEVENT",
            f"UID:{token}-{start.isoformat()}@coparent",
            f"DTSTAMP:{start.strftime('%Y%m%d')}T000000Z",
            f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{dtend.strftime('%Y%m%d')}",
            f"SUMMARY:🏠 Chez {_escape(name)}",
            "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
