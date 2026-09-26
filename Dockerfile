# syntax=docker/dockerfile:1
# Backend Alternly : API FastAPI + site marketing SSR.
# La SPA React est hébergée séparément (Vercel).
FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# requirements.txt = dépendances de prod uniquement (pytest dans requirements-dev.txt).
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ ./backend/
# Articles du blog : lus par services/blog.py depuis /app/content/blog.
COPY content/ ./content/

# Utilisateur non-root (propriétaire de backend/ pour un éventuel SQLite local).
RUN useradd --system --uid 10001 --no-create-home alternly && chown alternly /app/backend
USER alternly

WORKDIR /app/backend
EXPOSE 8000
# Railway fournit $PORT ; fallback 8000 en local. Derrière le proxy TLS de Railway,
# --proxy-headers fait respecter X-Forwarded-Proto (URLs absolues en https).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
