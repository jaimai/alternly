"""Journal de garde : notes factuelles et datées, privées à leur auteur.

Fonctionnalité premium utile même sans l'autre parent (parcours « solo »). Rien
n'est visible par l'autre parent : pas de notification, pas d'entrée dans
l'historique du foyer. L'export sert à imprimer ou enregistrer le journal en PDF
(avocat, médiateur, juge aux affaires familiales).
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, household_members, require_premium
from ..models import Child, Household, HouseholdMember, JournalEntry, User, utcnow
from ..ratelimit import DAY, rate_limit
from ..schemas import JOURNAL_KINDS, JournalEntryIn, JournalEntryOut, JournalEntryPatch, JournalExportOut
from ..services import analytics
from ..services.calendar_service import NoCustodyRule, build_calendar

router = APIRouter(
    prefix="/api/households/{household_id}", tags=["journal"], dependencies=[Depends(require_premium)]
)

# Au-delà, l'export ne rappelle pas le calendrier prévu (calcul trop long).
MAX_SCHEDULE_SPAN_DAYS = 800


def _check_kind(kind: str) -> None:
    if kind not in JOURNAL_KINDS:
        raise HTTPException(status_code=422, detail="Type d'entrée inconnu")


def _check_child(db: Session, member: HouseholdMember, child_id: int | None) -> None:
    if child_id is None:
        return
    child = db.get(Child, child_id)
    if child is None or child.household_id != member.household_id:
        raise HTTPException(status_code=422, detail="Enfant introuvable dans ce foyer")


def _get_entry(db: Session, member: HouseholdMember, entry_id: int) -> JournalEntry:
    # Une entrée d'un autre parent répond comme une entrée inexistante : le journal est privé.
    e = db.get(JournalEntry, entry_id)
    if e is None or e.household_id != member.household_id or e.author_id != member.user_id:
        raise HTTPException(status_code=404, detail="Entrée introuvable")
    return e


def _own_entries(
    db: Session, member: HouseholdMember, start: date | None, end: date | None, kind: str | None
) -> list[JournalEntry]:
    stmt = select(JournalEntry).where(
        JournalEntry.household_id == member.household_id,
        JournalEntry.author_id == member.user_id,
    )
    if start is not None:
        stmt = stmt.where(JournalEntry.day >= start)
    if end is not None:
        stmt = stmt.where(JournalEntry.day <= end)
    if kind:
        stmt = stmt.where(JournalEntry.kind == kind)
    order = (JournalEntry.day.desc(), JournalEntry.time.desc(), JournalEntry.created_at.desc())
    return list(db.scalars(stmt.order_by(*order)).all())


@router.get("/journal", response_model=list[JournalEntryOut])
def list_journal(
    start: date | None = Query(None),
    end: date | None = Query(None),
    kind: str | None = Query(None),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    return _own_entries(db, member, start, end, kind)


@router.post(
    "/journal",
    response_model=JournalEntryOut,
    status_code=201,
    dependencies=[Depends(rate_limit("journal", 200, DAY))],
)
def create_entry(
    data: JournalEntryIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    _check_kind(data.kind)
    _check_child(db, member, data.child_id)
    entry = JournalEntry(
        household_id=member.household_id,
        author_id=member.user_id,
        day=data.day,
        time=data.time,
        kind=data.kind,
        child_id=data.child_id,
        body=data.body,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    analytics.capture_for_user(
        db.get(User, member.user_id), "journal_entry_created", {"kind": entry.kind},
        household_id=member.household_id,
    )
    return entry


@router.patch("/journal/{entry_id}", response_model=JournalEntryOut)
def update_entry(
    entry_id: int,
    data: JournalEntryPatch,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, member, entry_id)
    if data.day is not None:
        entry.day = data.day
    if "time" in data.model_fields_set:
        entry.time = data.time
    if data.kind is not None:
        _check_kind(data.kind)
        entry.kind = data.kind
    if "child_id" in data.model_fields_set:
        _check_child(db, member, data.child_id)
        entry.child_id = data.child_id
    if data.body is not None:
        entry.body = data.body
    entry.edited_at = utcnow()
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/journal/{entry_id}", status_code=204)
def delete_entry(
    entry_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    db.delete(_get_entry(db, member, entry_id))
    db.commit()


def _scheduled_parents(db: Session, household: Household, days: list[date]) -> dict[date, str]:
    """Prénom du parent qui avait les enfants, selon le calendrier, pour chaque jour."""
    if not days or (max(days) - min(days)).days > MAX_SCHEDULE_SPAN_DAYS:
        return {}
    try:
        cal = build_calendar(db, household, min(days), max(days))
    except NoCustodyRule:
        return {}
    names = {}
    for m in household_members(db, household.id):
        u = db.get(User, m.user_id)
        names[str(m.user_id)] = u.display_name if u else ""
    wanted = set(days)
    return {a.day: names.get(a.parent, "") for a in cal.days if a.day in wanted and names.get(a.parent)}


@router.get("/journal/export", response_model=JournalExportOut)
def export_journal(
    start: date | None = Query(None),
    end: date | None = Query(None),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if start and end and end < start:
        raise HTTPException(status_code=422, detail="end doit suivre start")
    household = db.get(Household, member.household_id)
    author = db.get(User, member.user_id)
    entries = _own_entries(db, member, start, end, None)
    children = db.scalars(select(Child).where(Child.household_id == household.id)).all()
    analytics.capture_for_user(
        author, "journal_exported", {"entries": len(entries)}, household_id=household.id,
    )
    return JournalExportOut(
        author_name=author.display_name,
        household_name=household.name,
        children={c.id: c.first_name for c in children},
        start=start,
        end=end,
        generated_at=utcnow(),
        entries=[JournalEntryOut.model_validate(e) for e in entries],
        scheduled=_scheduled_parents(db, household, sorted({e.day for e in entries})),
    )
