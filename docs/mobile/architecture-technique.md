# App mobile — architecture technique et mise en place

> Complète [`etude-faisabilite-app-mobile.md`](etude-faisabilite-app-mobile.md) (le *quoi*)
> avec le *comment* : organisation du monorepo, pipelines isolés, code de l'app,
> ajouts backend, liens profonds, secrets et checklist de démarrage.

## 1. Décision : un seul dépôt (monorepo)

Le mobile va dans **ce dépôt**, à côté du web et du backend.

**Pour** :
- l'API et ses deux clients changent souvent ensemble (nouvelle route + écran web +
  écran mobile) : un seul commit, une seule PR, une seule revue ;
- les types, les dates, les couleurs et les traductions sont partagés sans publier de paquet ;
- un seul historique, une seule CI, une seule doc d'exploitation.

**Contre** (et réponse) :
- *chaque push déclenche tous les déploiements* → **filtres de chemins** sur chaque
  pipeline (§3). C'est le point qui demande le plus d'attention.
- *un dépôt plus lourd à cloner* → négligeable ici (quelques Mo, hors `node_modules`).

## 2. Arborescence cible

```
alternly/
├── backend/            FastAPI (Railway)              — inchangé
├── content/            articles du blog (Railway)     — inchangé
├── frontend/           SPA React/Vite (Vercel)        — inchangé
├── mobile/             app Expo (EAS)                 — NOUVEAU
│   ├── app/            routes Expo Router (1 fichier = 1 écran)
│   ├── src/            api, auth, composants, thème, hooks
│   ├── assets/         icône, splash, polices
│   ├── app.config.ts   config Expo (bundle id, liens profonds, plugins)
│   ├── eas.json        profils de build (development / preview / production)
│   └── package.json    dépendances propres + package-lock.json propre
├── packages/shared/    code TS partagé web + mobile   — phase 2 (§5)
├── docs/mobile/        cette doc
├── Dockerfile, railway.json                            — backend
└── .github/workflows/  ci.yml, mobile.yml, cron.yml…
```

## 3. Pipelines isolés : qui se redéploie quand

Objectif : **un push dans `mobile/` ne redéploie ni le front ni le back**, et un push
dans `frontend/` ou `backend/` ne relance pas de build mobile.

| Fichiers modifiés | Railway (API) | Vercel (web) | CI backend | CI frontend | CI + EAS mobile |
|---|:-:|:-:|:-:|:-:|:-:|
| `backend/**`, `content/**`, `Dockerfile`, `railway.json` | ✅ | — | ✅ | — | — |
| `frontend/**` | — | ✅ | — | ✅ | — |
| `mobile/**` | — | — | — | — | ✅ |
| `packages/shared/**` (phase 2) | — | ✅ | — | ✅ | ✅ |
| `docs/**`, `*.md` | — | — | — | — | — |

Les filtres Railway, Vercel et CI sont en place, y compris le job CI `mobile`
(types, lint, tests, bundle natif). Le workflow `mobile.yml` (EAS) viendra avec le
premier build.

### 3.1 Railway — `watchPatterns`

