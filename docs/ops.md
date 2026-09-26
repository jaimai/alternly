# Runbook d'exploitation Alternly

Architecture de production :

| Composant | Hébergeur | Contenu |
|---|---|---|
| API + site marketing SSR | Railway (service Docker, `Dockerfile` + `railway.json`) | `/api/*`, `/`, `/blog`, pages légales, sitemap |
| Base de données | Railway PostgreSQL | toutes les données applicatives |
| SPA React | Vercel (`frontend/`) | servie sur `APP_URL`, appelle l'API en CORS |
| E-mails | Resend | reset de mot de passe, propositions et rappels d'échange |
| Erreurs | Sentry (optionnel) | exceptions backend, expurgées |
| Cron | GitHub Actions (`.github/workflows/cron.yml`) | rappels d'échange quotidiens |

Le backend tourne avec **un seul worker uvicorn** : la limitation de débit
(`backend/app/ratelimit.py`) est en mémoire du processus. Passer à plusieurs
workers/réplicas impose d'abord de la déplacer vers Redis.

## Variables d'environnement

Toutes lues par `backend/app/config.py` (insensibles à la casse).

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./coparent.db` | Fournie par Railway (`${{Postgres.DATABASE_URL}}`). `postgres://` accepté. |
| `SECRET_KEY` | — | Signature JWT. **Obligatoire** hors SQLite, ≥ 32 caractères (`python -c "import secrets;print(secrets.token_urlsafe(48))"`). La changer déconnecte tout le monde. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `43200` (30 j) | Durée de vie des jetons. |
| `APP_URL` | `http://localhost:5173` | URL publique de la SPA (liens d'e-mail, d'invitation, de reset, CTAs). |
| `CORS_ORIGINS` | `http://localhost:5173` | Origines autorisées, séparées par des virgules (= domaine(s) Vercel). |
| `SITE_URL` | vide | URL canonique du site marketing (sitemap, robots, canonical). |
| `CONTACT_EMAIL` | `contact@alternly.com` | Adresse affichée dans le pied de page et les pages légales. |
| `RESEND_API_KEY` | vide | Vide → aucun e-mail envoyé (no-op journalisé). |
| `EMAIL_FROM` | `Alternly <no-reply@alternly.com>` | Expéditeur ; domaine vérifié chez Resend. |
| `CRON_SECRET` | vide | Protège `POST /api/cron/exchange-reminders` (en-tête `X-Cron-Key`). Vide → endpoint désactivé (403). |
| `RATE_LIMIT_ENABLED` | `true` | Coupe la limitation de débit (à ne faire qu'en cas d'incident). |
| `SENTRY_DSN` | vide | Active Sentry si renseigné. |
| `SENTRY_ENVIRONMENT` | `production` | `staging`, `production`… |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.0` | Échantillonnage des traces de performance (0 → désactivé). |
| `PORT` | fourni par Railway | Port d'écoute uvicorn. |

Côté Vercel (frontend, préfixe `VITE_`, lues au build) : `VITE_API_URL` (URL de l'API
Railway), `VITE_SITE_URL` (site marketing), `VITE_SENTRY_DSN` / `VITE_SENTRY_ENVIRONMENT`
(optionnels). Voir le code de `frontend/` pour la liste à jour.

## Railway

1. **Région** : créer le projet (service + Postgres) dans une région **UE**
   (ex. `europe-west4` / Amsterdam). Vérifier ensuite *Settings → Region* des deux
   services : c'est ce qui justifie la mention « Données hébergées en Union
   européenne » du site (TODO dans `landing.html` / `base.html`) et les
   placeholders `[RÉGION RAILWAY …]` des pages légales.
2. **Service API** : déploiement depuis le dépôt, builder Dockerfile (`railway.json`),
   healthcheck `/api/health` (vérifie la base). Renseigner les variables ci-dessus.
3. **Postgres — sauvegardes** : onglet *Backups* du service Postgres → activer les
   sauvegardes planifiées (quotidiennes, rétention **30 jours max**, cohérent avec la
   politique de confidentialité). Si le plan le permet, activer le
   **Point-in-Time Recovery**.
4. **Domaines** : domaine personnalisé pour l'API/site (ex. `alternly.com`), puis
   `SITE_URL` et `CORS_ORIGINS` en conséquence.

### Test de restauration (mensuel)

Une sauvegarde non testée n'est pas une sauvegarde. Chaque mois :

```bash
# 1. Dump de la prod (URL publique du Postgres Railway, onglet Connect)
pg_dump --format=custom --no-owner --no-acl "$PROD_DATABASE_URL" -f alternly-$(date +%F).dump

# 2. Restauration dans une base jetable (Postgres local ou service Railway temporaire)
createdb alternly_restore_test            # ou : docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=x postgres:16
pg_restore --no-owner --no-acl --clean --if-exists \
  --dbname "postgresql://localhost/alternly_restore_test" alternly-$(date +%F).dump

# 3. Contrôles de cohérence
psql "postgresql://localhost/alternly_restore_test" -c "select count(*) from users;" \
  -c "select count(*) from households;" -c "select max(created_at) from expenses;"

# 4. Démarrer l'API sur la copie et vérifier /api/health + une connexion de test
DATABASE_URL=postgresql://localhost/alternly_restore_test SECRET_KEY=<clé ≥ 32 car.> \
  uvicorn app.main:app --port 8001

