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
  (app)/(tabs)/     Accueil, Calendrier, Tableau, Dépenses, Réglages
  (app)/…           notifications, réponse à un échange
src/components/     briques d'interface (charte « papier chaleureux »)
src/lib/            client API, session, requêtes, dates, logique calendrier (+ tests)
```

La garde (qui a les enfants quel jour) est calculée par le backend :
l'app lit `/households/{id}/calendar` et ne recalcule rien.

## État (v0.1)

Fait : connexion / inscription e-mail, mot de passe oublié, accueil (qui a les enfants,
prochain passage, échanges à valider, 7 prochains jours, à venir), calendrier mensuel
avec détail du jour, réponse à un échange (accepter / refuser), notifications in-app,
réglages en lecture, déconnexion.

À venir : onboarding (création du foyer), proposer un échange, connexion Google et Apple,
notifications push, Tableau et Dépenses natifs, réglages modifiables, liens profonds
(`/join/<jeton>`, `/reset-password`), achats intégrés. En attendant, ces écrans
renvoient vers alternly.com.