Dans `railway.json` (config-as-code, chemins depuis la racine du dépôt) :

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile",
    "watchPatterns": [
      "/backend/**",
      "/content/**",
      "/Dockerfile",
      "/.dockerignore",
      "/railway.json"
    ]
  },
  "deploy": { "…": "inchangé" }
}
```

Un push qui ne touche aucun de ces chemins est ignoré par Railway. Un redéploiement
manuel reste possible depuis le tableau de bord.

Ajouter aussi `mobile` et `packages` à `.dockerignore` (le Dockerfile ne copie que
`backend/` et `content/`, mais cela allège le contexte de build envoyé à Docker).

### 3.2 Vercel — « Ignored Build Step »

Le projet Vercel a `frontend/` pour racine. Dans `frontend/vercel.json` :

```json
"ignoreCommand": "bash scripts/vercel-ignore.sh"
```

`frontend/scripts/vercel-ignore.sh` :

```bash
#!/usr/bin/env bash
# Vercel : code de sortie 0 = NE PAS construire, 1 = construire.
# On compare au dernier déploiement réussi (pas seulement au commit précédent :
# un push peut contenir plusieurs commits).
set -u
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
# Pas de référence ou commit absent du clone superficiel → on construit, par prudence.
[ -z "$base" ] && exit 1
git cat-file -e "$base^{commit}" 2>/dev/null || exit 1
# Rien de changé dans frontend/ (ni dans le code partagé) → on saute le build.
git diff --quiet "$base" HEAD -- . ../packages/shared && exit 0
exit 1
```

En cas de doute, le script **construit** (sortie 1) : on préfère un déploiement de trop à
un web pas à jour.

### 3.3 GitHub Actions — CI filtrée par chemins

`ci.yml` garde un seul workflow, avec un job `changes` qui décide quels jobs tournent
(`dorny/paths-filter`). Un job sauté compte comme réussi pour les *required checks*, ce
qui n'est pas le cas d'un workflow entier filtré par `on.paths` : c'est pour cela qu'on
filtre au niveau des jobs.

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.f.outputs.backend }}
      frontend: ${{ steps.f.outputs.frontend }}
      mobile: ${{ steps.f.outputs.mobile }}
    steps:
      - uses: actions/checkout@v4
      - id: f
        uses: dorny/paths-filter@v3
        with:
          filters: |
            backend:
              - 'backend/**'
              - 'content/**'
              - 'Dockerfile'
              - 'railway.json'
            frontend:
              - 'frontend/**'
              - 'packages/shared/**'
            mobile:
              - 'mobile/**'
              - 'packages/shared/**'

  backend:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    # … job actuel inchangé

  frontend:
    needs: changes
    if: needs.changes.outputs.frontend == 'true'
    # … job actuel inchangé

  mobile:
    needs: changes
    if: needs.changes.outputs.mobile == 'true'
    defaults: { run: { working-directory: mobile } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: mobile/package-lock.json }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test -- --ci
      - run: npx expo-doctor
```

`cron.yml` et `email-check.yml` sont déclenchés par horaire ou à la main : rien à changer.

### 3.4 Pipeline mobile (EAS)

Nouveau `.github/workflows/mobile.yml`, qui ne regarde que `mobile/**` et
`packages/shared/**` :

| Déclencheur | Action | Effet |
|---|---|---|
| PR touchant `mobile/` | `eas update --branch pr-<n>` | aperçu testable dans Expo Go / le build de dev (QR code en commentaire) |
| push sur `main` touchant `mobile/` | `eas update --branch preview` | les testeurs internes reçoivent la mise à jour |
| tag `mobile-v*` (ex. `mobile-v1.2.0`) | `eas build --profile production --platform all --auto-submit` | build signé envoyé sur TestFlight + Play (piste interne) |
| manuel (`workflow_dispatch`) | `eas update --branch production` | correctif JS en production, sans repasser par les stores |

Règles :
- **Aucune mise en production automatique** de l'app : la publication passe par un tag
  explicite, puis par la validation dans App Store Connect / Play Console.
- `runtimeVersion: { policy: "fingerprint" }` dans `app.config.ts` : une mise à jour OTA
  n'est servie qu'aux builds dont le code natif est identique. Dès qu'on ajoute un module
  natif, il faut un nouveau build (tag), et l'OTA ne casse rien.
- Le backend se déploie **avant** la version mobile qui utilise une nouvelle route.

## 4. Compatibilité API : la vraie contrainte du mobile

Le web se met à jour pour tout le monde à chaque déploiement ; **l'app mobile non** :
des parents garderont une ancienne version des semaines. Le backend doit donc rester
compatible avec les versions mobiles encore installées.

- Changements **additifs** uniquement : nouveaux champs, nouvelles routes. Ne jamais
  renommer ni supprimer un champ utilisé par le mobile sans période de transition.
- L'app envoie `X-App-Version` et `X-App-Platform` sur chaque requête (utile en logs et
  dans Sentry).
- Nouvelle route publique `GET /api/app/config` →
  `{ "min_version": "1.0.0", "latest_version": "1.3.0" }`. En dessous de `min_version`,
  l'app affiche un écran « Mettez à jour Alternly » avec le lien store. C'est la soupape
  de sécurité si une évolution incompatible devient inévitable.
- Les tests backend (`backend/tests`) couvrent déjà les routes : ajouter un test de
  « contrat » sur les champs consommés par le mobile pour les routes clés
  (`/auth/me`, `/calendar`, `/notifications`).

## 5. Code partagé web ↔ mobile

**Phase 1 (démarrage)** : `mobile/` est autonome, avec son `package.json` et son lockfile.
On copie les quelques fichiers purs (sans DOM) dont il a besoin : `types.ts`, `dates.ts`,
`format.ts`, `colors.ts`, `custodyPreview.ts`, et les locales `fr.json` / `en.json`.
Aucun impact sur le build Vercel.

