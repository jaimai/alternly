# Coparent 🗓️

Calendrier de garde partagée pour parents séparés, pensé pour la France :
rythmes de garde (semaine/semaine, 2-2-3, un week-end sur deux, personnalisé),
vacances scolaires officielles par zone A/B/C avec partage années paires/impaires,
jours fériés et fêtes, exceptions ponctuelles, partage entre les deux parents,
notifications in-app et abonnement iCal (Google/Apple Calendar).

**Monolithe** : un backend FastAPI sert l'API (`/api/*`) **et** le frontend React buildé.

## Architecture

```
backend/   FastAPI + SQLAlchemy (Python 3.13) — moteur de garde pur et testé
frontend/  React 18 + Vite + TypeScript + FullCalendar
docs/      spec de design et plan d'implémentation
```

Données publiques intégrées (avec cache en base) :
- Vacances scolaires : dataset `fr-en-calendrier-scolaire` (data.education.gouv.fr)
- Jours fériés : calendrier.api.gouv.fr

## Démarrage

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # puis renseigner DATABASE_URL et SECRET_KEY
.venv/bin/uvicorn app.main:app --port 8000
```

Sans `.env`, l'app démarre en mode dev sur SQLite (`backend/coparent.db`).

**PostgreSQL (alwaysdata)** — dans `backend/.env` :

```
DATABASE_URL=postgresql+psycopg://user:password@postgresql-xxx.alwaysdata.net/dbname
SECRET_KEY=<64 caractères aléatoires>
```

Hors SQLite, l'app **refuse de démarrer** avec la SECRET_KEY par défaut.

### 2. Frontend

```bash
cd frontend
npm install
npm run build      # produit frontend/dist, servi automatiquement par FastAPI
```

Ensuite ouvrir **http://localhost:8000** — l'app complète tourne sur ce seul port.

### Développement front avec rechargement à chaud

```bash
cd frontend && npm run dev    # Vite sur :5173, proxy /api → :8000
```

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

66 tests, dont la partie critique : bascules années paires/impaires des vacances,
périodes à cheval sur deux années (Noël), coupe en moitiés paires/impaires,
fêtes des mères/pères (y compris le décalage Pentecôte), priorités
exception > fête > vacances > rythme, isolation entre foyers, flux invitation, iCal.

## Points de conception

- **On stocke les règles, pas les occurrences** : le moteur (`backend/app/services/custody_engine.py`)
  est une fonction pure qui résout n'importe quelle plage de dates à la volée.
  Les exceptions ponctuelles sont une surcouche, jamais une mutation du planning.
- Les périodes de vacances du dataset officiel sont converties en **bornes incluses
  Europe/Paris** ; l'été est reconstruit à partir du marqueur « Début des Vacances d'Été »
  et de la rentrée de l'année scolaire suivante.
- Un seul foyer par utilisateur, deux parents max, invitation par lien signé à expiration.
- RGPD : minimisation (prénom de l'enfant seulement, anniversaire optionnel),
  hébergement UE visé, lien iCal révocable.

## Périmètre actuel (MVP) et suite

Inclus : calendrier + moteur FR complet, partage 2 parents, exceptions, iCal,
notifications in-app.
V1 prévue (voir dossier de cadrage) : dépenses partagées, messagerie horodatée,
export PDF, paiement Stripe, PWA/app mobile.
