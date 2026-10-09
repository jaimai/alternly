# Alternly — app mobile (Expo)

App iOS / Android d'Alternly. Même API et mêmes comptes que le web : elle appelle
`/api/*` avec le jeton JWT de l'utilisateur, stocké dans le trousseau
(`expo-secure-store`). Contexte et choix : [`docs/mobile/`](../docs/mobile/).

## Démarrer

```bash
cd mobile
npm install
cp .env.example .env.local   # optionnel : par défaut, l'API de production
npx expo start               # puis scanner le QR code avec Expo Go
```

Pour viser un backend local : `EXPO_PUBLIC_API_URL=http://<IP-de-votre-machine>:8000/api`
(pas `localhost` : le téléphone ne voit pas la machine sous ce nom).

Ajouter une dépendance : `npx expo install <paquet>` (versions compatibles avec le SDK).

## Notifications push

Le backend envoie un push pour chaque notification in-app, plus un rappel la veille des
passations. Pour en recevoir sur un téléphone :

1. `npx eas-cli@latest init` une fois : écrit `extra.eas.projectId` dans `app.json`
   (requis pour obtenir le jeton Expo ; sans lui, l'app fonctionne mais sans push).
2. Un **build de développement** (`eas build --profile development`) : Expo Go ne reçoit pas
   les push distants sur Android, et le simulateur iOS non plus.
3. Pour iOS, la clé APNs est gérée par EAS au premier build ; pour Android, ajouter la clé
   FCM v1 au projet Expo (`eas credentials`).

L'app demande la permission depuis une carte sur l'accueil (jamais au démarrage), inscrit
le téléphone (`POST /api/devices`), le désinscrit à la déconnexion, et ouvre le bon écran
quand on touche une notification. Préférences : Réglages › Notifications.

## Connexion Apple et Google

Les deux boutons apparaissent sur tous les téléphones, en haut des écrans de connexion et
d'inscription. Ils créent le compte s'il n'existe pas, et le relient à un compte e-mail
existant si l'adresse est la même. Un bouton non configuré explique pourquoi au toucher.

- **Apple sur iPhone** (natif) : marche dans Expo Go si le backend accepte
  `host.exp.Exponent` (`APPLE_CLIENT_IDS=com.alternly.app,host.exp.Exponent`), **sur un
  backend local seulement** : en production, n'importe quel projet lancé dans Expo Go
  obtiendrait des jetons Apple acceptés, donc un accès aux comptes. En build,
  activer « Sign in with Apple » sur l'App ID `com.alternly.app` (EAS le fait au build).
- **Apple sur Android** (page web d'Apple) : chez Apple, créer
  un **Services ID** (ex. `com.alternly.app.signin`), activer « Sign in with Apple », domaine
  de l'API et Return URL `<API>/api/auth/apple/callback`. Puis `APPLE_SERVICES_ID` côté
  backend et `EXPO_PUBLIC_APPLE_SERVICES_ID` côté app (même valeur). Pour tester dans Expo Go,
  `APPLE_ALLOW_EXPO_GO=true` sur un backend de développement uniquement (jamais en production).
- **Google** : build de développement obligatoire (module natif absent d'Expo Go : le
  bouton le dit). Dans Google Cloud Console, créer un ID client **iOS** (bundle
  `com.alternly.app`) et un ID client **Android** (package `com.alternly.app` + empreinte
  SHA-1 du certificat EAS : `eas credentials`). Côté app : `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
  (ID web existant) et `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Côté backend :
  `GOOGLE_MOBILE_CLIENT_IDS` (ID iOS et Android).

## Achats intégrés (Premium)

Premium s'achète dans l'app (App Store / Google Play) via **RevenueCat**, et reste partagé
avec le web : le backend combine Paddle et stores, un parent abonné débloque le foyer, et
aucun des deux canaux ne propose un second abonnement (conception :
`docs/mobile/architecture-technique.md` §7.3).

1. App Store Connect / Play Console : créer les abonnements (annuel, mensuel) dans un même
   groupe, avec les mêmes durées et essais que sur le web.
2. RevenueCat : un projet avec les deux apps, un entitlement `premium`, une offre par
   défaut contenant les paquets **Annual** et **Monthly**.
3. Webhook RevenueCat → `<API>/api/billing/revenuecat-webhook`, en-tête `Authorization`
   = `REVENUECAT_WEBHOOK_SECRET` (Railway). Clé secrète `sk_…` → `REVENUECAT_API_KEY`
   (resynchronisation après achat et « Restaurer les achats »).
4. App : `EXPO_PUBLIC_REVENUECAT_IOS_KEY` et `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (clés
   publiques). Expo Go fonctionne en mode aperçu (sans vrai achat) ; tester les achats sur
   un build (TestFlight / test interne Play) avec des comptes de test.

Paywall : dernière étape de l'onboarding (« Continuer avec la version gratuite » pour passer),
onglets Dépenses et Tableau sans abonnement, et Réglages › Alternly Premium.

## Suivi des plantages (Sentry)

Actif seulement si `EXPO_PUBLIC_SENTRY_DSN` est défini (projet Sentry « React Native »).
Aucune donnée personnelle : l'id du compte, jamais l'e-mail. Un écran qui plante affiche
« Réessayer » et remonte l'erreur. Pour des traces lisibles, définir aussi `SENTRY_ORG`,
`SENTRY_PROJECT` et le secret EAS `SENTRY_AUTH_TOKEN` : les source maps partent au build.

## Liens profonds

`https://alternly.com/join/<jeton>` (invitation) et `/reset-password?token=…` s'ouvrent dans
l'app quand elle est installée, sinon dans le navigateur comme avant. En développement :
`npx uri-scheme open "alternly://join/<jeton>" --ios` (ou `--android`), ou le même lien
`exp://…/--/join/<jeton>` dans Expo Go.

Sans compte, l'invitation est gardée (trousseau) : après inscription ou connexion, l'app
revient sur « Rejoindre le foyer » au lieu de lancer l'onboarding.

Pour que les liens `https` ouvrent l'app (et non le site), le domaine doit le déclarer.
Deux fichiers à servir par Vercel sous `frontend/public/.well-known/`, avec l'en-tête
`Content-Type: application/json` :
- `apple-app-site-association` : `{"applinks":{"details":[{"appIDs":["<TEAM_ID>.com.alternly.app"],"components":[{"/":"/join/*"},{"/":"/reset-password"}]}]}}`
  (Team ID : developer.apple.com › Membership) ;
- `assetlinks.json` : empreinte SHA-256 du certificat de signature Android (`eas credentials`).

## Vérifications (identiques à la CI)

```bash
npx tsc --noEmit
npx expo lint
npx jest
npx expo export --platform ios --platform android   # bundle natif complet
```

## Organisation

```
src/app/            routes Expo Router (1 fichier = 1 écran)
  (auth)/           bienvenue, connexion, inscription, mot de passe oublié
  (app)/onboarding  foyer → enfants → rythme → notifications → Premium (facultatif)
  (app)/(tabs)/     Accueil, Calendrier, Tableau, Dépenses, Réglages
  (app)/exchange/   new (proposer / contre-proposer), [id] (répondre)
  (app)/expense/    [id] (détail, actions), edit (ajouter / modifier), settle (remboursement)
  (app)/wall/       [id] (post et réponses), new (info, tâche, question)
  (app)/settings/   profile, household (enfants, zone), rules, special-days, account
  (app)/…           notifications, notification-settings (préférences push), premium (achat)
src/components/     briques d'interface (charte « papier chaleureux »)
src/lib/            client API, session, requêtes, dates, logique calendrier (+ tests)
```

La garde (qui a les enfants quel jour) est calculée par le backend :
l'app lit `/households/{id}/calendar` et ne recalcule rien.

## État

Fait : connexion / inscription e-mail, **Apple et Google**, mot de passe oublié ; **onboarding** (foyer, zone
scolaire, enfants, rythme de garde en 4 étapes avec ajustement jour par jour, vacances) ;
accueil (qui a les enfants, prochain passage, échanges à valider, 7 prochains jours, à venir) ;
**invitation de l'autre parent** (feuille de partage du téléphone) et **liens profonds**
(rejoindre un foyer, nouveau mot de passe) ; **notifications push**
(permission, préférences par catégorie, ouverture du bon écran) ; calendrier mensuel avec
détail du jour ; **dépenses partagées** (solde, ajout / modification, contestation,
remboursements ; Premium) ; **tableau** (infos, tâches, questions, réponses ; Premium) ;
**proposer un échange**, le retirer, accepter / refuser / **contre-proposer** ;
notifications in-app ; **achats intégrés** (Premium partagé avec le web) ; **réglages modifiables** (profil, enfants, zone, garde et vacances,
jours de fête, demandes de changement à accepter, mot de passe, suppression du compte),
déconnexion.

À venir : synchronisation d'agenda (iCal), historique des changements.
