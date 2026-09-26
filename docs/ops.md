# Runbook d'exploitation Alternly

Architecture de production (mono-domaine `alternly.com`) :

| Composant | Hébergeur | Contenu |
|---|---|---|
| Domaine public + SPA React | Vercel (`frontend/`, `frontend/vercel.json`) | sert l'app (`/app`, `/login`, `/register`, `/join/:token`, `/reset-password`, `/settings`, `/expenses`, `/wall`…) et **proxifie** vers Railway la landing (`/`, `/en`), le blog, les pages légales (`/terms`, `/privacy`, `/refund`, `/en/…`), `robots.txt`, `sitemap.xml`, `llms.txt`, `/static/*` et `/ical/*` (→ `/api/ical/*`) |
| API + site marketing SSR | Railway (service Docker, `Dockerfile` + `railway.json`) | `/api/*` appelée directement par la SPA (CORS, `VITE_API_URL`), pages SSR servies via le proxy Vercel |
| Base de données | PostgreSQL **alwaysdata** (UE) | toutes les données applicatives |
| Paiement | Paddle Billing (Merchant of Record) | abonnement Premium, webhooks `subscription.*` |
| E-mails | Resend | mot de passe oublié, propositions et rappels d'échange |
| Erreurs | Sentry (optionnel) | exceptions backend, expurgées |
| Cron | GitHub Actions (`.github/workflows/cron.yml`) | rappels d'échange quotidiens |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | pytest backend, traductions fusionnées, lint + build frontend |

Points d'attention :

- `frontend/vercel.json` contient l'URL Railway en dur (`web-production-….up.railway.app`) :
  à mettre à jour si le service Railway change de domaine.
- Le backend tourne avec **un seul worker uvicorn** : la limitation de débit
  (`backend/app/ratelimit.py`) est en mémoire du processus. Passer à plusieurs
  workers/réplicas impose d'abord de la déplacer vers Redis.
