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

app = FastAPI(title="Coparent", lifespan=lifespan)
app.include_router(auth_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
