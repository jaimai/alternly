"""Téléphones inscrits aux notifications push et préférences par catégorie."""
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import DeviceToken, User, utcnow
from ..services import push

router = APIRouter(prefix="/api/devices", tags=["devices"])


class DeviceIn(BaseModel):
    # Jeton Expo : ExponentPushToken[…] (ou ExpoPushToken[…]).
    token: str = Field(min_length=10, max_length=200, pattern=r"^Expo(nent)?PushToken\[.+\]$")
    platform: str = Field(pattern="^(ios|android)$")
    app_version: str | None = Field(default=None, max_length=30)


class PushPrefs(BaseModel):
    handover: bool = True
    exchanges: bool = True
    expenses: bool = True
    wall: bool = True
    household: bool = True


@router.post("", status_code=204)
def register_device(data: DeviceIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Inscrit (ou rattache) le téléphone : un même jeton ne vise qu'un compte à la fois."""
    device = db.scalar(select(DeviceToken).where(DeviceToken.token == data.token))
    if device is None:
        db.add(DeviceToken(user_id=user.id, token=data.token, platform=data.platform, app_version=data.app_version))
    else:
        device.user_id = user.id  # téléphone passé sur un autre compte
        device.platform = data.platform
        device.app_version = data.app_version
        device.last_seen_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.delete("/{token}", status_code=204)
def unregister_device(token: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Déconnexion de l'app : le téléphone ne reçoit plus les push de ce compte."""
    db.execute(delete(DeviceToken).where(DeviceToken.token == token, DeviceToken.user_id == user.id))
    db.commit()
    return Response(status_code=204)


@router.get("/prefs", response_model=PushPrefs)
def get_prefs(user: User = Depends(get_current_user)):
    return PushPrefs(**{c: push.wants_category(user, c) for c in push.CATEGORIES})


@router.put("/prefs", response_model=PushPrefs)
def set_prefs(data: PushPrefs, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.push_prefs = data.model_dump()
    db.commit()
    return data
