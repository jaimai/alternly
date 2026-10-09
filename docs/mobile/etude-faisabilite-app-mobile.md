# Étude de faisabilité — app mobile Alternly (React Native + Expo)

> Objectif : proposer sur iOS et Android **les mêmes fonctionnalités que l'app web**, avec
> **les mêmes comptes** (un parent peut utiliser le web et le mobile indifféremment) et des
> **notifications push**.
>
> Maquettes de tous les écrans : canvas Claude Design « Alternly Mobile »
> (https://claude.ai/artifact/E1dwHut6j2aGCnQqtXVjrW).

## 1. Verdict

**Faisable sans refonte du backend.** L'API FastAPI est déjà une API REST JSON consommée par
un client séparé (le front Vite déployé sur Vercel appelle Railway via `VITE_API_URL`), et
l'authentification est un **JWT Bearer** (`backend/app/auth.py`) — pas de cookie de session.
Une app mobile n'est donc qu'un client de plus, qui appelle les mêmes routes `/api/*`
avec le même jeton.

Le travail backend se limite à des **ajouts** :

| Ajout backend | Pourquoi | Taille |
|---|---|---|
| Table `device_tokens` + `POST/DELETE /api/devices` | enregistrer le jeton push de chaque téléphone | S |
| Envoi push dans `deps.notify()` | chaque notification in-app existante part aussi en push | S |
| Préférences push par catégorie | écran « Préférences de notifications » | S |
| Cron « passation demain » | rappel push la veille d'un changement de parent (n'existe pas aujourd'hui) | S |
| `POST /api/auth/apple` | « Se connecter avec Apple », exigé par l'App Store dès qu'on propose Google | M |
| Plusieurs audiences Google acceptées | les client IDs iOS/Android diffèrent du client web | XS |
| Webhook RevenueCat → statut Premium | achats intégrés obligatoires sur mobile (voir §6) | M |
| `apple-app-site-association` + `assetlinks.json` | ouvrir `/join/<token>` et `/reset-password` dans l'app | XS |

## 2. Stack proposée

- **Expo** (SDK courant) + **Expo Router** (navigation par fichiers, proche de React Router),
  TypeScript, builds via **EAS Build / EAS Submit**, mises à jour JS via **EAS Update**.
- Monorepo : nouveau dossier `mobile/` à côté de `frontend/` et `backend/`.
- Code partagé avec le web (à extraire dans un petit paquet `shared/` ou copié au départ) :
  `types.ts`, `dates.ts`, `format.ts`, `colors.ts`, `custodyPreview.ts`, les traductions
  `locales/fr.json` / `en.json` (i18next fonctionne tel quel en React Native).
  `api.ts` se réutilise presque entièrement : seul le stockage du jeton change
  (`localStorage` → `expo-secure-store`) ainsi que la redirection sur 401.
- UI : composants React Native maison reprenant la charte (papier `#faf6ef`, sapin `#1f4d3f`,
  terracotta `#c96f4a`, Fraunces + Instrument Sans via `expo-font`).
- Calendrier : FullCalendar est web-only → grille mois/semaine maison (le moteur de garde
  est côté serveur, `/api/calendar` renvoie déjà les jours résolus) ou `react-native-calendars`.
- Observabilité : `@sentry/react-native`, `posthog-react-native` (mêmes projets que le web).

## 3. Identification — mêmes comptes web et mobile

| Méthode | Web aujourd'hui | Mobile |
|---|---|---|
| E-mail + mot de passe | `POST /api/auth/login` | identique |
| Inscription | `POST /api/auth/register` | identique |
| Google | Google Identity Services → `POST /api/auth/google` | `@react-native-google-signin/google-signin` → **même route**, en ajoutant les client IDs iOS/Android à l'audience vérifiée dans `services/google_auth.py` |
| Apple | — | `expo-apple-authentication` → nouvelle route `POST /api/auth/apple` (vérif. du JWT Apple, rattachement par e-mail comme pour Google) |
| Mot de passe oublié | e-mail avec lien `/reset-password?token=…` | même e-mail ; le lien (Universal Link / App Link) ouvre l'app si installée, sinon le web |
| Invitation 2ᵉ parent | `/join/<token>` | même lien, ouvert dans l'app ; écran d'aperçu identique |

Points d'attention :
- Le jeton (30 jours, `access_token_expire_minutes`) est stocké dans le trousseau
  (`expo-secure-store`). Option Face ID / empreinte (`expo-local-authentication`) pour
  déverrouiller l'app.
- « Déconnecter les autres appareils » (`/api/auth/logout-all`, `token_version`) révoque
  aussi les sessions mobiles : rien à changer.
- Un compte créé sur mobile est un compte web, et inversement.

## 4. Notifications

### Ce qui existe
`deps.notify(db, user_id, type, payload)` crée une ligne `notifications` lue par la cloche
in-app (`GET /api/notifications`, `POST /api/notifications/read`). Types déjà émis :
`exchange_proposed/accepted/refused/withdrawn`, `change_requested`, `change_accepted`, `change_refused`,
`exception_deleted`, `expense_added/updated/disputed/resolved/settled`,
`settlement_recorded`, `wall_post_added`, `wall_reply_added`, `wall_task_assigned`,
`parent_joined`, `parent_left`, `rule_changed`, `invite_reminder`.

### Ce qu'on ajoute
1. Modèle `DeviceToken(user_id, expo_token, platform, created_at, last_seen_at)`.
2. Routes `POST /api/devices` (à la connexion / au lancement) et `DELETE /api/devices/{token}`
   (à la déconnexion).
3. Dans `notify()`, après l'insert : si l'utilisateur a des appareils et que la catégorie est
   activée, envoi via l'**API Expo Push** (`https://exp.host/--/api/v2/push/send`) qui relaie
   vers APNs/FCM. Envoi après commit (tâche de fond FastAPI) pour ne pas ralentir la requête ;
   suppression des jetons `DeviceNotRegistered` renvoyés par les reçus.
4. Texte du push = mêmes libellés que la cloche (clés `common.notif*` des locales, dans la
   langue de l'utilisateur).
5. `data` du push = type + id → l'app ouvre directement le bon écran (échange, dépense, fil…).
6. **Rappels** : le cron `/api/cron/exchange-reminders` (échange en attente qui commence
   demain) envoie déjà un e-mail ; il enverra aussi un push. Le **rappel de passation la
   veille** est nouveau : un cron quotidien qui interroge le moteur (`/api/calendar`) pour
   le lendemain et prévient les deux parents en cas de changement de garde.
7. Notifications actionnables (Accepter / Refuser un échange depuis l'écran verrouillé) via
   les catégories de notification Expo — optionnel en V1.

### Préférences
Une ligne par catégorie (passation, échanges & demandes, dépenses, tableau, règles & foyer,
conseils) × canal (push, e-mail), cf. écran « Préférences de notifications ».
Le e-mail réutilise la logique existante de `email_prefs`.

## 5. Couverture fonctionnelle (web → mobile)

| Web (`frontend/src/pages`) | Écrans mobiles |
|---|---|
| Login, Register, ForgotPassword, ResetPassword | Bienvenue, Connexion, Inscription, Mot de passe oublié |
| Join | Invitation (lien profond) |
| Onboarding + RuleWizard | Foyer, Rythme, Vacances, Notifications, Inviter |
| Calendar (+ StatusCard, ExceptionDialog, ChangeRequests) | Aujourd'hui, Calendrier mois, Détail du jour, Proposer / Répondre à un échange, Demandes |
| NotificationBell | Centre de notifications, push, widgets |
| Wall (Premium) | Tableau, Fil, Nouveau message |
| Expenses (Premium) | Dépenses, Nouvelle dépense, Détail/contestation, Remboursement |
| Settings | Réglages, Règles, Enfants & parents, Préférences notifs, Abonnement |
| History | Historique |
| Feedback | lien « Aide & retour » dans Réglages (formulaire natif) |

Ajouts propres au mobile (optionnels, non bloquants) : widgets écran d'accueil / écran
verrouillé, Face ID, photo du justificatif de dépense (nécessiterait un stockage de
fichiers côté backend, absent aujourd'hui).

## 6. Paiement Premium — le point qui change le plus

Les règles Apple (et Google Play) imposent l'**achat intégré** pour débloquer une
fonctionnalité numérique dans l'app : on ne peut pas ouvrir le checkout Paddle depuis l'app.

Proposition :
- **RevenueCat** (`react-native-purchases`) pour gérer StoreKit / Play Billing.
- Webhook RevenueCat → backend qui met à jour le **même statut d'abonnement** que Paddle
  (`services/billing.py`, `has_access`). Le Premium reste attaché au foyer : un parent abonné
  sur le web ou sur mobile débloque l'autre.
- Un abonné web voit son Premium reconnu dans l'app (bouton « Restaurer » pour les achats
  store). Pas de lien vers le paiement web dans l'app iOS.
- Commission store : 15 % (programme Small Business) à intégrer au prix mobile.

## 7. Plan de livraison indicatif

Estimations grossières pour un développeur, à affiner après un spike.

| Phase | Contenu | Durée indicative |
|---|---|---|
| 0. Spike | projet Expo, login e-mail, appel `/api/calendar`, 1er build TestFlight | 1 semaine |
| 1. Socle | auth complète (e-mail, Google, Apple), onboarding, calendrier, échanges, notifs in-app | 3–4 semaines |
| 2. Push | `device_tokens`, envoi dans `notify()`, préférences, rappel de passation, liens profonds | 1–2 semaines |
| 3. Premium | tableau, dépenses, achats intégrés + webhook | 3 semaines |
| 4. Finitions | réglages, historique, widgets, accessibilité, fiches stores, revue Apple | 2 semaines |

Prérequis : compte Apple Developer (99 $/an), compte Google Play Console (25 $ une fois),
politique de confidentialité à jour (push, identifiants d'appareil), fiches store FR/EN.

## 8. Risques

- **Revue App Store** : Apple Sign-In obligatoire, achats intégrés obligatoires, compte de
  démo à fournir aux reviewers.
- **Calendrier** : refaire la vue mois en natif demande du soin (performances, accessibilité),
  mais la logique reste côté serveur.
- **Double statut d'abonnement** (Paddle + stores) : à bien tester (annulation, essai,
  remboursement, changement de plan).
- **Widgets** : nécessitent du code natif (WidgetKit / Glance) via un config plugin Expo ;
  à garder pour après la V1.
