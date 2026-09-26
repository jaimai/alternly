from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership
from ..models import Child, Expense, HouseholdMember, WallPost
from ..schemas import ChildIn, ChildOut

router = APIRouter(prefix="/api/households/{household_id}/children", tags=["children"])


@router.get("", response_model=list[ChildOut])
def list_children(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    return db.scalars(select(Child).where(Child.household_id == member.household_id)).all()


@router.post("", response_model=ChildOut, status_code=201)
def add_child(data: ChildIn, member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    child = Child(household_id=member.household_id, first_name=data.first_name, birthdate=data.birthdate)
    db.add(child)
    db.commit()
    db.refresh(child)
    return child


def _get_child(db: Session, member: HouseholdMember, child_id: int) -> Child:
    child = db.get(Child, child_id)
    if child is None or child.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Enfant introuvable")
    return child


@router.patch("/{child_id}", response_model=ChildOut)
def update_child(
    child_id: int,
    data: ChildIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    child = _get_child(db, member, child_id)
    child.first_name = data.first_name
    child.birthdate = data.birthdate
    db.commit()
    db.refresh(child)
    return child


@router.delete("/{child_id}", status_code=204)
def delete_child(
    child_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    child = _get_child(db, member, child_id)
    # Les dépenses et messages liés sont conservés, simplement détachés de
    # l'enfant (sinon violation de clé étrangère sous Postgres).
    for model in (Expense, WallPost):
        db.execute(update(model).where(model.child_id == child.id).values(child_id=None))
    db.delete(child)
    db.commit()
