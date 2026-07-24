# syntax=docker/dockerfile:1

# ---- Étape 1 : build du frontend React (Vite) ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Étape 2 : runtime backend FastAPI qui sert le build ----
FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ ./backend/
# Le backend sert frontend/dist (chemin relatif attendu par app/main.py).
COPY --from=frontend /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
EXPOSE 8000
# Railway fournit $PORT ; fallback 8000 en local.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
