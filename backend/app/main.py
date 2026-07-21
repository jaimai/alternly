from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Coparent", lifespan=lifespan)


@app.get("/api/health")
def health():
    return {"status": "ok"}