**Phase 2 (quand le mobile est stable)** : on extrait ces fichiers dans
`packages/shared/` et on passe la racine en *npm workspaces*
(`"workspaces": ["frontend", "mobile", "packages/*"]`, un seul `package-lock.json` à la
racine). Expo gère les workspaces nativement (Metro détecte le monorepo). Côté Vercel :
commande d'installation `cd .. && npm ci`, et le filtre du §3.2 surveille déjà
`packages/shared`. À faire dans une PR dédiée, testée sur un déploiement de preview.

## 6. L'app : structure du code

```
mobile/app/
├── _layout.tsx               providers (auth, i18n, React Query), polices, splash
├── (auth)/                   écrans publics
│   ├── welcome.tsx  login.tsx  register.tsx  forgot-password.tsx  reset-password.tsx
├── join/[token].tsx          invitation (ouverte par lien profond)
├── onboarding/               foyer, rythme, vacances, notifications, invitation
├── (tabs)/_layout.tsx        barre d'onglets
│   ├── index.tsx             Aujourd'hui
│   ├── calendar.tsx          mois + détail du jour (bottom sheet)
│   ├── wall/index.tsx  wall/[id].tsx
│   ├── expenses/index.tsx  expenses/[id].tsx
│   └── settings/…            règles, enfants, notifications, abonnement, historique
├── exchange/new.tsx  exchange/[id].tsx
└── notifications.tsx
```

Briques :

| Besoin | Choix |
|---|---|
| Requêtes, cache, hors ligne | `@tanstack/react-query` + persistance (dernier calendrier lisible sans réseau) |
| Client API | reprise de `frontend/src/api.ts` ; base `EXPO_PUBLIC_API_URL` |
| Jeton JWT | `expo-secure-store` (trousseau iOS / Keystore Android), jamais AsyncStorage |
| Face ID / empreinte | `expo-local-authentication` |
| Google | `@react-native-google-signin/google-signin` → `POST /api/auth/google` |
| Apple | `expo-apple-authentication` → `POST /api/auth/apple` (nouveau) |
| Push | `expo-notifications` (+ `expo-device`) |
| Liens profonds | Expo Router (Universal Links / App Links) |
| Achats intégrés | `react-native-purchases` (RevenueCat) |
| i18n | `i18next` + `react-i18next` + `expo-localization` |
| Erreurs / analytics | `@sentry/react-native`, `posthog-react-native` |
| Tests | Jest (`jest-expo`) + React Native Testing Library ; Maestro pour 3–4 parcours de bout en bout |

Profils `eas.json` : `development` (client de dev, API locale ou staging), `preview`
(distribution interne, API staging), `production` (stores, API prod). L'URL d'API est
fixée par profil via `EXPO_PUBLIC_API_URL`.

## 7. Ajouts backend

### 7.1 Notifications push (en place)

- **Appareils** : table `device_tokens` (jeton Expo unique, plateforme, version de l'app).
  `POST /api/devices` inscrit le téléphone (un jeton déjà connu est rattaché au compte
  courant : téléphone passé sur un autre compte), `DELETE /api/devices/{token}` à la
  déconnexion de l'app. `logout-all` et la suppression de compte effacent les appareils.
- **Envoi** (`services/push.py`) : `deps.notify()` crée la notification in-app comme avant
  et prépare le push (destinataire, préférences, texte dans sa langue, mêmes libellés que la
  cloche du web). Les messages attendent le **commit** de la session (événements
  SQLAlchemy `after_commit` / `after_rollback`) : jamais de push pour une action annulée,
  et aucune des ~25 routes qui appellent `notify()` n'a changé. L'envoi part dans un fil à
  part (pas de latence ajoutée), par lots de 100 vers le service Expo ; les jetons
  `DeviceNotRegistered` sont supprimés. Une panne d'Expo n'affecte jamais la requête.
- **Données du push** : `type`, et `id` / `date_start` selon le cas : l'app ouvre la
  réponse à l'échange, ou la zone concernée.
- **Préférences** : `GET/PUT /api/devices/prefs`, cinq catégories (passation, échanges et
  demandes, dépenses, tableau, foyer), colonne JSON `users.push_prefs` (vide = tout activé).
- **Rappel de passation** : `POST /api/cron/handover-reminders`, lancé chaque soir à
  17:07 UTC par `.github/workflows/push-reminders.yml`. Si le parent change le lendemain,
  chaque parent reçoit « Demain, Léa et Hugo arrivent chez vous / partent chez Julie
  (vers 18:00) » (heure seulement si le changement vient du rythme habituel). Push seul ;
  idempotent via `email_log` (`push:handover:<date>`).
- `PUSH_API_URL` (défaut : service Expo) permet de viser un faux service en recette.
- **Tous les push sont gratuits** pour l'instant (comme les notifications in-app) ; les
  rappels par e-mail restent Premium. À trancher si le rappel de passation doit devenir
  un avantage Premium.

### 7.2 Connexion

- `GOOGLE_CLIENT_ID` accepte une **liste** séparée par des virgules (web, iOS, Android) ;
  `services/google_auth.py` passe cette liste comme `audience`.
- `POST /api/auth/apple` : vérifie le jeton d'identité Apple (JWKS
  `https://appleid.apple.com/auth/keys`, audience = bundle id), puis même logique de
  rattachement / création que Google. Apple peut masquer l'e-mail (relais
  `privaterelay.appleid.com`) : le rattachement se fait alors sur le `sub` Apple (nouvelle
  colonne `apple_sub`).
