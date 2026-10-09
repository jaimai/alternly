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

Les boutons apparaissent en haut des écrans de connexion et d'inscription. Ils créent le
compte s'il n'existe pas, et le relient à un compte e-mail existant si l'adresse est la même.

- **Apple** (iPhone uniquement) : marche dans Expo Go si le backend accepte
  `host.exp.Exponent` (`APPLE_CLIENT_IDS=com.alternly.app,host.exp.Exponent`), **sur un
  backend local seulement** : en production, n'importe quel projet lancé dans Expo Go
  obtiendrait des jetons Apple acceptés, donc un accès aux comptes. En build,
  activer « Sign in with Apple » sur l'App ID `com.alternly.app` (EAS le fait au build).
- **Google** : build de développement obligatoire (module natif absent d'Expo Go).
  Dans Google Cloud Console, créer un ID client **iOS** (bundle `com.alternly.app`) et un
  ID client **Android** (package `com.alternly.app` + empreinte SHA-1 du certificat EAS :
  `eas credentials`). Côté app : `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (ID web existant) et
  `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Côté backend : `GOOGLE_MOBILE_CLIENT_IDS` (ID iOS et
  Android). Sans ces variables, le bouton Google est masqué.

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
  (app)/onboarding  foyer → enfants → rythme (tant que le foyer n'a pas de règle de garde)
  (app)/(tabs)/     Accueil, Calendrier, Tableau, Dépenses, Réglages
  (app)/exchange/   new (proposer / contre-proposer), [id] (répondre)
  (app)/expense/    [id] (détail, actions), edit (ajouter / modifier), settle (remboursement)
  (app)/…           notifications, notification-settings (préférences push)
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
remboursements ; Premium) ; **proposer un échange**, le retirer, accepter / refuser / **contre-proposer** ;
notifications in-app ; réglages en lecture, déconnexion.

À venir : Tableau natif,
réglages modifiables (règles, enfants), achats intégrés. En attendant, ces écrans renvoient vers alternly.com.
