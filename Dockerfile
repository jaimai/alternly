# syntax=docker/dockerfile:1
# Backend Alternly : API FastAPI + site marketing SSR.
# La SPA React est hébergée séparément (Vercel).
FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ ./backend/

WORKDIR /app/backend
EXPOSE 8000
# Railway fournit $PORT ; fallback 8000 en local.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