- `DELETE /api/auth/me` existe déjà : Apple exige la suppression de compte depuis l'app,
  il suffit de l'exposer dans Réglages.

### 7.3 Abonnement : Paddle (web) + RevenueCat (mobile), un seul Premium

**Objectif** : un parent qui paie sur l'iPhone est Premium sur le web, un abonné Paddle est
Premium dans l'app, et une résiliation d'un côté coupe l'accès des deux côtés (à la fin de la
période payée). C'est faisable, et c'est le fonctionnement attendu par les utilisateurs.

**Principe : le backend reste la seule source de vérité.** Le web et l'app ne décident jamais
eux-mêmes de l'accès : ils lisent `GET /api/billing/status`, et les routes Premium sont
protégées côté serveur (`require_premium`). Aujourd'hui `user_has_premium` (`deps.py`)
calcule déjà l'accès par foyer (« un payeur suffit ») à partir des champs Paddle de `User`.
Il suffit d'y ajouter une seconde source.

```
App Store / Play ──► RevenueCat ──webhook──► backend ◄──webhook── Paddle (web)
                                               │
                         Premium = Paddle actif OU store actif (par foyer)
                                               │
                              web et app lisent /api/billing/status
```

**Modèle de données** : ne pas réutiliser les colonnes Paddle (`subscription_status`,
`subscription_ends_at`) pour les achats store, sinon un événement Paddle « canceled »
écraserait un abonnement Apple actif, et inversement. Nouvelle table :

