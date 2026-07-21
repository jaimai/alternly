# Coparent — MVP monolithe : spécification de design

Date : 2026-07-21 · Statut : validé par Thomas (stack, DB, périmètre, design d'ensemble)

## 1. Objet

Application web pour parents séparés qui automatise le calendrier de garde en France :
règles de récurrence, vacances scolaires zones A/B/C, jours fériés et fêtes, partage
entre les deux parents, exceptions ponctuelles, export iCal, notifications in-app.

Périmètre : MVP §5.1 du dossier de cadrage. Explicitement exclus de cette version :
dépenses, messagerie, export PDF, paiement Stripe, app native, plannings différenciés
par enfant, push/e-mail.

## 2. Décisions actées

- **Monolithe FastAPI + React buildé** : un seul déployable. FastAPI sert `/api/*`
  et les fichiers statiques du build Vite (fallback SPA sur `index.html`).
- **Base de données : PostgreSQL (alwaysdata)** via `DATABASE_URL`. Tant que l'URL
  n'est pas fournie, fallback dev sur SQLite (`sqlite:///./coparent.db`). Les modèles
  SQLAlchemy restent compatibles avec les deux (pas de types Postgres-spécifiques).
- **Emplacement** : `~/Documents/coparent`.

## 3. Architecture

```
coparent/
├── backend/
│   ├── app/
│   │   ├── main.py            # création app, CORS dev, montage SPA statique
│   │   ├── config.py          # settings (DATABASE_URL, SECRET_KEY, env)
│   │   ├── db.py              # engine, SessionLocal, Base, get_db
│   │   ├── models.py          # modèles SQLAlchemy
│   │   ├── schemas.py         # modèles Pydantic (entrée/sortie API)
│   │   ├── auth.py            # hash bcrypt, JWT, dépendance current_user
│   │   ├── routers/
│   │   │   ├── auth.py        # register, login, me
│   │   │   ├── household.py   # foyer, invitation par lien, join
│   │   │   ├── children.py    # CRUD enfants
│   │   │   ├── rules.py       # règles de garde + règles vacances + exceptions
│   │   │   ├── calendar.py    # GET /calendar?start&end → jours résolus
│   │   │   ├── ical.py        # flux .ics par token privé
│   │   │   └── notifications.py
│   │   └── services/
│   │       ├── custody_engine.py    # cœur métier pur (sans I/O)
│   │       ├── school_holidays.py   # API data.education.gouv + cache DB
│   │       ├── public_holidays.py   # API calendrier.api.gouv.fr + cache DB
│   │       └── ical_export.py
│   ├── tests/                 # pytest, ciblé moteur + API critiques
│   ├── requirements.txt
│   └── .env.example
├── frontend/                  # React 18 + Vite + TypeScript + FullCalendar
│   └── src/ (pages: Login, Register, Onboarding foyer/enfant/règle, Calendar,
│             Settings, Join-invitation; composants: CalendarView, RuleForm,
│             ExceptionDialog, NotificationBell)
└── docs/superpowers/specs/
```

## 4. Modèle de données

- **User** : id, email (unique), password_hash, display_name, color (hex),
  ical_token (uuid), created_at.
- **Household** : id, name, school_zone (`A`|`B`|`C`), created_at.
- **HouseholdMember** : household_id, user_id, role (`parent1`|`parent2`).
  Max 2 parents par foyer.
- **Child** : id, household_id, first_name, birthdate (nullable).
- **CustodyRule** (une active par foyer) : id, household_id, pattern
  (`alternate_weeks` | `two_two_three` | `every_other_weekend` | `custom`),
  start_date, reference_parent_id (parent qui a la garde à start_date),
  handover_day (0-6, défaut lundi), handover_time (défaut 18:00),
  custom_weeks (JSON : pour `custom`, 14 jours × parent — cycle de 2 semaines).
- **VacationRule** (une par foyer) : mode (`split_half` | `alternate_full`),
  even_year_first_half_parent_id (années paires : qui a la 1re moitié — ou, en
  mode alternance complète, qui a les vacances des années paires),
  applies_to_summer (bool, défaut vrai : l'été est coupé en deux moitiés aussi).
- **SpecialDayRule** : household_id, kind (`christmas_eve` | `christmas_day` |
  `mothers_day` | `fathers_day`), parent_id ou `auto` (fête des mères → mère…),
  enabled. Créées par défaut à la création du foyer.
- **ScheduleException** : id, household_id, date_start, date_end, parent_id,
  note, created_by, created_at. Statut MVP : appliquée dès création par l'un des
  parents (le flux proposer/accepter est V1) ; l'autre parent est notifié.
- **Invitation** : id, household_id, token (signé/aléatoire), invited_by,
  expires_at, used_at.
- **Notification** : id, user_id, type (`exception_created` | `rule_changed` |
  `handover_tomorrow`), payload JSON, read_at, created_at.
- **SchoolHolidayCache** : zone, label, start, end, school_year — importé de
  l'API, unique (zone, label, school_year).
- **PublicHolidayCache** : date, label, year.

## 5. Moteur de garde (`custody_engine.py`)

Fonction pure principale :

```
resolve_calendar(rule, vacation_rule, special_rules, exceptions,
                 school_holidays, public_holidays, start, end)
  -> list[DayAssignment]  # {date, parent_id, source, label?}
```

Ordre de priorité (du plus fort au plus faible) :
1. **ScheduleException** (échange ponctuel)
2. **SpecialDayRule** (Noël, fêtes des mères/pères)
3. **Vacances scolaires** (si le jour ∈ période de vacances de la zone) :
   - `split_half` : la période est coupée au jour médian (arrondi : 1re moitié
     reçoit le jour supplémentaire si durée impaire) ; l'attribution de la 1re
     moitié dépend de la parité de l'année du **début** de la période.
   - `alternate_full` : toute la période au parent de la parité correspondante.
   - Les « petites vacances » et l'été suivent la même règle (MVP).
4. **Rythme de base** (pattern) :
   - `alternate_weeks` : bascule chaque `handover_day`, parité calculée depuis
     start_date/reference_parent.
   - `two_two_three` : cycle de 14 jours 2-2-3/2-2-3 inversé (standard),
     ancré sur start_date.
   - `every_other_weekend` : parent « principal » = l'autre parent que
     reference_parent ; reference_parent a un week-end (ven 18h → dim 18h,
     modélisé en jours pleins sam+dim+ven soir → MVP : ven, sam, dim) sur deux.
   - `custom` : cycle de 14 jours défini jour par jour.
5. Chaque jour retourne aussi `source` (`rule` | `vacation` | `special` |
   `exception`) pour l'affichage, et les fériés/vacances sont renvoyés en
   décorations séparées du calendrier.

Le moteur ne fait **aucune I/O** : les caches vacances/fériés lui sont passés en
paramètres. C'est la condition pour des tests exhaustifs et rapides.

Granularité MVP : **le jour** (pas les heures de passage dans le calcul, mais
`handover_time` est affiché sur les jours de bascule).

## 6. Données publiques

- **Vacances scolaires** : dataset `fr-en-calendrier-scolaire`
  (data.education.gouv.fr, API Opendatasoft v2). Import par zone + année
  scolaire, à la demande, avec cache DB. En cas d'API indisponible : réponse
  claire à l'UI (« vacances non chargées ») — le calendrier de base fonctionne.
- **Jours fériés** : `https://calendrier.api.gouv.fr/jours-feries/metropole/{annee}.json`,
  cache DB par année.
- **Fêtes calculées localement** : fête des mères (dernier dimanche de mai,
  sauf si Pentecôte le même jour → 1er dimanche de juin), fête des pères
  (3e dimanche de juin).

## 7. API (préfixe /api)

- `POST /auth/register`, `POST /auth/login` (JWT bearer), `GET /auth/me`
- `POST /households` (crée foyer + membre parent1), `GET /households/mine`,
  `PATCH /households/{id}` (zone…)
- `POST /households/{id}/invitations` → `{invite_url}` ;
  `GET /invitations/{token}` (aperçu) ; `POST /invitations/{token}/accept`
  (rejoint comme parent2, nécessite compte)
- `POST/GET/PATCH/DELETE /children`
- `PUT /households/{id}/custody-rule`, `PUT /households/{id}/vacation-rule`,
  `PUT /households/{id}/special-day-rules`
- `POST/GET/DELETE /households/{id}/exceptions`
- `GET /households/{id}/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` →
  `{days: [...], holidays: [...], school_holidays: [...]}`
- `GET /ical/{ical_token}.ics` (sans auth, token secret ; événements = blocs de
  garde fusionnés par parent + bascules)
- `GET /notifications`, `POST /notifications/read`

Autorisation : toute ressource est vérifiée par appartenance au foyer.

## 8. Frontend

React + Vite + TS, react-router, FullCalendar (vue mois/semaine). Français
uniquement. Parcours :

1. Register/Login → 2. Onboarding (foyer + zone → enfant(s) → choix du schéma de
   garde avec aperçu immédiat → règle vacances) → 3. Calendrier (couleur de fond
   par parent, badges vacances/fériés/exception, clic sur un jour → créer une
   exception) → 4. Réglages (règles, invitation parent2, lien iCal, profil).

L'app doit être **utile en solo** : tout fonctionne avant que parent2 rejoigne.

En dev : Vite proxy `/api` → uvicorn:8000. En prod/local-final : `npm run build`
puis FastAPI sert `frontend/dist`.

## 9. Notifications (MVP)

In-app uniquement. Générées : à la création/suppression d'une exception (pour
l'autre parent), au changement de règle. « Changement de foyer demain » est
calculé à la volée et affiché en bandeau dans l'app (pas de scheduler en MVP).

## 10. Tests

pytest sur le moteur (priorité absolue) :
- bascule années paires/impaires sur les vacances (dont période à cheval sur
  deux années civiles — Noël) ;
- coupe en deux moitiés (durées paires/impaires) ;
- chaque pattern sur des dates de référence connues ;
- priorité exceptions > fêtes > vacances > rythme ;
- fêtes des mères/pères calculées (années connues, cas Pentecôte 2027 si
  applicable).
Plus tests API : auth, isolation entre foyers, flux invitation, calendar happy
path, iCal.

## 11. Sécurité / conformité (niveau MVP)

Bcrypt, JWT signé (SECRET_KEY env), tokens d'invitation aléatoires à expiration,
ical_token révocable (régénérable), aucune donnée santé au MVP, minimisation
(prénom de l'enfant seulement, anniversaire optionnel). Hébergement cible UE
(alwaysdata). CGU/politique de confidentialité : hors périmètre code.