- uvicorn tourne avec `--proxy-headers --forwarded-allow-ips='*'` (IP client réelle
  derrière le proxy Railway). Un client peut toutefois forger `X-Forwarded-For` :
  les limites par IP sont un frein, pas une garantie (les limites par e-mail et par
  foyer ne dépendent pas de l'IP).

## Variables d'environnement (Railway)

Toutes lues par `backend/app/config.py` (insensibles à la casse).

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./coparent.db` | PostgreSQL alwaysdata, ex. `postgresql://user:pwd@postgresql-xxx.alwaysdata.net/dbname` (`postgres://` accepté, driver psycopg 3 forcé). |
| `SECRET_KEY` | — | Signature JWT. **Obligatoire** hors SQLite : refusée si vide, connue ou < 32 caractères (`python -c "import secrets;print(secrets.token_urlsafe(48))"`). La changer déconnecte tout le monde. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `43200` (30 j) | Durée de vie des jetons. |
| `APP_URL` | `http://localhost:5173` | Origine publique de la SPA (`https://alternly.com`) : liens des e-mails (`/app`, `/reset-password?token=…`) et d'invitation (`/join/<jeton>`), lien d'inscription de `llms.txt`. |
| `PUBLIC_SITE_URL` | `http://localhost:8000` | Origine publique du site (`https://alternly.com`) : canonical/OG, sitemap, robots, llms.txt (la landing étant proxifiée, l'URL de la requête serait celle de Railway). Vide → origine de la requête. |
| `CORS_ORIGINS` | `http://localhost:5173` | Origines autorisées, séparées par des virgules (`https://alternly.com`, + domaines de preview Vercel si besoin). |
| `RESEND_API_KEY` | vide | Vide → aucun e-mail envoyé (no-op journalisé, adresse masquée). |
| `EMAIL_FROM` | `Alternly <no-reply@alternly.com>` | Expéditeur ; domaine vérifié chez Resend. |
| `CRON_SECRET` | vide | Protège `POST /api/cron/exchange-reminders` (en-tête `X-Cron-Key`, comparaison à temps constant). Vide → endpoint désactivé (403). |
| `RATE_LIMIT_ENABLED` | `true` | Coupe la limitation de débit (à ne faire qu'en cas d'incident). |
| `SENTRY_DSN` | vide | Active Sentry si renseigné. |
| `SENTRY_ENVIRONMENT` | `production` | `staging`, `production`… |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.0` | Échantillonnage des traces de performance (0 → désactivé). |
| `PADDLE_WEBHOOK_SECRET` | vide | Secret de signature des webhooks (*Notifications → destination*). Vide → webhook refusé (403). |
| `PADDLE_API_KEY` | vide | Appels serveur (détail, résiliation, changement d'offre). Vide → gestion d'abonnement indisponible (502/`plan: null`). |
| `PADDLE_ENV` | `sandbox` | `sandbox` ou `production` (base de l'API Paddle). |
| `PADDLE_PRICE_ANNUAL` / `PADDLE_PRICE_MONTHLY` | vide | `price_id` des offres (changement d'offre, affichage de l'offre courante). |
| `TRIAL_DAYS` | `14` | Durée d'essai (héritée ; l'inscription est gratuite/freemium). |
| `PORT` | fourni par Railway | Port d'écoute uvicorn. |

Côté Vercel (préfixe `VITE_`, lues au build) : `VITE_API_URL` (URL de l'API Railway,
suffixe `/api`), `VITE_PADDLE_ENV`, `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_ID`,
`VITE_PADDLE_PRICE_ID_MONTHLY` (voir `backend/.env.example` et le code de `frontend/`).

## Railway (API)

1. **Service API** : déploiement depuis le dépôt, builder Dockerfile (`railway.json`),
   image non-root, healthcheck `/api/health` (fait un `SELECT 1` : 503 si la base est
   injoignable). Renseigner les variables ci-dessus.
2. **Région** : choisir une région **UE** (ex. `europe-west4`) pour rester cohérent avec
   la mention « données hébergées dans l'UE » des pages légales (`backend/app/legal.py`).
3. **Migrations** : pas d'Alembic ; `backend/app/migrations.py` ajoute au démarrage les
   colonnes manquantes (`ALTER TABLE … ADD COLUMN`) et les index (`CREATE INDEX IF NOT
   EXISTS`), `create_all` crée les nouvelles tables. Vérifier les logs du premier boot
   après une release.
4. `/docs`, `/redoc` et `/openapi.json` sont désactivés hors SQLite.

## Base de données (alwaysdata)

1. **Sauvegardes** : alwaysdata sauvegarde les bases quotidiennement (rétention selon
   l'offre, *Sauvegardes* dans l'administration). Vérifier qu'elles sont actives et que
   la rétention reste cohérente avec la politique de confidentialité.
2. **Sauvegarde indépendante** (recommandé) : un `pg_dump` hebdomadaire hors alwaysdata,
   chiffré, conservé 30 jours maximum.
3. **Connexions** : le moteur SQLAlchemy utilise `pool_pre_ping` et `pool_recycle=300`
   (connexions coupées côté serveur).

### Test de restauration (mensuel)

Une sauvegarde non testée n'est pas une sauvegarde. Chaque mois :

```bash
# 1. Dump de la prod (identifiants alwaysdata)
pg_dump --format=custom --no-owner --no-acl "$PROD_DATABASE_URL" -f alternly-$(date +%F).dump

# 2. Restauration dans une base jetable (Postgres local ou base alwaysdata temporaire)
createdb alternly_restore_test            # ou : docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=x postgres:16
pg_restore --no-owner --no-acl --clean --if-exists \
  --dbname "postgresql://localhost/alternly_restore_test" alternly-$(date +%F).dump

# 3. Contrôles de cohérence
psql "postgresql://localhost/alternly_restore_test" -c "select count(*) from users;" \
  -c "select count(*) from households;" -c "select max(created_at) from audit_log;"

# 4. Démarrer l'API sur la copie et vérifier /api/health + une connexion de test
cd backend && DATABASE_URL=postgresql://localhost/alternly_restore_test SECRET_KEY=<clé ≥ 32 car.> \
  uvicorn app.main:app --port 8001

# 5. Supprimer la copie et le dump (données personnelles !)
dropdb alternly_restore_test && shred -u alternly-*.dump
```

Tester aussi une fois par trimestre la restauration d'une sauvegarde alwaysdata vers
une nouvelle base. Noter date, durée et résultat.

## Vercel (domaine + SPA)

- Domaine `alternly.com` rattaché au projet Vercel ; `frontend/vercel.json` route le
  site marketing vers Railway et le reste vers la SPA (`index.html`).
- Après un changement de domaine Railway : mettre à jour `vercel.json` puis redéployer.
- Rollback : *Deployments → Promote to Production* d'un déploiement précédent.

## Paddle (abonnement Premium)

Modèle freemium : le calendrier (règles, échanges, demandes de changement, historique)
est gratuit ; Premium (dépenses, mur, e-mails, synchronisation iCal) au niveau du foyer
— un parent abonné débloque tout le foyer. Offres annuelle et mensuelle.

1. **Toujours commencer en sandbox** (`PADDLE_ENV=sandbox`, clés `pdl_sdbx_…`), valider
   le parcours complet, puis refaire la configuration en production.
2. **Prix** : les `price_id` annuel/mensuel côté Vercel (`VITE_PADDLE_PRICE_ID*`, checkout)
   et Railway (`PADDLE_PRICE_ANNUAL` / `PADDLE_PRICE_MONTHLY`, changement d'offre).
3. **Webhook** — *Developer Tools → Notifications → New destination* :
   URL `https://<api railway>/api/billing/webhook`, événements `subscription.*`
   (created, activated, updated, past_due, paused, canceled…). Copier le secret →
   `PADDLE_WEBHOOK_SECRET`. Le webhook est :
   - authentifié par la signature `Paddle-Signature` (HMAC du corps brut) ;
   - **idempotent** : les `event_id` traités sont stockés (table `paddle_events`) ;
     un rejeu répond `{"ok": true, "duplicate": true}` sans rien réappliquer ;
   - **insensible au désordre** : un événement dont `occurred_at` est antérieur au
     dernier traité pour le même abonnement est ignoré (`{"ok": true, "stale": true}`) ;
   - exclu de la limitation de débit.
4. **Suppression de compte** : l'abonnement Paddle est résilié au mieux (fin de période) ;
   en cas d'échec de l'API, la suppression a lieu quand même → résilier à la main.
5. Les changements d'abonnement (statut, offre, résiliation) apparaissent dans
   l'historique du foyer.

## Cron (GitHub Actions)

`.github/workflows/cron.yml` appelle chaque jour à 06:07 UTC l'endpoint des rappels
d'échange ; le job échoue si la réponse n'est pas 2xx (notification GitHub). Les rappels
sont idempotents (`reminder_sent_at`), les retries sont sans risque.

Secrets du dépôt (*Settings → Secrets and variables → Actions*) :

- `CRON_URL` = `https://<api railway>/api/cron/exchange-reminders`
- `CRON_SECRET` = même valeur que `CRON_SECRET` sur Railway (envoyée dans `X-Cron-Key`)

Déclenchement manuel : onglet *Actions → Cron → Run workflow*. Attention : GitHub
désactive les workflows planifiés après 60 jours sans activité sur le dépôt.

## Sentry

1. Créer un projet Python/FastAPI (région **UE** : `*.ingest.de.sentry.io`).
2. Renseigner `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, éventuellement `SENTRY_TRACES_SAMPLE_RATE=0.1`.
3. `send_default_pii=False` et un `before_send` (`backend/app/main.py`) retirent corps
   de requête, cookies, query string, en-têtes `Authorization` / `X-Cron-Key` /
   `Paddle-Signature` et jetons présents dans les URL (iCal, invitations).
4. Dans Sentry : *Settings → Security & Privacy* → activer « Data Scrubber » et
   « Prevent Storing of IP Addresses ».
5. Ajouter Sentry à la liste des sous-traitants des pages légales (`backend/app/legal.py`,
   FR et EN) avant de l'activer.

## Resend — domaine d'envoi

Dans Resend : *Domains → Add domain* (ex. `alternly.com` ou sous-domaine `mail.alternly.com`),
puis ajouter chez le registrar DNS les enregistrements **exactement tels qu'affichés** :

| Type | Nom | Valeur (exemple) | Rôle |
|---|---|---|---|
| TXT | `send` (ou `send.mail`) | `v=spf1 include:amazonses.com ~all` | SPF du domaine de retour (MAIL FROM) |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (prio 10) | retours / bounces |
| TXT | `resend._domainkey` | `p=MIGfMA0GCS…` (clé fournie) | DKIM |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@alternly.com` | DMARC en observation |

Choisir la région **EU (eu-west-1)** si proposée. Attendre le statut *Verified*, puis
`EMAIL_FROM=Alternly <no-reply@alternly.com>` et `RESEND_API_KEY`. Après quelques
semaines de rapports DMARC propres, passer à `p=quarantine`.

Vérifier : « Mot de passe oublié » sur un compte de test (FR puis EN) → e-mail reçu,
non classé spam, lien `APP_URL/reset-password?token=…` fonctionnel (valable 1 h,
usage unique).

## Checklist de déploiement

- [ ] CI verte sur `main` (tests backend, traductions, lint + build frontend).
- [ ] Variables Railway à jour (`SECRET_KEY` forte, `APP_URL`, `PUBLIC_SITE_URL`,
      `CORS_ORIGINS`, `RESEND_API_KEY`, `CRON_SECRET`, `PADDLE_*`, `SENTRY_DSN`).
- [ ] Régions UE vérifiées (Railway, alwaysdata, Vercel) ; sinon corriger `legal.py`.
- [ ] Sauvegardes alwaysdata actives, dernier test de restauration < 1 mois.
- [ ] Domaine Resend vérifié (SPF, DKIM, DMARC).
- [ ] Paddle : parcours validé en sandbox (checkout → webhook → gestion → résiliation),
      puis prix, webhook et clés recréés en production.
- [ ] Secrets GitHub `CRON_URL` / `CRON_SECRET` posés, un *Run workflow* manuel réussi.
- [ ] Logs du premier boot (migrations) propres, `/api/health` = `{"status": "ok"}`.
- [ ] Smoke test : inscription, connexion, création de foyer, invitation (`/join/…`),
      demande de changement acceptée, historique, export des données, mot de passe
      oublié, blog visible.

## Incidents — bases

1. **Constater** : `/api/health` (503 = base injoignable), logs Railway
   (*Deployments → View logs*), Sentry, statut des fournisseurs
   (status.railway.com, vercel-status.com, resend-status.com, status.paddle.com,
   status.alwaysdata.com).
2. **Stabiliser** : *Redeploy* du dernier déploiement sain dans Railway (rollback en
   un clic). Côté Vercel : *Promote to Production* d'un déploiement précédent.
3. **Abus / force brute** : la limitation de débit renvoie des 429 (`Retry-After`).
   Compte compromis : réinitialiser son mot de passe (révoque toutes ses sessions) ;
   l'utilisateur peut aussi « déconnecter tous les appareils » (`POST /api/auth/logout-all`).
   En dernier recours, changer `SECRET_KEY` déconnecte **tous** les utilisateurs.
4. **Fuite de secret** : régénérer immédiatement la clé concernée (Resend, Paddle,
   Sentry, `CRON_SECRET` des deux côtés, `SECRET_KEY`, mot de passe alwaysdata).
5. **Violation de données personnelles** : documenter (quoi, quand, combien de
   personnes), notifier la **CNIL sous 72 h** (notifications.cnil.fr) si risque pour
   les personnes, et informer les utilisateurs concernés si risque élevé.
6. **Après coup** : courte note post-mortem (cause, impact, correctifs).
