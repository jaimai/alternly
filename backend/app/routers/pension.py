"""Pension alimentaire : montant, échéancier, paiements reçus, revalorisation.

Fonctionnalité premium du parcours « solo » : un parent peut tout suivre seul
(l'autre parent peut n'être qu'un placeholder). Données du foyer : visibles par
les deux parents, modifications inscrites dans l'historique.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, household_members, require_premium
from ..models import HouseholdMember, Pension, PensionPayment, PensionRate, User
from ..ratelimit import DAY, rate_limit
from ..schemas import (
    PensionIn,
    PensionMonthOut,
    PensionOut,
    PensionPaymentIn,
    PensionPaymentOut,
    PensionRateOut,
    RevaluationIn,
    RevaluationOut,
)
from ..services import analytics, audit
from ..services.pension import first_of_month, month_statuses, payments_of, rate_for, rates_of, revalued_cents

router = APIRouter(
    prefix="/api/households/{household_id}", tags=["pension"], dependencies=[Depends(require_premium)]
)


def _pension(db: Session, member: HouseholdMember) -> Pension | None:
    return db.scalar(select(Pension).where(Pension.household_id == member.household_id))


def _require_pension(db: Session, member: HouseholdMember) -> Pension:
    pension = _pension(db, member)
    if pension is None:
        raise HTTPException(status_code=404, detail="Aucune pension enregistrée")
    return pension


def _out(db: Session, pension: Pension) -> PensionOut:
    rates = rates_of(db, pension)
    payments = payments_of(db, pension)
    months, arrears = month_statuses(pension, rates, payments, date.today())
    return PensionOut(
        payer_id=pension.payer_id,
        payee_id=pension.payee_id,
        due_day=pension.due_day,
        start_month=pension.start_month,
        amount_cents=rate_for(rates, first_of_month(date.today())) or rate_for(rates, date.max),
        base_amount_cents=pension.base_amount_cents,
        base_index=pension.base_index,
        index_label=pension.index_label,
        revaluation_month=pension.revaluation_month,
        rates=[PensionRateOut.model_validate(r) for r in sorted(rates, key=lambda r: r.effective_from, reverse=True)],
        payments=[PensionPaymentOut.model_validate(p) for p in payments],
        months=[PensionMonthOut(**m) for m in months],
        arrears_cents=arrears,
    )


@router.get("/pension", response_model=PensionOut | None)
def get_pension(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    pension = _pension(db, member)
    return _out(db, pension) if pension else None


@router.put("/pension", response_model=PensionOut)
def upsert_pension(
    data: PensionIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    member_ids = [m.user_id for m in household_members(db, member.household_id)]
    if data.payer_id not in member_ids or len(member_ids) < 2:
        raise HTTPException(status_code=422, detail="Ce parent n'appartient pas au foyer")
    payee_id = next(uid for uid in member_ids if uid != data.payer_id)
    start = first_of_month(data.start_month)
    pension = _pension(db, member)
    created = pension is None
    if pension is None:
        pension = Pension(household_id=member.household_id, payer_id=data.payer_id, payee_id=payee_id, start_month=start)
        db.add(pension)
        db.flush()
    pension.payer_id = data.payer_id
    pension.payee_id = payee_id
    pension.due_day = data.due_day
    pension.start_month = start
    pension.base_amount_cents = data.base_amount_cents
    pension.base_index = data.base_index
    pension.index_label = data.index_label
    pension.revaluation_month = data.revaluation_month

    rates = rates_of(db, pension)
    if not rates:
        db.add(PensionRate(pension_id=pension.id, effective_from=start, amount_cents=data.amount_cents))
    else:
        # Montant corrigé à la main : il s'applique depuis le mois en cours (ou le début).
        effective = max(start, first_of_month(date.today()))
        if rate_for(rates, effective) != data.amount_cents:
            same = next((r for r in rates if r.effective_from == effective), None)
            if same:
                same.amount_cents = data.amount_cents
                same.index_value = None
            else:
                db.add(PensionRate(pension_id=pension.id, effective_from=effective, amount_cents=data.amount_cents))
    audit.record(
        db, member.household_id, member.user_id, "pension.create" if created else "pension.update", "pension",
        pension.id, {"amount_cents": data.amount_cents},
    )
    db.commit()
    if created:
        analytics.capture_for_user(
            db.get(User, member.user_id), "pension_set_up", {"revaluation": data.base_index is not None},
            household_id=member.household_id,
        )
    return _out(db, pension)


@router.delete("/pension", status_code=204)
def delete_pension(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    pension = _require_pension(db, member)
    db.execute(delete(PensionPayment).where(PensionPayment.pension_id == pension.id))
    db.execute(delete(PensionRate).where(PensionRate.pension_id == pension.id))
    audit.record(db, member.household_id, member.user_id, "pension.delete", "pension", pension.id, {})
    db.delete(pension)
    db.commit()


@router.post(
    "/pension/payments",
    response_model=PensionOut,
    status_code=201,
    dependencies=[Depends(rate_limit("pension", 100, DAY, by="household"))],
)
def add_payment(
    data: PensionPaymentIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    pension = _require_pension(db, member)
    payment = PensionPayment(
        pension_id=pension.id,
        month=first_of_month(data.month),
        amount_cents=data.amount_cents,
        paid_on=data.paid_on,
        note=data.note,
        created_by=member.user_id,
    )
    db.add(payment)
    db.flush()
    audit.record(
        db, member.household_id, member.user_id, "pension_payment.create", "pension_payment", payment.id,
        {"month": payment.month.isoformat(), "amount_cents": payment.amount_cents},
    )
    db.commit()
    return _out(db, pension)


@router.delete("/pension/payments/{payment_id}", response_model=PensionOut)
def delete_payment(
    payment_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    pension = _require_pension(db, member)
    payment = db.get(PensionPayment, payment_id)
    if payment is None or payment.pension_id != pension.id:
        raise HTTPException(status_code=404, detail="Paiement introuvable")
    audit.record(
        db, member.household_id, member.user_id, "pension_payment.delete", "pension_payment", payment.id,
        {"month": payment.month.isoformat(), "amount_cents": payment.amount_cents},
    )
    db.delete(payment)
    db.commit()
    return _out(db, pension)


@router.post("/pension/revaluation", response_model=RevaluationOut)
def revalue(
    data: RevaluationIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    """Calcule (et applique si `apply`) le montant revalorisé selon le nouvel indice."""
    pension = _require_pension(db, member)
    if not pension.base_amount_cents or not pension.base_index:
        raise HTTPException(status_code=409, detail="Renseignez d'abord le montant et l'indice de base du jugement")
    rates = rates_of(db, pension)
    effective = first_of_month(data.effective_from or date.today())
    current = rate_for(rates, effective)
    new = revalued_cents(pension.base_amount_cents, pension.base_index, data.new_index)
    if data.apply:
        same = next((r for r in rates if r.effective_from == effective), None)
        if same:
            same.amount_cents = new
            same.index_value = data.new_index
        else:
            db.add(PensionRate(pension_id=pension.id, effective_from=effective, amount_cents=new, index_value=data.new_index))
        audit.record(
            db, member.household_id, member.user_id, "pension.revalue", "pension", pension.id,
            {"before": current, "after": new, "index": data.new_index},
        )
        db.commit()
        analytics.capture_for_user(
            db.get(User, member.user_id), "pension_revalued", {}, household_id=member.household_id,
        )
    return RevaluationOut(
        current_cents=current,
        new_cents=new,
        base_amount_cents=pension.base_amount_cents,
        base_index=pension.base_index,
        new_index=data.new_index,
        applied=data.apply,
    )
