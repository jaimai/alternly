# Coparent — Dépenses partagées : spécification de design

Date : 2026-07-24 · Statut : design validé par Thomas (répartition, workflow, règlement, champs)

## 1. Objet

Module permettant aux deux parents d'un foyer de suivre les dépenses liées aux
enfants, de savoir qui doit combien (solde net), et d'enregistrer les
remboursements. Hors périmètre de cette version : photo de justificatif (stockage
de fichiers), export comptable, multi-devises, e-mail sur dépense (in-app
seulement — l'e-mail pourra venir plus tard, cf. politique « actionnable »).

Module **indépendant** du mur de communication (spec séparée).

## 2. Décisions actées

- **Répartition** : 50/50 par défaut, ajustable par dépense (`payer_percent`).
- **Workflow** : dépense enregistrée directement (entre dans le solde), l'autre
  parent est notifié et peut la **contester**.
- **Règlement** : solde net courant + enregistrement des **remboursements**.
- **Champs** : montant, libellé, date, qui a payé, **catégorie**, **enfant**
  (optionnel). Pas de photo de justificatif.
- **Montants en centimes entiers** (jamais de flottants).

## 3. Modèle de données

Montants : `int` en **centimes** (EUR implicite). Deux nouvelles tables.

- **Expense**
  - `id`, `household_id` (FK)
  - `label` (str, 1..120), `amount_cents` (int > 0), `date` (Date)
  - `category` (`sante` | `ecole` | `activites` | `vetements` | `cantine` | `autre`)
  - `child_id` (FK enfant, nullable → « tous les enfants / le foyer »)
  - `paid_by` (FK user, membre du foyer ; défaut = créateur, choisissable)
  - `payer_percent` (int 0..100, défaut 50) — part **à la charge du payeur** ;
    l'autre parent lui doit `amount × (100 − payer_percent) / 100`.
  - `status` (`active` | `disputed`), `dispute_note` (str, défaut "")
  - `created_by` (FK user), `created_at` (datetime)

- **Settlement** (remboursement)
  - `id`, `household_id` (FK)
  - `from_user` (FK user, celui qui verse), `to_user` (FK user, celui qui reçoit)
  - `amount_cents` (int > 0), `date` (Date), `note` (str, défaut "")
  - `created_by` (FK user), `created_at` (datetime)

Micro-migration idempotente au démarrage (création des tables via `create_all`).

## 4. Calcul du solde (`services/expenses_service.py`, pur)

Fonction pure testable sans I/O :

```
compute_balance(expenses, settlements, member_ids) -> Balance
  # Balance : net par utilisateur (somme nulle entre les 2), + libellé résolu
```

Règles :
1. Pour chaque dépense **active** (les `disputed` sont ignorées) : le `paid_by` a
   avancé `amount_cents` ; l'autre parent lui doit
   `round(amount_cents × (100 − payer_percent) / 100)` (arrondi au centime,
   demi-pair). Crédite le payeur, débite l'autre de ce montant.
2. Pour chaque **remboursement** : `from_user` verse `amount_cents` à `to_user`
   → réduit la dette de `from_user` envers `to_user` (débite `to_user`, crédite
   `from_user`).
3. Résultat : `net[user_id]` (deux valeurs opposées). Le solde s'exprime comme
   « `debtor` doit `amount_cents` à `creditor` », ou « à jour » si net = 0.

L'arrondi se fait **par dépense** (pas sur le total) pour rester cohérent avec un
affichage ligne à ligne.

## 5. Workflow & autorisations

- **Création** (`POST /expenses`) : par tout membre. `paid_by` défaut = créateur,
  choisissable parmi les membres. Entre directement dans le solde
  (`status=active`). Notifie l'autre parent `expense_added`.
- **Contestation** (`POST /expenses/{id}/dispute`) : par un membre **autre que
  `paid_by`** (le payeur ne conteste pas sa propre dépense → 403). Passe
  `status=disputed` + `dispute_note`. La dépense **sort du solde**. Notifie
  `paid_by` : `expense_disputed`.
- **Résolution** (`POST /expenses/{id}/resolve`) : repasse `status=active`
  (vide `dispute_note`). Autorisée au `paid_by` (il a ajusté hors bande ou
  maintient) **et** au contestataire (il lève sa contestation). Notifie l'autre.
- **Édition / suppression** (`PATCH` / `DELETE /expenses/{id}`) : **créateur
  seulement**. Une édition d'une dépense contestée la repasse `active`.
- **Remboursements** : `POST /settlements` (tout membre), `DELETE
  /settlements/{id}` (créateur seulement). Notifie l'autre `settlement_recorded`.

## 6. API (préfixe `/api/households/{id}`)

- `GET /expenses?category=&child_id=` → liste triée par date décroissante.
- `POST /expenses` → crée (valide montant > 0, catégorie ∈ enum, `paid_by` et
  `child_id` cohérents avec le foyer, `payer_percent` 0..100).
- `PATCH /expenses/{id}` (créateur), `DELETE /expenses/{id}` (créateur).
- `POST /expenses/{id}/dispute` (non-payeur), `POST /expenses/{id}/resolve`.
- `GET /balance` → `{ net: [{user_id, amount_cents}], debtor_id, creditor_id,
  amount_cents }` (ou `settled: true`).
- `GET /settlements`, `POST /settlements`, `DELETE /settlements/{id}`.

Autorisation : appartenance au foyer sur toute ressource ; contrôle de rôle
(payeur / contestataire / créateur) sur les transitions.

## 7. Frontend

Nouvelle page **Dépenses** (`/app/expenses`, lien dans la barre du haut) :

- **Bandeau solde** en haut : « Dominique te doit 84,50 € » / « Tu dois 12,00 € à
  Dominique » / « À jour », avec bouton « Enregistrer un remboursement ».
- **Bouton « Ajouter une dépense »** → formulaire : montant (€, converti en
  centimes), libellé, date, catégorie, enfant (optionnel), qui a payé, curseur /
  champ de partage (défaut 50 %).
- **Liste** groupée par mois : montant, libellé, catégorie, enfant, qui a payé,
  part ; badge « Contestée » le cas échéant. Bouton **Contester** sur les
  dépenses dont je ne suis pas le payeur ; **Modifier/Supprimer** sur les miennes.
- Notifications réutilisent la cloche existante (nouveaux libellés).

Types miroir dans `types.ts`, fonctions client dans `api.ts`.

## 8. Tests (TDD, priorité back)

- **Solde pur** : 50/50 une dépense ; part ajustée (30/70) ; plusieurs dépenses ;
  remboursement qui réduit / annule / inverse le solde ; dépense contestée exclue ;
  arrondi au centime (montant impair, ex. 1001 cents à 50 % → 500/501) ;
  solde « à jour ».
- **API** : création + notif ; contestation par non-payeur (payeur → 403) sort du
  solde ; résolution repasse active ; édition/suppression créateur seulement ;
  remboursement + suppression ; isolation entre foyers.
- **Centimes** : conversion euros→centimes robuste (pas de flottant).

## 9. Sécurité / conformité

Montants et libellés sont des données personnelles de foyer : isolation stricte
par appartenance (déjà en place). Aucune donnée bancaire (pas de RIB, pas de
paiement réel — les remboursements sont déclaratifs). Libellés/notes affichés en
HTML échappés (cf. correctif e-mail).
```
