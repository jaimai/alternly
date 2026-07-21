from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Notification, User, utcnow
from ..schemas import NotificationOut, ReadNotificationsIn

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    ).all()


@router.post("/read")
def mark_read(data: ReadNotificationsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notifs = db.scalars(
        select(Notification).where(Notification.user_id == user.id, Notification.id.in_(data.ids))
    ).all()
    now = utcnow()
    for n in notifs:
        if n.read_at is None:
            n.read_at = now
    db.commit()
    return {"updated": len(notifs)}
