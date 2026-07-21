import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import models  # noqa: F401 — enregistre les tables
from .config import settings
from .db import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.secret_key == "dev-secret-change-me":
        logging.getLogger("coparent").warning(
            "SECRET_KEY par défaut détectée — à ne jamais utiliser en production (voir .env.example)"
        )
    Base.metadata.create_all(bind=engine)
    yield


from .routers import auth as auth_router
from .routers import children as children_router
from .routers import household as household_router
from .routers import calendar as calendar_router
from .routers import rules as rules_router

app = FastAPI(title="Coparent", lifespan=lifespan)
app.include_router(auth_router.router)
app.include_router(household_router.router)
app.include_router(children_router.router)
app.include_router(rules_router.router)
app.include_router(calendar_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
