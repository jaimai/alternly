from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership
from ..models import Child, HouseholdMember
from ..schemas import ChangeRequestOut, ChildIn, ChildOut
from ..services import audit
from ..services import change_requests as cr_service

router = APIRouter(prefix="/api/households/{household_id}/children", tags=["children"])


@router.get("", response_model=list[ChildOut])
def list_children(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    return db.scalars(select(Child).where(Child.household_id == member.household_id)).all()


@router.post("", response_model=ChildOut, status_code=201)
def add_child(data: ChildIn, member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    child = Child(household_id=member.household_id, first_name=data.first_name, birthdate=data.birthdate)
    db.add(child)
    db.flush()
    audit.record(
        db, member.household_id, member.user_id, "child.create", "child", child.id,
        f"a ajouté l'enfant {child.first_name}", {"after": {"first_name": child.first_name, "birthdate": child.birthdate}},
    )
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
    before = {"first_name": child.first_name, "birthdate": child.birthdate}
    after = {"first_name": data.first_name, "birthdate": data.birthdate}
    if before != after:
        label = child.first_name if child.first_name == data.first_name else f"{child.first_name} → {data.first_name}"
        audit.record(
            db, member.household_id, member.user_id, "child.update", "child", child.id,
            f"a modifié l'enfant {label}", {"before": before, "after": after},
        )
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
    if cr_service.needs_consent(db, member):
        cr = cr_service.create_request(
            db, member, "delete_child", {"child_id": child.id}, f"Retirer l'enfant {child.first_name}"
        )
        db.commit()
        return JSONResponse(
            status_code=202, content=jsonable_encoder({"change_request": ChangeRequestOut.model_validate(cr)})
        )
    cr_service.delete_child(db, child, member.user_id)
    db.commit()
