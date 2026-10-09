# Runbook d'exploitation Alternly

Architecture de production (mono-domaine `alternly.com`) :

| Composant | Hébergeur | Contenu |
|---|---|---|
| Domaine public + SPA React | Vercel (`frontend/`, `frontend/vercel.json`) | sert l'app (`/app`, `/login`, `/register`, `/join/:token`, `/reset-password`, `/settings`, `/expenses`, `/wall`…) et **proxifie** vers Railway la landing (`/`, `/en`), le blog, les pages légales (`/terms`, `/privacy`, `/refund`, `/en/…`), `robots.txt`, `sitemap.xml`, `llms.txt`, `/static/*`, `/ical/*` (→ `/api/ical/*`) et `/api/email/*` (désinscription des e-mails) |
| API + site marketing SSR | Railway (service Docker, `Dockerfile` + `railway.json`) | `/api/*` appelée directement par la SPA (CORS, `VITE_API_URL`), pages SSR servies via le proxy Vercel |
| Base de données | PostgreSQL **alwaysdata** (UE) | toutes les données applicatives |
| Paiement | Paddle Billing (Merchant of Record) | abonnement Premium, webhooks `subscription.*` |
| E-mails | Resend | mot de passe oublié, échanges, boucle d'invitation, cycle de vie (bienvenue, rappels de vacances) — voir « E-mails » |
| Erreurs | Sentry (optionnel) | exceptions backend, expurgées |
| Cron | GitHub Actions (`.github/workflows/cron.yml`, `push-reminders.yml`) | rappels d'échange, relances d'invitation, e-mails de cycle de vie (quotidien, matin) ; rappels de passation en push (quotidien, soir) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | pytest backend, traductions fusionnées, lint + build frontend |

Points d'attention :

