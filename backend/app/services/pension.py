"""Pension alimentaire : échéancier, paiements, revalorisation (calculs purs + rappel annuel).

Montants en centimes entiers. La revalorisation suit la formule usuelle des
jugements : montant de base × nouvel indice / indice de base (indice INSEE des
prix à la consommation choisi dans la décision, souvent « hors tabac »).
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import household_members, is_premium, notify
from ..models import Pension, PensionPayment, PensionRate, User

# Nombre de mois affichés dans l'échéancier (du plus récent au plus ancien).
MAX_MONTHS = 24


def first_of_month(d: date) -> date:
    return d.replace(day=1)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def revalued_cents(base_amount_cents: int, base_index: float, new_index: float) -> int:
    """Nouveau montant arrondi au centime (arrondi commercial)."""
    value = Decimal(base_amount_cents) * Decimal(str(new_index)) / Decimal(str(base_index))
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def rate_for(rates: list[PensionRate], month: date) -> int:
    """Montant en vigueur pour un mois : dernier tarif dont la date d'effet le précède."""
    amount = 0
    for r in sorted(rates, key=lambda r: (r.effective_from, r.id or 0)):
        if r.effective_from <= month:
            amount = r.amount_cents
    return amount


def month_statuses(
    pension: Pension, rates: list[PensionRate], payments: list[PensionPayment], today: date
) -> tuple[list[dict], int]:
    """Échéancier (du plus récent au plus ancien) et arriéré total des mois échus."""
    current = first_of_month(today)
    start = max(first_of_month(pension.start_month), add_months(current, -(MAX_MONTHS - 1)))
    paid_by_month: dict[date, int] = {}
    for p in payments:
        key = first_of_month(p.month)
        paid_by_month[key] = paid_by_month.get(key, 0) + p.amount_cents

    months: list[dict] = []
    arrears = 0
    month = start
    while month <= current:
        due = rate_for(rates, month)
        paid = paid_by_month.get(month, 0)
        if paid >= due:
            status = "paid"
        elif month == current and today.day <= pension.due_day:
            status = "upcoming"  # échéance pas encore passée
        else:
            status = "partial" if paid > 0 else "missing"
            arrears += due - paid
        months.append({"month": month, "due_cents": due, "paid_cents": paid, "status": status})
        month = add_months(month, 1)
    months.reverse()
    return months, arrears


def send_reminders(db: Session, today: date) -> int:
    """Rappel in-app (et push) le mois de revalorisation, une fois par an et par foyer.
    Seuls les parents réels et abonnés le reçoivent. Ne commit pas."""
    pensions = db.scalars(
        select(Pension).where(Pension.revaluation_month == today.month)
    ).all()
    sent = 0
    for pension in pensions:
        if pension.last_reminder_year == today.year:
            continue
        pension.last_reminder_year = today.year
        for m in household_members(db, pension.household_id):
            user = db.get(User, m.user_id)
            if user is None or user.is_placeholder or not is_premium(db, user):
                continue
            notify(db, user.id, "pension_revaluation_due", {"year": today.year})
            sent += 1
    return sent


def rates_of(db: Session, pension: Pension) -> list[PensionRate]:
    return list(db.scalars(select(PensionRate).where(PensionRate.pension_id == pension.id)).all())


def payments_of(db: Session, pension: Pension) -> list[PensionPayment]:
    stmt = select(PensionPayment).where(PensionPayment.pension_id == pension.id)
    return list(db.scalars(stmt.order_by(PensionPayment.month.desc(), PensionPayment.id.desc())).all())
