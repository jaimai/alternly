# Alternly 🗓️

Calendrier de garde partagée pour parents séparés, pensé pour la France :
rythmes de garde (semaine/semaine, 2-2-3, un week-end sur deux, personnalisé),
vacances scolaires officielles par zone A/B/C avec partage années paires/impaires,
jours fériés et fêtes, exceptions ponctuelles, partage entre les deux parents,
notifications in-app et abonnement iCal (Google/Apple Calendar).

**Déploiement en deux morceaux** :

- **Railway** : backend FastAPI (image `Dockerfile`) — API `/api/*` **et** site marketing
  SSR (landing, blog, pages légales, sitemap) + PostgreSQL ;
- **Vercel** : SPA React (`frontend/`), servie sur `APP_URL`, qui appelle l'API en CORS.

Exploitation (variables d'environnement, sauvegardes, cron, Sentry, e-mails,
checklist de déploiement) : voir **[docs/ops.md](docs/ops.md)**.

## Architecture

```
backend/   FastAPI + SQLAlchemy (Python 3.13) — API, moteur de garde pur et testé, site marketing SSR
frontend/  React 18 + Vite + TypeScript + FullCalendar — SPA déployée sur Vercel
content/   articles du blog (Markdown)
docs/      runbook d'exploitation (ops.md), specs et plans
.github/   CI (tests backend, lint + build frontend) et cron quotidien
```

Données publiques intégrées (avec cache en base) :
- Vacances scolaires : dataset `fr-en-calendrier-scolaire` (data.education.gouv.fr)
- Jours fériés : calendrier.api.gouv.fr

## Démarrage

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # requirements.txt + pytest
cp .env.example .env        # puis renseigner DATABASE_URL et SECRET_KEY
.venv/bin/uvicorn app.main:app --port 8000
```

Sans `.env`, l'app démarre en mode dev sur SQLite (`backend/coparent.db`).

**PostgreSQL (production : Railway)** — liste complète des variables dans
[docs/ops.md](docs/ops.md#variables-denvironnement).

Hors SQLite, l'app **refuse de démarrer** si la SECRET_KEY est absente, connue
ou fait moins de 32 caractères. `/docs`, `/redoc` et `/openapi.json` n'y sont pas exposés.

Le site marketing est alors servi sur **http://localhost:8000** (API sous `/api`).

### 2. Frontend (SPA)

```bash
cd frontend
npm install
npm run dev        # Vite sur :5173 (= APP_URL par défaut), proxy /api → :8000
```

En production, la SPA est buildée et hébergée par **Vercel** ; le backend ne sert
plus `frontend/dist`.

## Tests

```bash
cd backend && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/ -q
```

Les tests sont hermétiques : SQLite en mémoire, APIs publiques (vacances scolaires,
jours fériés) simulées dans `tests/conftest.py`.

Plus de 200 tests, dont la partie critique : bascules années paires/impaires des vacances,
périodes à cheval sur deux années (Noël), coupe en moitiés paires/impaires,
fêtes des mères/pères (y compris le décalage Pentecôte), priorités
exception > fête > vacances > rythme, isolation entre foyers, flux invitation, iCal,
réinitialisation de mot de passe, révocation de sessions, export et suppression de
compte (RGPD), limitation de débit, pages légales.

La CI GitHub Actions (`.github/workflows/ci.yml`) lance ces tests ainsi que le lint
et le build du frontend à chaque push / pull request.

## Points de conception

- **On stocke les règles, pas les occurrences** : le moteur (`backend/app/services/custody_engine.py`)
  est une fonction pure qui résout n'importe quelle plage de dates à la volée.
  Les exceptions ponctuelles sont une surcouche, jamais une mutation du planning.
- Les périodes de vacances du dataset officiel sont converties en **bornes incluses
  Europe/Paris** ; l'été est reconstruit à partir du marqueur « Début des Vacances d'Été »
  et de la rentrée de l'année scolaire suivante.
- Un seul foyer par utilisateur, deux parents max, invitation par lien signé à expiration.
- RGPD : minimisation (prénom de l'enfant seulement, anniversaire optionnel),
  hébergement UE visé, lien iCal révocable, export JSON (`GET /api/auth/me/export`),
  suppression de compte (`DELETE /api/auth/me` : effacement si seul dans le foyer,
  anonymisation si un coparent reste), polices auto-hébergées, pas de cookie de traçage.
- Sessions : JWT portant une version (`tv`) ; changement/réinitialisation de mot de passe
  et « déconnecter tous les appareils » l'incrémentent et révoquent les anciens jetons.

## Périmètre actuel (MVP) et suite

Inclus : calendrier + moteur FR complet, partage 2 parents, exceptions, iCal,
notifications in-app.
V1 prévue (voir dossier de cadrage) : dépenses partagées, messagerie horodatée,
export PDF, paiement Stripe, PWA/app mobile.