- **Monorepo, déploiements filtrés par chemins** (voir `docs/mobile/architecture-technique.md`) :
  Railway ne redéploie que si `backend/`, `content/`, `Dockerfile`, `.dockerignore` ou
  `railway.json` changent (`build.watchPatterns`) ; Vercel saute le build si `frontend/`
  n'a pas changé depuis le dernier déploiement réussi (`ignoreCommand` →
  `frontend/scripts/vercel-ignore.sh`) ; la CI ne lance que les jobs des zones modifiées.
  Un commit qui ne touche que `docs/` ne déploie donc rien. Pour forcer un déploiement :
  *Redeploy* dans Railway ou Vercel.

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
| `PUBLIC_SITE_URL` | `http://localhost:8000` | Origine publique du site (`https://alternly.com`) : canonical/OG, sitemap, robots, llms.txt, liens de désinscription des e-mails (`/api/email/unsubscribe`, relayé par Vercel) (la landing étant proxifiée, l'URL de la requête serait celle de Railway). Vide → origine de la requête. |
| `CORS_ORIGINS` | `http://localhost:5173` | Origines autorisées, séparées par des virgules (`https://alternly.com`, + domaines de preview Vercel si besoin). |
| `RESEND_API_KEY` | vide | Vide → aucun e-mail envoyé (no-op journalisé, adresse masquée). |
| `EMAIL_FROM` | `Alternly <alternly@xn--hn-vrab.com>` | Expéditeur ; domaine vérifié chez Resend (`hōnō.com`, forme ASCII ; un domaine accentué est converti automatiquement). |
| `CRON_SECRET` | vide | Protège les endpoints `POST /api/cron/*` (`exchange-reminders`, `invite-reminders`, `lifecycle`, `handover-reminders` ; en-tête `X-Cron-Key`, comparaison à temps constant). Vide → endpoint désactivé (403). |
| `PUSH_API_URL` | `https://exp.host/--/api/v2/push/send` | Service Expo qui relaie les notifications push de l'app mobile vers APNs / FCM. À ne changer que pour viser un faux service en recette. |
| `FEEDBACK_EMAIL` | vide | Boîte qui reçoit les signalements « Signaler un problème / Une idée » (`POST /api/feedback`, Reply-To = e-mail de l'utilisateur). Vide → signalements seulement enregistrés en base (table `feedback`). |
| `RATE_LIMIT_ENABLED` | `true` | Coupe la limitation de débit (à ne faire qu'en cas d'incident). |
| `SENTRY_DSN` | vide | Active Sentry si renseigné. |
| `GOOGLE_CLIENT_ID` | vide | Active « Continuer avec Google » (voir la section Google). |
| `SENTRY_ENVIRONMENT` | `production` | `staging`, `production`… |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.0` | Échantillonnage des traces de performance (0 → désactivé). |
| `POSTHOG_TOKEN` | vide | Clé de projet PostHog (`phc_…`, UE). Vide → aucune mesure d'audience ni bannière (voir `docs/analytics.md`). |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` | Ingestion PostHog côté serveur. |
| `POSTHOG_SERVER_LOGS` | `false` | Envoie les logs WARNING+ en événements `server_log` (30/min max). |
| `PADDLE_WEBHOOK_SECRET` | vide | Secret de signature des webhooks (*Notifications → destination*). Vide → webhook refusé (403). |
| `REVENUECAT_WEBHOOK_SECRET` | vide | Achats intégrés : valeur exacte de l'en-tête `Authorization` du webhook RevenueCat (`/api/billing/revenuecat-webhook`). Vide → webhook refusé (503). |
| `REVENUECAT_API_KEY` | vide | Clé secrète RevenueCat (`sk_…`) : resynchronisation après achat et « Restaurer les achats » (`/api/billing/store-sync`). Vide → seul le webhook alimente l'accès. |
| `PADDLE_API_KEY` | vide | Appels serveur (détail, résiliation, changement d'offre). Vide → gestion d'abonnement indisponible (502/`plan: null`). |
| `PADDLE_ENV` | `sandbox` | `sandbox` ou `production` (base de l'API Paddle). |
| `PADDLE_PRICE_ANNUAL` / `PADDLE_PRICE_MONTHLY` | vide | `price_id` des offres. **Source de vérité** : servis à l'app et à la landing par `GET /api/billing/plans` (le mensuel n'est proposé que si `PADDLE_PRICE_MONTHLY` est renseigné ; plus de repli silencieux sur l'annuel). |
| `DISCOUNT_CODE` / `DISCOUNT_PERCENT` / `DISCOUNT_VALID_DAYS` | `BIENVENUE20` / `20` / `7` | Offre de bienvenue (e-mail unique, voir plus bas). `DISCOUNT_CODE` vide → offre désactivée. Le code doit exister dans Paddle. |
| `ANNUAL_TRIAL_DAYS` | `0` | Essai affiché **seulement si l'API Paddle est injoignable**. Sinon, la durée d'essai est lue sur le prix annuel Paddle (cache 1 h) : l'app n'annonce jamais un essai que Paddle n'applique pas. |
| `TRIAL_DAYS` | `14` | Durée d'essai (héritée ; l'inscription est gratuite/freemium). |
| `PORT` | fourni par Railway | Port d'écoute uvicorn. |

Côté Vercel (préfixe `VITE_`, lues au build) : `VITE_API_URL` (URL de l'API Railway,
suffixe `/api`), `VITE_PADDLE_ENV`, `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_ID`,
`VITE_PADDLE_PRICE_ID_MONTHLY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_POSTHOG_KEY` (+ `VITE_POSTHOG_HOST` optionnel, défaut `/ingest`) (voir `backend/.env.example` et le code de `frontend/`).

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

## Connexion avec Google

Bouton « Continuer avec Google » sur la connexion, l'inscription et l'invitation
(Google Identity Services). Le navigateur reçoit un jeton d'identité signé que
l'API vérifie (`POST /api/auth/google`) : signature (clés publiques Google en
cache), audience = notre ID client, émetteur, expiration, e-mail vérifié.
Pas de secret client. Un compte existant avec le même e-mail (vérifié par Google)
est relié automatiquement ; sinon un compte est créé, sans mot de passe (il peut
en définir un dans Réglages → Compte).

Mise en place (Google Cloud Console → APIs & Services) :
1. **Écran de consentement OAuth** : type Externe, nom « Alternly », logo, e-mail
   d'assistance, domaine `alternly.com`, liens CGU (`/terms`) et confidentialité
   (`/privacy`). Portées : `openid`, `email`, `profile` uniquement (pas de
   vérification Google longue). Passer l'app « En production ».
2. **Identifiants → ID client OAuth → Application Web** : origines JavaScript
   autorisées `https://alternly.com` (+ `http://localhost:5173` en dev, et
   l'URL de prévisualisation Vercel si besoin). Pas d'URI de redirection (mode popup).
3. Renseigner l'ID client dans `GOOGLE_CLIENT_ID` (Railway) **et**
   `VITE_GOOGLE_CLIENT_ID` (Vercel, puis redéployer). Le bouton n'apparaît que
   si la variable Vercel est définie.

## Cron (GitHub Actions)

`.github/workflows/cron.yml` tourne chaque jour à 06:07 UTC et enchaîne trois jobs ;
chacun échoue si la réponse n'est pas 2xx (notification GitHub). Tous sont idempotents
(horodatages / `email_log`), les retries sont sans risque.

| Job | Endpoint | Rôle |
|---|---|---|
| `exchange-reminders` | `POST /api/cron/exchange-reminders` | proposition d'échange qui expire demain (Premium) |
| `invite-reminders` | `POST /api/cron/invite-reminders` | relances de l'invitation (inviteur J+2/J+5, invité J+3, nudge 24 h) |
| `lifecycle` | `POST /api/cron/lifecycle` | rappels de vacances scolaires puis séquence J1/J3/J7 ; lancé **après** `invite-reminders` (`needs` + `if: always()`) pour que le garde-fou « un e-mail par jour » voie leurs envois |

Secrets du dépôt (*Settings → Secrets and variables → Actions*) :

- `CRON_URL` = `https://<api railway>/api/cron/exchange-reminders` (les autres URL en sont
  déduites : même base, autre suffixe)
- `CRON_SECRET` = même valeur que `CRON_SECRET` sur Railway (envoyée dans `X-Cron-Key`)
- Ces deux secrets peuvent être des secrets du dépôt ou de l'environnement GitHub `alternly / production` (les jobs de `cron.yml` le déclarent).

Déclenchement manuel : onglet *Actions → Cron → Run workflow*. Attention : GitHub
désactive les workflows planifiés après 60 jours sans activité sur le dépôt.


`.github/workflows/push-reminders.yml` tourne chaque soir à 17:07 UTC (`POST /api/cron/handover-reminders`, mêmes secrets) : push la veille d'un changement de parent aux téléphones inscrits. Idempotent (`email_log`), relançable à la main (*Run workflow*).

## E-mails

Tous partent par Resend (`backend/app/services/email.py`), dans la langue du destinataire
(`users.locale`), et seulement si `users.email_opt_in` est vrai (sauf mot de passe oublié
et invitation envoyée à une adresse saisie).

| E-mail | Quand | Conditions |
|---|---|---|
| Bienvenue (J0) | à l'inscription (tâche d'arrière-plan) | inscription hors invitation |
| Bienvenue dans le foyer de {prénom} (J0) | à l'acceptation de l'invitation | parent invité ; ses prochains jours de garde (même calcul que l'app) |
| Il ne manque que votre règle de garde (J1) | cron, compte âgé de 1 à 3 j | aucune règle de garde |
| Comment présenter Alternly à l'autre parent (J3) | cron, 3 à 7 j | foyer encore solo (placeholder ignoré) |
| Deux astuces… synchro + échanges (J7) | cron, 7 à 10 j | règle posée ; foyer gratuit → mention Premium douce |
| Rappel de vacances scolaires | cron, J-10 à J-6 avant le début de chaque période | foyer avec règle ; FR : zone officielle, US : congés saisis (rien si aucun) ; qui a les enfants, du … au …, passage de relais ; une fois par membre et par période |
| Relances d'invitation, nudge d'onboarding | cron `invite-reminders` | voir `services/invite_reminders.py` |
| Proposition / rappel d'échange | à la proposition / la veille de l'expiration | Premium |

Règles communes au cycle de vie (`backend/app/services/lifecycle.py`) :

- **Idempotence** : table `email_log (user_id, kind)` unique (`welcome`, `j1_rule`, `j3_invite`,
  `j7_value`, `holiday:<libellé>:<date de début>`), purgée à la suppression du compte.
- **Un e-mail « non sollicité » par jour et par personne** (fenêtre de 20 h) : `email_log`
  et relances de la boucle d'invitation (J+2/J+5, nudge). Une étape retardée part le lendemain
  (fenêtres d'âge), les rappels de vacances passent en premier.
- Jamais de placeholder ni de compte anonymisé (`*.invalid`).
- **Premium** : les rappels par e-mail sont une fonction Premium (comme les rappels d'échange).
  Foyer Premium → rappel avant chaque période ; foyer gratuit → **un seul** rappel « offert »
  (la première période après l'inscription), qui mentionne que Premium les envoie à chaque
  vacances. La séquence de bienvenue n'est pas soumise à Premium.
- **Désinscription** : chaque e-mail de cycle de vie a une version texte, un lien de
  désinscription en pied de page et les en-têtes `List-Unsubscribe` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Le lien
  `PUBLIC_SITE_URL/api/email/unsubscribe?token=<id>.<HMAC SECRET_KEY>` (GET : page de
  confirmation ; POST : un clic depuis le client mail) passe `email_opt_in` à faux, ce qui
  coupe aussi les e-mails d'échange. Réactivation dans les réglages. Changer `SECRET_KEY`
  invalide les anciens liens (ils affichent « Lien invalide »).
- Lien « Proposer un échange » : `/app?propose=AAAA-MM-JJ` ouvre la proposition sur ce jour.

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

**Configuration actuelle** : envoi depuis le domaine `hōnō.com` (`xn--hn-vrab.com`), déjà
vérifié dans le compte Resend (région eu-west-1), avec l'alias `alternly@…` et le nom
d'expéditeur « Alternly ». `RESEND_API_KEY` = une clé de ce compte. La procédure ci-dessous
ne sert que pour passer plus tard à un domaine `alternly.com` dédié.

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
- [ ] Secrets GitHub `CRON_URL` / `CRON_SECRET` posés, un *Run workflow* manuel réussi (3 jobs verts).
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

## Essai gratuit sur l'offre annuelle

L'essai se règle **dans Paddle**, sur le prix (pas dans le code) :
*Catalog → Products → Alternly Premium → prix annuel → Edit → Trial period : 7 days*.
Paddle collecte le moyen de paiement au début de l'essai et prélève 69 € à la fin, sauf
annulation. Dans l'heure (cache), l'app et la landing affichent « 7 jours d'essai gratuit »,
le bouton devient « Essayer 7 jours gratuitement ». Pendant l'essai, le webhook
`subscription.*` (statut `trialing`) enregistre la fin d'essai et donne accès à Premium.

## Offre de bienvenue (BIENVENUE20)

E-mail **unique** envoyé par le cron `lifecycle` (après la séquence d'accueil, au plus
un e-mail par jour) aux parents gratuits joignables :

- **intérêt pour Premium** : paywall vu (Dépenses / Mur en gratuit, bouton « Premium »,
  bouton Premium des réglages — pas le paywall de fin d'onboarding montré à tous)
  il y a **48 h** à 30 j, sans souscription ; jamais avant J+3 ;
- **filet de sécurité** : parent actif (règle de garde posée) à **J+10–14** qui n'a jamais
  vu le paywall.

Le lien `/app?offre=BIENVENUE20` ouvre le choix de l'offre avec le code appliqué au
checkout Paddle (offre annuelle). Exclus : abonnés, essais en cours, e-mails refusés.

**Dans Paddle** (*Catalog → Discounts → New discount*) : code `BIENVENUE20`, 20 %,
restreint au prix annuel, **non récurrent** (première année seulement), utilisable une
fois par client. La date « valable jusqu'au » de l'e-mail est indicative (le code Paddle
n'expire pas par personne).

## Suivi d'erreurs (PostHog Error Tracking)

Activé sur le projet PostHog (Error tracking). Ce qui remonte :

- **App (SPA)** : exceptions JS non gérées et promesses rejetées (`capture_exceptions`),
  plantages de rendu React (ErrorBoundary + `onUncaughtError` / `onRecoverableError`,
  avec la pile de composants). Un plantage affiche un écran « Recharger la page » au lieu
  d'une page blanche.
- **Site marketing** : exceptions JS (`static/analytics.js`).
- **API** : exceptions des requêtes (gestionnaire global FastAPI) et exceptions non gérées
  hors requête (tâches de fond, threads), sans variables locales.

Mêmes règles de consentement que le reste de la mesure (anonyme sans cookie tant que non
accepté). Tableau : https://eu.posthog.com/project/285303/error_tracking

**Traces lisibles (source maps)** — sur Vercel, ajouter `POSTHOG_SOURCEMAPS_API_KEY` =
clé personnelle PostHog avec les scopes *error tracking write* et *organization read*
(Settings → Personal API keys). Au build, `@posthog/rollup-plugin` envoie les source maps
puis les supprime de `dist/` (jamais servies). Sans la variable, rien ne change.

**Alertes** : PostHog notifie par Slack, Discord, Teams, webhook, GitHub ou Linear
(pas par e-mail) : Error tracking → Alerts → « Issue created » ou « Issue spiking ».
