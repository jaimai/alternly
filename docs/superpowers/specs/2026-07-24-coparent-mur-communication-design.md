# Coparent — Mur de communication : spécification de design

Date : 2026-07-24 · Statut : design validé par Thomas (structure, tâches, calendrier)

## 1. Objet

Espace partagé du foyer pour la coordination asynchrone entre les deux parents :
informations (« Léo a un exposé lundi »), tâches à faire (devoirs, démarches
école, avec échéance et enfant concerné), et questions attendant une réponse.
« Mur » de posts asynchrones, **pas** une messagerie temps réel.

Module **indépendant** des dépenses partagées (spec séparée). Notifications
in-app (e-mail éventuel plus tard, cf. politique « actionnable »).

## 2. Décisions actées

- **Mur unifié** : un modèle de post typé (`message` | `task` | `question`) avec
  fil de **réponses**.
- **Tâches** partagées, **assignables** à un parent (ou « pour l'un ou l'autre »),
  cochables par n'importe qui.
- Les **tâches datées apparaissent sur le calendrier** (décoration, moteur de
  garde inchangé).

## 3. Modèle de données

- **WallPost**
  - `id`, `household_id` (FK), `author_id` (FK user)
  - `kind` (`message` | `task` | `question`)
  - `body` (str, 1..2000)
  - `child_id` (FK enfant, nullable → concerne un enfant précis)
  - `due_date` (Date, nullable — tâche datée)
  - `assigned_to` (FK user, nullable — tâche assignée ; sinon « pour l'un ou l'autre »)
  - `completed_at` (datetime, nullable) / `completed_by` (FK user, nullable) —
    tâche « faite » ou question « résolue » ; un message peut aussi être archivé.
  - `created_at`, `edited_at` (nullable)

- **WallReply**
  - `id`, `post_id` (FK), `author_id` (FK user), `body` (str, 1..2000), `created_at`

Micro-migration idempotente au démarrage (`create_all`).

## 4. Intégration calendrier

Le service calendrier renvoie, en plus de la garde, les **tâches datées** dont
`due_date` ∈ [start, end] et non complétées, dans un bloc `tasks` de
`CalendarResponse` : `[{id, body, due_date, child_id, assigned_to}]`. Le front
affiche un repère 📝 sur le jour. Le moteur pur `resolve_calendar` **n'est pas
touché** (comme les fériés/vacances, c'est une décoration ajoutée par le routeur).

## 5. Workflow & autorisations

- **Création** (`POST /wall`) : tout membre. Notifie l'autre `wall_post_added`.
  Si `assigned_to` = l'autre parent → également `wall_task_assigned`.
- **Réponse** (`POST /wall/{id}/replies`) : tout membre. Notifie l'autre
  participant `wall_reply_added`.
- **Compléter / rouvrir** (`POST /wall/{id}/complete` | `/reopen`) : tout membre
  (coche « fait »/« résolu » ou annule). `complete` pose `completed_at/by`.
- **Édition / suppression** d'un post (`PATCH` / `DELETE /wall/{id}`) : **auteur
  seulement**. Suppression d'une réponse (`DELETE /replies/{rid}`) : **auteur
  seulement**. Supprimer un post supprime ses réponses (cascade applicative).

## 6. API (préfixe `/api/households/{id}`)

- `GET /wall?kind=&child_id=&open=true` → posts (avec réponses), tri récent
  d'abord ; `open=true` filtre les non complétés.
- `POST /wall` (valide `kind` ∈ enum, `body` non vide, `child_id`/`assigned_to`
  cohérents avec le foyer, `due_date` seulement pertinent pour `task`).
- `PATCH /wall/{id}` (auteur : body, due_date, assigned_to, child_id),
  `DELETE /wall/{id}` (auteur).
- `POST /wall/{id}/complete`, `POST /wall/{id}/reopen`.
- `POST /wall/{id}/replies`, `DELETE /replies/{rid}` (auteur).
- `GET /calendar` : renvoie en plus `tasks` (tâches datées de la plage).

Autorisation : appartenance au foyer sur toute ressource ; contrôle d'auteur sur
édition/suppression.

## 7. Frontend

Page **Mur** (`/app/wall`, lien dans la barre du haut) :

- **Composeur** en haut : choix du type (info / tâche / question), texte, et
  options selon le type : enfant concerné, échéance (tâche), assignation (tâche).
- **Fil** de posts (récent d'abord) : badge de type, auteur, date, corps, enfant.
  - `task` : case à cocher (fait), échéance, assignation ; barré si complété.
  - `question` : bouton « Marquer résolu ».
  - fil de **réponses** repliable + champ de réponse.
- **Calendrier** : repère 📝 sur les jours avec une tâche datée (clic → ouvre le
  mur, hors périmètre strict MVP : au minimum le repère + le libellé).
- Notifications réutilisent la cloche (nouveaux libellés).

Types miroir dans `types.ts`, fonctions client dans `api.ts`, route dans `App.tsx`.

## 8. Tests (TDD, priorité back)

- Création par type (message/task/question) ; validation (`kind`, body, cohérence
  enfant/assignation) ; réponses ; `complete`/`reopen` (pose/retire
  `completed_at`).
- Autorisations : auteur seul édite/supprime un post ou une réponse (autre → 403).
- Tâches datées reflétées dans `GET /calendar` (`tasks`), non complétées seulement.
- Notifications émises (post ajouté, réponse, tâche assignée).

## 9. Sécurité / conformité

Contenus = données personnelles de foyer : isolation stricte par appartenance.
Corps et réponses affichés en HTML échappés (comme le correctif e-mail). Aucune
donnée sensible imposée (texte libre laissé à l'appréciation des parents).
```