# 5. Supprimer la copie et le dump (données personnelles !)
dropdb alternly_restore_test && shred -u alternly-*.dump
```

Tester aussi une fois par trimestre la restauration d'une sauvegarde Railway
(*Backups → Restore*) vers un nouveau service. Noter date, durée et résultat.

## Cron (GitHub Actions)

`.github/workflows/cron.yml` appelle chaque jour à 06:07 UTC l'endpoint des rappels
d'échange ; le job échoue si la réponse n'est pas 2xx (notification GitHub).

Secrets du dépôt (*Settings → Secrets and variables → Actions*) :

- `CRON_URL` = `https://<domaine-api>/api/cron/exchange-reminders`
- `CRON_SECRET` = même valeur que `CRON_SECRET` sur Railway

Déclenchement manuel : onglet *Actions → Cron → Run workflow*. Attention : GitHub
désactive les workflows planifiés après 60 jours sans activité sur le dépôt.

## Sentry

1. Créer un projet Python/FastAPI (région **UE** : `*.ingest.de.sentry.io`).
2. Renseigner `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, éventuellement `SENTRY_TRACES_SAMPLE_RATE=0.1`.
3. `send_default_pii=False` et un `before_send` (`backend/app/main.py`) retirent corps
   de requête, cookies, query string, en-têtes `Authorization` / `X-Cron-Key` et jetons
   présents dans les URL (iCal, invitations).
4. Dans Sentry : *Settings → Security & Privacy* → activer « Data Scrubber » et
   « Prevent Storing of IP Addresses ».
5. Mettre à jour la ligne Sentry de `/confidentialite` (placeholder `[si activé]`).

## Resend — domaine d'envoi

Dans Resend : *Domains → Add domain* (ex. `alternly.com` ou sous-domaine `mail.alternly.com`),
puis ajouter chez le registrar DNS les enregistrements **exactement tels qu'affichés** :

| Type | Nom | Valeur (exemple) | Rôle |
|---|---|---|---|
| TXT | `send` (ou `send.mail`) | `v=spf1 include:amazonses.com ~all` | SPF du domaine de retour (MAIL FROM) |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (prio 10) | retours / bounces |
| TXT | `resend._domainkey` | `p=MIGfMA0GCS…` (clé fournie) | DKIM |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@alternly.com` | DMARC en observation |

Choisir la région **EU (eu-west-1)** pour le domaine si proposée. Attendre le statut
*Verified*, puis `EMAIL_FROM=Alternly <no-reply@alternly.com>` et `RESEND_API_KEY`.
Après quelques semaines de rapports DMARC propres, passer à `p=quarantine`.

Vérifier : « Mot de passe oublié » sur un compte de test → e-mail reçu, non classé
spam, lien `APP_URL/reset-password?token=…` fonctionnel.

## Checklist de déploiement

Avant la mise en production / une release importante :

- [ ] CI verte sur `main` (tests backend, lint + build frontend).
- [ ] Variables Railway à jour (`SECRET_KEY` forte, `APP_URL`, `CORS_ORIGINS`, `SITE_URL`,
      `RESEND_API_KEY`, `CRON_SECRET`, `SENTRY_DSN`, `CONTACT_EMAIL`).
- [ ] Région UE vérifiée (Railway API + Postgres, Vercel) ; sinon retirer la mention
      « hébergées en UE » du site.
- [ ] Sauvegardes Postgres actives, dernier test de restauration < 1 mois.
- [ ] Pages légales : placeholders `[…]` remplacés (éditeur, SIRET, directeur de
      publication, régions, médiateur, TVA) — `grep -rn "class=\"todo\"" backend/app/templates`.
- [ ] Domaine Resend vérifié (SPF, DKIM, DMARC).
- [ ] Secrets GitHub `CRON_URL` / `CRON_SECRET` posés, un *Run workflow* manuel réussi.
- [ ] Les migrations (`backend/app/migrations.py`) s'exécutent au démarrage : vérifier
      les logs du premier boot, puis `/api/health` = `{"status": "ok"}`.
- [ ] Smoke test : inscription, connexion, création de foyer, invitation, export des
      données, mot de passe oublié.

## Incidents — bases

1. **Constater** : `/api/health` (503 = base injoignable), logs Railway
   (*Deployments → View logs*), Sentry, statut des fournisseurs
   (status.railway.com, vercel-status.com, resend-status.com).
2. **Stabiliser** : *Redeploy* du dernier déploiement sain dans Railway (rollback en
   un clic). Côté Vercel : *Promote to Production* d'un déploiement précédent.
3. **Abus / attaque par force brute** : la limitation de débit renvoie des 429.
   Si un compte est compromis : réinitialiser son mot de passe (révoque toutes ses
   sessions). En dernier recours, changer `SECRET_KEY` déconnecte **tous** les
   utilisateurs.
4. **Fuite de secret** : régénérer immédiatement la clé concernée (Resend, Sentry,
   `CRON_SECRET` des deux côtés, `SECRET_KEY`).
5. **Violation de données personnelles** : documenter (quoi, quand, combien de
   personnes), notifier la **CNIL sous 72 h** (notifications.cnil.fr) si risque pour
   les personnes, et informer les utilisateurs concernés si risque élevé.
6. **Après coup** : courte note post-mortem (cause, impact, correctifs).
