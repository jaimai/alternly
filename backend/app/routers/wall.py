"""Mur de communication : posts typés (message/tâche/question) + réponses."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, household_members, notify, other_parent_id
from ..models import Child, HouseholdMember, WallPost, WallReply, utcnow
from ..schemas import (
    WALL_KINDS,
    WallPostIn,
    WallPostOut,
    WallPostPatch,
    WallReplyIn,
    WallReplyOut,
)

router = APIRouter(prefix="/api/households/{household_id}", tags=["wall"])


def _member_ids(db: Session, household_id: int) -> list[int]:
    return [m.user_id for m in household_members(db, household_id)]


def _check_member(db: Session, member: HouseholdMember, user_id: int | None) -> None:
    if user_id is None:
        return
    if user_id not in _member_ids(db, member.household_id):
        raise HTTPException(status_code=422, detail="Ce parent n'appartient pas au foyer")


def _check_child(db: Session, member: HouseholdMember, child_id: int | None) -> None:
    if child_id is None:
        return
    child = db.get(Child, child_id)
    if child is None or child.household_id != member.household_id:
        raise HTTPException(status_code=422, detail="Enfant introuvable dans ce foyer")


def _get_post(db: Session, member: HouseholdMember, post_id: int) -> WallPost:
    p = db.get(WallPost, post_id)
    if p is None or p.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Post introuvable")
    return p


def _serialize(db: Session, post: WallPost) -> WallPostOut:
    replies = db.scalars(
        select(WallReply).where(WallReply.post_id == post.id).order_by(WallReply.created_at)
    ).all()
    out = WallPostOut.model_validate(post)
    out.replies = [WallReplyOut.model_validate(r) for r in replies]
    return out


@router.get("/wall", response_model=list[WallPostOut])
def list_wall(
    kind: str | None = Query(None),
    child_id: int | None = Query(None),
    open: bool | None = Query(None),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    stmt = select(WallPost).where(WallPost.household_id == member.household_id)
    if kind:
        stmt = stmt.where(WallPost.kind == kind)
    if child_id is not None:
        stmt = stmt.where(WallPost.child_id == child_id)
    if open:
        stmt = stmt.where(WallPost.completed_at.is_(None))
    posts = db.scalars(stmt.order_by(WallPost.created_at.desc())).all()
    return [_serialize(db, p) for p in posts]


@router.post("/wall", response_model=WallPostOut, status_code=201)
def create_post(
    data: WallPostIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.kind not in WALL_KINDS:
        raise HTTPException(status_code=422, detail="Type de post inconnu")
    _check_child(db, member, data.child_id)
    _check_member(db, member, data.assigned_to)
    post = WallPost(
        household_id=member.household_id,
        author_id=member.user_id,
        kind=data.kind,
        body=data.body,
        child_id=data.child_id,
        due_date=data.due_date,
        assigned_to=data.assigned_to,
    )
    db.add(post)
    db.flush()
    recipient = other_parent_id(db, member.household_id, member.user_id)
    notify(db, recipient, "wall_post_added", {"id": post.id, "kind": post.kind, "body": post.body[:120]})
    if data.assigned_to is not None and data.assigned_to != member.user_id:
        notify(db, data.assigned_to, "wall_task_assigned", {"id": post.id, "body": post.body[:120]})
    db.commit()
    db.refresh(post)
    return _serialize(db, post)


@router.patch("/wall/{post_id}", response_model=WallPostOut)
def update_post(
    post_id: int,
    data: WallPostPatch,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    post = _get_post(db, member, post_id)
    if post.author_id != member.user_id:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut modifier ce post")
    if data.body is not None:
        post.body = data.body
    if "child_id" in data.model_fields_set:
        _check_child(db, member, data.child_id)
        post.child_id = data.child_id
    if "due_date" in data.model_fields_set:
        post.due_date = data.due_date
    if "assigned_to" in data.model_fields_set:
        _check_member(db, member, data.assigned_to)
        post.assigned_to = data.assigned_to
    post.edited_at = utcnow()
    db.commit()
    db.refresh(post)
    return _serialize(db, post)


@router.delete("/wall/{post_id}", status_code=204)
def delete_post(
    post_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    post = _get_post(db, member, post_id)
    if post.author_id != member.user_id:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut supprimer ce post")
    for r in db.scalars(select(WallReply).where(WallReply.post_id == post.id)):
        db.delete(r)
    db.delete(post)
    db.commit()


@router.post("/wall/{post_id}/complete", response_model=WallPostOut)
def complete_post(
    post_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    post = _get_post(db, member, post_id)
    post.completed_at = utcnow()
    post.completed_by = member.user_id
    db.commit()
    db.refresh(post)
    return _serialize(db, post)


@router.post("/wall/{post_id}/reopen", response_model=WallPostOut)
def reopen_post(
    post_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    post = _get_post(db, member, post_id)
    post.completed_at = None
    post.completed_by = None
    db.commit()
    db.refresh(post)
    return _serialize(db, post)


@router.post("/wall/{post_id}/replies", response_model=WallReplyOut, status_code=201)
def add_reply(
    post_id: int,
    data: WallReplyIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    post = _get_post(db, member, post_id)
    reply = WallReply(post_id=post.id, author_id=member.user_id, body=data.body)
    db.add(reply)
    notify(
        db,
        other_parent_id(db, member.household_id, member.user_id),
        "wall_reply_added",
        {"post_id": post.id, "body": data.body[:120]},
    )
    db.commit()
    db.refresh(reply)
    return reply


@router.delete("/replies/{reply_id}", status_code=204)
def delete_reply(
    reply_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    reply = db.get(WallReply, reply_id)
    if reply is None:
        raise HTTPException(status_code=404, detail="Réponse introuvable")
    post = db.get(WallPost, reply.post_id)
    if post is None or post.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Réponse introuvable")
    if reply.author_id != member.user_id:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut supprimer cette réponse")
    db.delete(reply)
    db.commit()
