"""API publique (sans authentification) des outils gratuits du site marketing."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..ratelimit import MINUTE, rate_limit
from ..services import vacation_tool
from ..services.public_holidays import PublicDataUnavailable

router = APIRouter(prefix="/api/public", tags=["public"])

UNAVAILABLE = (
    "Le calendrier scolaire officiel est momentanément indisponible. "
    "Réessayez dans quelques minutes."
)
NOT_PUBLISHED = "Les dates officielles de ces vacances ne sont pas encore publiées pour cette zone."


@router.get(
    "/vacation-split",
    dependencies=[Depends(rate_limit("vacation_tool", 30, MINUTE))],
)
def vacation_split(
    response: Response,
    zone: Literal["A", "B", "C"],
    period: Literal["toussaint", "noel", "hiver", "printemps", "ete"],
    year: int = Query(ge=2000, le=2100),
    mode: Literal["split_half", "alternate_full"] = "split_half",
    even_first: Literal["A", "B"] = "A",
    db: Session = Depends(get_db),
):
    """Dates officielles d'une période de vacances + partage entre « A » et « B »,
    calculé par le moteur de garde de l'app (règle en mémoire, aucun foyer)."""
    if year not in vacation_tool.allowed_years():
        raise HTTPException(
            status_code=422,
            detail="Année hors de la plage proposée (année scolaire en cours et suivante).",
        )
    try:
        result = vacation_tool.vacation_split(db, zone, period, year, mode, even_first)
    except PublicDataUnavailable:
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    except vacation_tool.PeriodNotPublished:
        raise HTTPException(status_code=404, detail=NOT_PUBLISHED)
    response.headers["Cache-Control"] = "public, max-age=3600"
    return result
