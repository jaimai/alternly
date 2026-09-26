import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models  # noqa: F401 — enregistre les tables
from .config import settings
from .db import Base, engine, get_db
from .migrations import run_migrations

# Segments d'URL portant un secret (flux iCal, invitation).
_SECRET_PATH = re.compile(r"(/api/(?:ical|invitations)/)[^/?#]+")
# En-têtes jamais transmis à Sentry (jetons, cookies, clé cron, signature Paddle).
_SENSITIVE_HEADERS = {"authorization", "cookie", "set-cookie", "x-cron-key", "paddle-signature"}


def _scrub_event(event, hint):
    """before_send Sentry : retire corps de requête, cookies et secrets (RGPD)."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)  # mots de passe, notes, messages entre parents…
        request.pop("cookies", None)
        request.pop("query_string", None)  # jetons de reset / d'invitation possibles
        if isinstance(request.get("url"), str):
            request["url"] = _SECRET_PATH.sub(r"\1[filtré]", request["url"])
        headers = request.get("headers")
        if isinstance(headers, dict):
            for name in list(headers):
                if name.lower() in _SENSITIVE_HEADERS:
                    headers[name] = "[filtré]"
    return event


if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        before_send=_scrub_event,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.secret_key == "dev-secret-change-me":
        logging.getLogger("coparent").warning(
            "SECRET_KEY par défaut détectée — à ne jamais utiliser en production (voir .env.example)"
        )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    yield


from .routers import auth as auth_router
from .routers import billing as billing_router
from .routers import children as children_router
from .routers import cron as cron_router
from .routers import expenses as expenses_router
from .routers import history as history_router
from .routers import household as household_router
from .routers import calendar as calendar_router
from .routers import ical as ical_router
from .routers import marketing as marketing_router
from .routers import notifications as notifications_router
from .routers import rules as rules_router
from .routers import wall as wall_router

# Documentation interactive seulement en dev (SQLite) : inutile d'exposer le
# schéma complet de l'API en production.
_docs = {} if settings.is_sqlite else {"docs_url": None, "redoc_url": None, "openapi_url": None}
app = FastAPI(title="Alternly", lifespan=lifespan, **_docs)

# En-têtes de sécurité sur toutes les réponses (API et site marketing).
# Permissions-Policy : pas de payment=() — le checkout Paddle peut en avoir besoin.
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
if not settings.is_sqlite:
    _SECURITY_HEADERS["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response

# La SPA (Vercel) appelle l'API depuis une autre origine → CORS.
# Auth par jeton Bearer (pas de cookies) : allow_credentials inutile.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(household_router.router)
app.include_router(children_router.router)
app.include_router(rules_router.router)
app.include_router(calendar_router.router)
app.include_router(ical_router.router)
app.include_router(notifications_router.router)
app.include_router(cron_router.router)
app.include_router(expenses_router.router)
app.include_router(wall_router.router)
app.include_router(billing_router.router)
app.include_router(history_router.router)


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    # Vérifie la base : Railway ne bascule le trafic que si elle répond.
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        logging.getLogger("coparent").exception("Healthcheck : base de données injoignable")
        return JSONResponse(status_code=503, content={"status": "error", "db": "down"})
    return {"status": "ok"}


# --- Site marketing SSR (landing, blog, sitemap) + assets statiques ---
# L'app React (SPA) est hébergée séparément sur Vercel ; le backend ne sert que
# l'API, le site marketing et les fichiers statiques.
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(marketing_router.router)
