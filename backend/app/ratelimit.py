"""Limitation de débit anti-abus : fenêtre glissante en mémoire.

Compteurs **par processus** : exact avec un seul worker uvicorn (déploiement
actuel sur Railway). Avec plusieurs workers ou instances, chacun aurait ses
propres compteurs (limite effective multipliée) → passer à un stockage partagé
(Redis) le moment venu, en gardant la même interface `rate_limit(...)`.

Clé IP : `request.client.host`, déjà réécrit depuis X-Forwarded-For par
uvicorn `--proxy-headers` derrière le proxy Railway.
"""
import math
import threading
import time
from collections import deque
from typing import Literal

from fastapi import Depends, HTTPException, Request

from .config import settings
from .deps import get_membership
from .models import HouseholdMember

TOO_MANY = "Trop de tentatives, réessayez dans quelques minutes"

MINUTE = 60
HOUR = 3600
DAY = 86400


class SlidingWindowLimiter:
    """Horodatages des tentatives par clé, purgés au-delà de la fenêtre."""

    _PRUNE_EVERY = 1000  # purge des clés inactives toutes les N tentatives

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._hits: dict[str, tuple[int, deque[float]]] = {}
        self._lock = threading.Lock()
        self._count = 0

    def hit(self, key: str, limit: int, window: int) -> int:
        """Enregistre une tentative. 0 si autorisée, sinon secondes avant la prochaine."""
        now = self._clock()
        with self._lock:
            _, hits = self._hits.setdefault(key, (window, deque()))
            while hits and hits[0] <= now - window:
                hits.popleft()
            if len(hits) >= limit:
                return max(1, math.ceil(hits[0] + window - now))
            hits.append(now)
            self._count += 1
            if self._count % self._PRUNE_EVERY == 0:
                self._prune(now)
            return 0

    def _prune(self, now: float) -> None:
        stale = [k for k, (w, h) in self._hits.items() if not h or h[-1] <= now - w]
        for k in stale:
            del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._count = 0


limiter = SlidingWindowLimiter()


def _check(key: str, limit: int, window: int) -> None:
    retry_after = limiter.hit(key, limit, window)
    if retry_after:
        raise HTTPException(status_code=429, detail=TOO_MANY, headers={"Retry-After": str(retry_after)})


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "inconnu"


def rate_limit(
    scope: str,
    limit: int,
    window: int,
    *,
    by: Literal["ip", "body", "household"] = "ip",
    field: str = "email",
):
    """Fabrique de dépendance FastAPI : `dependencies=[Depends(rate_limit(...))]`.

    - by="ip" : par adresse IP cliente ;
    - by="body" : par valeur d'un champ du corps JSON (ex. l'e-mail visé) ;
    - by="household" : par foyer, **après** contrôle d'appartenance (un tiers ne
      peut pas épuiser le quota d'un foyer qui n'est pas le sien).
    """
    if by == "household":
        def household_dep(member: HouseholdMember = Depends(get_membership)) -> None:
            if settings.rate_limit_enabled:
                _check(f"{scope}:hh:{member.household_id}", limit, window)

        return household_dep

    if by == "body":
        async def body_dep(request: Request) -> None:
            if not settings.rate_limit_enabled:
                return
            try:
                data = await request.json()  # corps mis en cache par Starlette
            except ValueError:
                return  # corps invalide : la validation renverra 422
            value = data.get(field) if isinstance(data, dict) else None
            if isinstance(value, str) and value.strip():
                _check(f"{scope}:{field}:{value.strip().lower()}", limit, window)

        return body_dep

    def ip_dep(request: Request) -> None:
        if settings.rate_limit_enabled:
            _check(f"{scope}:ip:{_client_ip(request)}", limit, window)

    return ip_dep
