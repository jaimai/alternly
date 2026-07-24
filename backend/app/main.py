import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import models  # noqa: F401 — enregistre les tables
from .config import settings
from .db import Base, engine
from .migrations import run_migrations


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
from .routers import household as household_router
from .routers import calendar as calendar_router
from .routers import ical as ical_router
from .routers import marketing as marketing_router
from .routers import notifications as notifications_router
from .routers import rules as rules_router
from .routers import wall as wall_router

app = FastAPI(title="Alternly", lifespan=lifespan)

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


@app.get("/api/health")
def health():
    return {"status": "ok"}


# --- Site marketing SSR (landing, blog, sitemap) + assets statiques ---
# L'app React (SPA) est hébergée séparément sur Vercel ; le backend ne sert que
# l'API, le site marketing et les fichiers statiques.
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(marketing_router.router)
