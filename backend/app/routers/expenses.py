"""Dépenses partagées : dépenses, contestation, remboursements, solde."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, household_members, notify, other_parent_id, require_premium
from ..models import Child, Expense, HouseholdMember, Settlement
from ..schemas import (
    EXPENSE_CATEGORIES,
    BalanceNet,
    BalanceOut,
    DisputeIn,
    ExpenseIn,
    ExpenseOut,
    ExpensePatch,
    SettlementIn,
    SettlementOut,
)
from ..services.expenses_service import compute_balance

# Fonctionnalité premium : tout le routeur exige un abonnement.
router = APIRouter(
    prefix="/api/households/{household_id}", tags=["expenses"], dependencies=[Depends(require_premium)]
)


def _member_ids(db: Session, household_id: int) -> list[int]:
    return [m.user_id for m in household_members(db, household_id)]


def _check_member(db: Session, member: HouseholdMember, user_id: int) -> None:
    if user_id not in _member_ids(db, member.household_id):
        raise HTTPException(status_code=422, detail="Ce parent n'appartient pas au foyer")


def _check_child(db: Session, member: HouseholdMember, child_id: int | None) -> None:
    if child_id is None:
        return
    child = db.get(Child, child_id)
    if child is None or child.household_id != member.household_id:
        raise HTTPException(status_code=422, detail="Enfant introuvable dans ce foyer")


def _get_expense(db: Session, member: HouseholdMember, expense_id: int) -> Expense:
    exp = db.get(Expense, expense_id)
    if exp is None or exp.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Dépense introuvable")
    return exp


def _exp_payload(exp: Expense) -> dict:
    return {"id": exp.id, "label": exp.label, "amount_cents": exp.amount_cents, "date": exp.date.isoformat()}


# ---------- dépenses ----------

@router.get("/expenses", response_model=list[ExpenseOut])
def list_expenses(
    category: str | None = Query(None),
    child_id: int | None = Query(None),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    stmt = select(Expense).where(Expense.household_id == member.household_id)
    if category:
        stmt = stmt.where(Expense.category == category)
    if child_id is not None:
        stmt = stmt.where(Expense.child_id == child_id)
    return db.scalars(stmt.order_by(Expense.date.desc(), Expense.id.desc())).all()


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
def create_expense(
    data: ExpenseIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=422, detail="Catégorie inconnue")
    paid_by = data.paid_by if data.paid_by is not None else member.user_id
    _check_member(db, member, paid_by)
    _check_child(db, member, data.child_id)
    exp = Expense(
        household_id=member.household_id,
        label=data.label,
        amount_cents=data.amount_cents,
        date=data.date,
        category=data.category,
        child_id=data.child_id,
        paid_by=paid_by,
        payer_percent=data.payer_percent,
        created_by=member.user_id,
    )
    db.add(exp)
    db.flush()
    notify(db, other_parent_id(db, member.household_id, member.user_id), "expense_added", _exp_payload(exp))
    db.commit()
    db.refresh(exp)
    return exp


@router.patch("/expenses/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: int,
    data: ExpensePatch,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exp = _get_expense(db, member, expense_id)
    if exp.created_by != member.user_id:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut modifier cette dépense")
    if data.category is not None and data.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=422, detail="Catégorie inconnue")
    if data.paid_by is not None:
        _check_member(db, member, data.paid_by)
        exp.paid_by = data.paid_by
    if "child_id" in data.model_fields_set:
        _check_child(db, member, data.child_id)
        exp.child_id = data.child_id
    for field in ("label", "amount_cents", "date", "category", "payer_percent"):
        val = getattr(data, field)
        if val is not None:
            setattr(exp, field, val)
    # une modification lève une éventuelle contestation
    exp.status = "active"
    exp.dispute_note = ""
    db.commit()
    db.refresh(exp)
    return exp


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(
    expense_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exp = _get_expense(db, member, expense_id)
    if exp.created_by != member.user_id:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut supprimer cette dépense")
    db.delete(exp)
    db.commit()


@router.post("/expenses/{expense_id}/dispute", response_model=ExpenseOut)
def dispute_expense(
    expense_id: int,
    data: DisputeIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exp = _get_expense(db, member, expense_id)
    if member.user_id == exp.paid_by:
        raise HTTPException(status_code=403, detail="Le payeur ne peut pas contester sa propre dépense")
    exp.status = "disputed"
    exp.dispute_note = data.dispute_note
    notify(db, exp.paid_by, "expense_disputed", _exp_payload(exp))
    db.commit()
    db.refresh(exp)
    return exp


@router.post("/expenses/{expense_id}/resolve", response_model=ExpenseOut)
def resolve_expense(
    expense_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    exp = _get_expense(db, member, expense_id)
    exp.status = "active"
    exp.dispute_note = ""
    notify(db, other_parent_id(db, member.household_id, member.user_id), "expense_resolved", _exp_payload(exp))
    db.commit()
    db.refresh(exp)
    return exp


# ---------- remboursements ----------

@router.get("/settlements", response_model=list[SettlementOut])
def list_settlements(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    return db.scalars(
        select(Settlement)
        .where(Settlement.household_id == member.household_id)
        .order_by(Settlement.date.desc(), Settlement.id.desc())
    ).all()


@router.post("/settlements", response_model=SettlementOut, status_code=201)
def create_settlement(
    data: SettlementIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    _check_member(db, member, data.from_user)
    _check_member(db, member, data.to_user)
    if data.from_user == data.to_user:
        raise HTTPException(status_code=422, detail="Un remboursement doit concerner deux parents distincts")
    s = Settlement(
        household_id=member.household_id,
        from_user=data.from_user,
        to_user=data.to_user,
        amount_cents=data.amount_cents,
        date=data.date,
        note=data.note,
        created_by=member.user_id,
    )
    db.add(s)
    notify(
        db,
        other_parent_id(db, member.household_id, member.user_id),
        "settlement_recorded",
        {"amount_cents": data.amount_cents, "date": data.date.isoformat()},
    )
    db.commit()
    db.refresh(s)
    return s


@router.delete("/settlements/{settlement_id}", status_code=204)
def delete_settlement(
    settlement_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    s = db.get(Settlement, settlement_id)
    if s is None or s.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Remboursement introuvable")
    if s.created_by != member.user_id:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut supprimer ce remboursement")
    db.delete(s)
    db.commit()


# ---------- solde ----------

@router.get("/balance", response_model=BalanceOut)
def get_balance(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    member_ids = _member_ids(db, member.household_id)
    expenses = db.scalars(select(Expense).where(Expense.household_id == member.household_id)).all()
    settlements = db.scalars(select(Settlement).where(Settlement.household_id == member.household_id)).all()
    bal = compute_balance(expenses, settlements, member_ids)
    return BalanceOut(
        net=[BalanceNet(user_id=uid, amount_cents=v) for uid, v in bal.net.items()],
        debtor_id=bal.debtor_id,
        creditor_id=bal.creditor_id,
        amount_cents=bal.amount_cents,
    )