| Colonne | Contenu |
|---|---|
| `user_id` | payeur |
| `source` | `app_store` \| `play_store` (et plus tard `paddle` si on y migre les colonnes actuelles) |
| `status` | `active` \| `trialing` \| `grace` \| `canceled` \| `expired` |
| `ends_at` | fin de la période payée (accès conservé jusque-là après résiliation) |
| `product_id`, `external_id` | produit et identifiant de transaction RevenueCat |
| `updated_at` | ordre des événements (ignorer un webhook plus ancien que l'état connu) |

`has_access()` est appelée pour chaque source ; le foyer est Premium si **au moins une**
source d'un de ses parents donne accès.

**Rattacher l'achat au bon compte** : dans l'app, `Purchases.logIn(String(user.id))` juste
après la connexion. L'`app_user_id` RevenueCat est alors l'id Alternly, et le webhook sait à
qui attribuer l'achat. À la déconnexion, `Purchases.logOut()`.

**Webhook** `POST /api/billing/revenuecat-webhook` (en-tête `Authorization` partagé,
comparaison à temps constant, idempotent sur l'id d'événement comme `paddle_events`) :

| Événement RevenueCat | Effet |
|---|---|
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE` | `active`, `ends_at` = fin de période |
| `CANCELLATION` (résiliation simple) | `canceled`, accès jusqu'à `ends_at` |
| `CANCELLATION` pour remboursement | `expired` immédiatement |
| `BILLING_ISSUE` | `grace` (accès conservé pendant la période de grâce du store) |
| `EXPIRATION` | `expired` : plus d'accès |

En complément, une resynchronisation à la demande (API REST RevenueCat, abonné par
`app_user_id`) au lancement de l'app et sur « Restaurer les achats » rattrape un webhook perdu.

**Éviter le double abonnement** (le vrai risque de ce montage) :
- Dans l'app : si le foyer est déjà Premium (quelle que soit la source), pas de paywall ;
  si la source est Paddle, afficher « Abonnement géré sur alternly.com ».
- Sur le web : si la source est un store, pas de checkout Paddle ; afficher « Abonnement
  géré dans l'App Store / Google Play » avec la marche à suivre pour résilier.
- `GET /api/billing/status` renvoie donc `source` et `manage_url` (portail Paddle, ou page
  d'abonnements Apple / Google).
- Un abonnement Apple ne se résilie pas depuis le web (et inversement) : chaque canal gère le
  sien, le backend ne fait qu'agréger.

**Option : RevenueCat comme tableau de bord unique.** RevenueCat sait importer les achats
faits avec notre propre checkout Paddle (intégration Paddle de RevenueCat, en passant
l'`app_user_id` dans les `custom_data` Paddle). Intérêt : revenus web et mobile dans les mêmes
graphiques, et entitlements lisibles directement dans le SDK de l'app. Pas nécessaire pour
l'accès (le backend agrège déjà tout) : à décider selon le besoin d'analyse.

**Règles des stores** : dans l'app iOS, ne pas renvoyer vers le paiement web (les exceptions
dépendent du pays et évoluent : à vérifier au moment de la soumission). Le bouton
« Restaurer les achats » est obligatoire.

**Tests à prévoir** : achat store puis lecture web ; résiliation store → accès jusqu'à
`ends_at` puis coupure sur le web ; remboursement Apple → coupure immédiate ; foyer avec un
parent Paddle et l'autre store ; webhook rejoué ou arrivé dans le désordre ; résiliation
Paddle alors qu'un abonnement store est actif (l'accès doit rester).

### 7.4 Liens profonds

Le domaine `alternly.com` est servi par Vercel : les deux fichiers vont dans
`frontend/public/.well-known/` (déploiement web, une seule fois) :
- `apple-app-site-association` (sans extension, servi en `application/json` : ajouter
  l'en-tête dans `frontend/vercel.json`) pour les chemins `/join/*` et `/reset-password*` ;
- `assetlinks.json` (empreinte SHA-256 du certificat de signature Android).

Les e-mails et liens d'invitation ne changent pas : ils ouvrent l'app si elle est
installée, le web sinon.

## 8. Secrets et comptes

| Où | Quoi |
|---|---|
| GitHub (secret de dépôt) | `EXPO_TOKEN` (compte Expo, pour EAS dans les Actions) |
| EAS (gérés par Expo) | certificats et profils iOS, keystore Android, clé API App Store Connect, compte de service Google Play |
| EAS (variables par profil) | `EXPO_PUBLIC_API_URL`, IDs Google iOS/Android, clé publique RevenueCat, DSN Sentry, clé PostHog |
| Railway | `GOOGLE_CLIENT_ID` (liste), `APPLE_BUNDLE_ID`, `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY` (resynchronisation), `EXPO_ACCESS_TOKEN` (optionnel, renforce l'envoi push) |
| Comptes | Apple Developer (99 $/an), Google Play Console (25 $), Expo (gratuit au départ), RevenueCat (gratuit jusqu'à un seuil de revenus) |

## 9. Conventions de travail

- Commits préfixés par la zone : `feat(mobile): …`, `fix(api): …`, `feat(web): …`.
- Une PR qui ajoute une route **et** son écran mobile est bienvenue (c'est l'intérêt du
  monorepo), mais le backend part en production dès le merge, alors que l'app suit
  plus tard (tag) : la route doit donc fonctionner seule.
- Versions de l'app : `mobile/package.json` + tag `mobile-vX.Y.Z` ; le numéro de build
  est incrémenté par EAS (`autoIncrement`).

## 10. Checklist de démarrage

1. [x] PR « isolation des pipelines » : `watchPatterns` Railway, `ignoreCommand` Vercel,
       `ci.yml` filtré, `.dockerignore`. La merger **avant** tout code mobile, puis
       vérifier sur un commit qui ne touche que `docs/` que ni Railway ni Vercel ne
       redéploient.
2. [ ] Comptes Apple Developer, Google Play, Expo ; `EXPO_TOKEN` dans GitHub.
3. [x] `npx create-expo-app mobile` (template TypeScript + Expo Router), `eas init`,
       `eas.json`, premier build `development`.
4. [ ] Écran de connexion e-mail branché sur l'API de staging → premier build TestFlight
       (fin du spike).
5. [x] Backend : `device_tokens` + push. [ ] Google multi-audience, Apple Sign-In,
       `/api/app/config`.
6. [ ] `.github/workflows/mobile.yml` (aperçus de PR, `preview`, tags de release).
7. [ ] Liens profonds (`.well-known/*`), puis RevenueCat + webhook.
