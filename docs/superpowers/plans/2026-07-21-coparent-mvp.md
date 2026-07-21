# Coparent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monolithe FastAPI + React buildé implémentant le MVP §5.1 : moteur de garde FR (patterns, vacances A/B/C, fériés/fêtes, exceptions), partage à 2 parents, iCal, notifications in-app.

**Architecture:** Backend FastAPI (Python 3.12, SQLAlchemy, JWT) avec moteur de garde **pur** (aucune I/O) testé exhaustivement ; caches DB pour les données publiques (data.education.gouv, calendrier.api.gouv.fr) ; front React+Vite+TS+FullCalendar servi en statique par FastAPI (fallback SPA).

**Tech Stack:** fastapi, uvicorn, sqlalchemy, pydantic v2, pyjwt, bcrypt, httpx, ics/icalendar (génération manuelle simple), pytest ; react 18, vite, typescript, react-router, @fullcalendar/react.

**Référence :** spec `docs/superpowers/specs/2026-07-21-coparent-mvp-design.md` (priorités : exception > fête > vacances > rythme ; granularité jour ; parité = année de début de période de vacances).

---

### Task 1: Scaffolding backend

**Files:** Create `backend/requirements.txt`, `backend/app/{__init__,config,db,main}.py`, `backend/.env.example`, `.gitignore`, `backend/tests/__init__.py`

- [ ] **Step 1:** requirements.txt : fastapi, uvicorn[standard], sqlalchemy>=2, pydantic>=2, pydantic-settings, pyjwt, bcrypt, httpx, python-multipart, pytest, pytest-asyncio (si utile), et `psycopg[binary]` (Postgres alwaysdata plus tard).
- [ ] **Step 2:** `config.py` : `Settings(BaseSettings)` avec `database_url: str = "sqlite:///./coparent.db"`, `secret_key: str = "dev-secret-change-me"`, `access_token_expire_minutes: int = 60*24*30`, `env_file=".env"`.
- [ ] **Step 3:** `db.py` : engine (`connect_args={"check_same_thread": False}` si sqlite), `SessionLocal`, `Base(DeclarativeBase)`, `get_db()` yield.
- [ ] **Step 4:** `main.py` : `app = FastAPI(title="Coparent")`, création tables au startup (`Base.metadata.create_all`), route `GET /api/health` → `{"status":"ok"}`.
- [ ] **Step 5:** venv + install + `pytest` sanity + lancer uvicorn, curl health. Commit `feat: scaffolding backend FastAPI`.

### Task 2: Modèles SQLAlchemy + schémas Pydantic

**Files:** Create `backend/app/models.py`, `backend/app/schemas.py`

- [ ] **Step 1:** `models.py` — tables du §4 de la spec, exactement :
  - `User(id, email unique index, password_hash, display_name, color str, ical_token str default uuid4 hex, created_at)`
  - `Household(id, name, school_zone str default "A", created_at)`
  - `HouseholdMember(id, household_id FK, user_id FK, role str)` — unique (household_id, user_id)
  - `Child(id, household_id FK, first_name, birthdate Date nullable)`
  - `CustodyRule(id, household_id FK unique, pattern str, start_date Date, reference_parent_id FK user, handover_day int default 0, handover_time str default "18:00", custom_weeks JSON nullable)`
  - `VacationRule(id, household_id FK unique, mode str default "split_half", even_year_first_half_parent_id FK user nullable)`
  - `SpecialDayRule(id, household_id FK, kind str, parent_mode str default "auto", parent_id FK nullable, enabled bool default True)` — unique (household_id, kind)
  - `ScheduleException(id, household_id FK, date_start Date, date_end Date, parent_id FK, note str default "", created_by FK, created_at)`
  - `Invitation(id, household_id FK, token unique, invited_by FK, expires_at, used_at nullable)`
  - `Notification(id, user_id FK, type str, payload JSON, read_at nullable, created_at)`
  - `SchoolHolidayCache(id, zone, label, start Date, end Date, school_year str)` unique (zone,label,school_year) ; `PublicHolidayCache(id, date Date unique, label)`
  - JSON : `sqlalchemy.JSON` (compatible SQLite/Postgres).
- [ ] **Step 2:** `schemas.py` — Pydantic : `UserCreate/UserOut`, `Token`, `HouseholdCreate/Out(members, children, zone)`, `ChildIn/Out`, `CustodyRuleIn/Out`, `VacationRuleIn/Out`, `SpecialDayRuleIn/Out`, `ExceptionIn/Out`, `CalendarDay{date, parent_id, source}`, `CalendarResponse{days, public_holidays, school_holidays}`, `NotificationOut`. `model_config = ConfigDict(from_attributes=True)`.
- [ ] **Step 3:** Import models dans main, relancer, vérifier création tables. Commit `feat: modèles et schémas`.

### Task 3: Moteur — rythmes de base (TDD)

**Files:** Create `backend/app/services/custody_engine.py`, `backend/tests/test_engine_patterns.py`

Interface du moteur (dataclasses légères, pas de modèles ORM) :

```python
@dataclass
class EngineRule:
    pattern: str                # alternate_weeks | two_two_three | every_other_weekend | custom
    start_date: date
    reference_parent: str       # id/clé opaque ("A"/"B" dans les tests)
    other_parent: str
    handover_day: int = 0       # 0 = lundi
    custom_weeks: list[str] | None = None  # 14 entrées "ref"/"other"

@dataclass
class DayAssignment:
    day: date
    parent: str
    source: str                 # rule | vacation | special | exception
```

`base_pattern_parent(rule, day) -> str` :
- `alternate_weeks` : nb de semaines écoulées depuis le premier `handover_day` ≤ start_date ; parité → ref/other.
- `two_two_three` : cycle 14 jours ancré au lundi de la semaine de start_date : `RRRO O RRR` non — utiliser le motif standard jours 0-13 = `[ref,ref,other,other,ref,ref,ref, other,other,ref,ref,other,other,other]` (2-2-3 miroir).
- `every_other_weekend` : `other_parent` par défaut ; un week-end sur deux (ven/sam/dim, parité de semaine vs start_date) → `reference_parent`.
- `custom` : `custom_weeks[(day - anchor_monday) % 14]`.

- [ ] **Step 1:** Écrire les tests (dates pivot connues, ex. start 2026-01-05 lundi) : alternance de semaines avec bascule le lundi ; cycle 2-2-3 sur 14 jours listé explicitement ; 1 WE/2 : vérifie ven-sam-dim semaine 0 chez ref, semaine 1 chez other, lun-jeu toujours other ; custom avec un motif arbitraire.
- [ ] **Step 2:** `pytest backend/tests/test_engine_patterns.py` → FAIL (module absent).
- [ ] **Step 3:** Implémenter `base_pattern_parent` + helper `anchor_monday(d)`.
- [ ] **Step 4:** Tests verts. Commit `feat: moteur — rythmes de base`.

### Task 4: Moteur — vacances, fêtes, exceptions (TDD)

**Files:** Create `backend/tests/test_engine_overrides.py`; Modify `backend/app/services/custody_engine.py`

Types additionnels :

```python
@dataclass
class EngineVacationRule:
    mode: str                       # split_half | alternate_full
    even_year_first_half_parent: str
@dataclass
class Period:  # vacances scolaires
    label: str; start: date; end: date   # bornes incluses (jours sans école)
@dataclass
class EngineSpecialRule:
    kind: str; parent: str; enabled: bool = True
@dataclass
class EngineException:
    start: date; end: date; parent: str
```

`resolve_calendar(rule, vacation_rule, special_rules, exceptions, school_periods, start, end) -> list[DayAssignment]` applique, jour par jour, la priorité **exception > special > vacation > rule**.

Vacances `split_half` : durée n jours ; 1re moitié = `ceil(n/2)` jours. Année paire (année de `period.start`) → 1re moitié à `even_year_first_half_parent`, 2e moitié à l'autre ; année impaire → inversé. `alternate_full` : année paire → tout à `even_year_first_half_parent`, impaire → l'autre.

Fêtes : `mothers_day(year)` = dernier dimanche de mai, +7j si égal au dimanche de Pentecôte (Pâques via algorithme de Butcher) ; `fathers_day(year)` = 3e dimanche de juin ; `christmas_eve` = 24/12, `christmas_day` = 25/12.

- [ ] **Step 1:** Tests : (a) split_half sur période paire de 14 jours en 2026 (année paire) → 7/7 ; (b) période de 15 jours → 8/7 ; (c) même période en 2027 → inversée ; (d) vacances de Noël commençant en déc. 2026 → parité de 2026 pour toute la période ; (e) alternate_full ; (f) exception au milieu de vacances gagne ; (g) christmas_day pendant vacances gagne sur la moitié ; (h) mothers_day(2026)=31/05/2026, fathers_day(2026)=21/06/2026, et un cas Pentecôte connu (2038 : Pentecôte 13 juin… utiliser plutôt cas vérifié : en 2016 fête des mères = 29 mai ; Pentecôte 15 mai — prendre 2027 : Pâques 28/03, Pentecôte 16/05, dernier dim. mai = 30/05 → pas de conflit ; garder un test paramétré vs table de vérité {2024:26/05, 2025:25/05, 2026:31/05}).
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter (Butcher pour Pâques ; boucle jour par jour ; index de moitié précalculé par période). **Step 4:** verts. **Step 5:** Commit `feat: moteur — vacances, fêtes, exceptions`.

### Task 5: Services données publiques

**Files:** Create `backend/app/services/{school_holidays,public_holidays}.py`, `backend/tests/test_public_data.py`

- `public_holidays.get(db, year)` : cache DB sinon `GET https://calendrier.api.gouv.fr/jours-feries/metropole/{year}.json` (httpx, timeout 10s), upsert cache. Retour `dict[date,str]`.
- `school_holidays.get(db, zone, school_years: list[str])` : cache sinon API Opendatasoft v2 `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records` avec `where=zones="Zone A" and annee_scolaire="2026-2027" and population<>"Enseignants"`, `limit=40`. Parse `start_date`/`end_date` (ISO datetime) → `Period(label=description, start=date début, end=date fin - 1 jour si end à minuit ; conserver bornes incluses de jours vaqués)`. Dédupliquer par (label, start). Upsert cache. En cas d'erreur réseau : lever `PublicDataUnavailable` (le router la convertit en réponse partielle avec `school_holidays_loaded: false`).
- `school_years_for_range(start, end)` : "2025-2026" style — années scolaires chevauchant la plage (bascule au 1er août).
- [ ] Tests avec httpx MockTransport (fixtures JSON minimales) + test du mapping bornes ; verts ; commit `feat: services données publiques avec cache`.

### Task 6: Auth JWT

**Files:** Create `backend/app/auth.py`, `backend/app/routers/auth.py`, `backend/tests/{conftest,test_auth}.py`; Modify `backend/app/main.py`

- `auth.py` : `hash_password`/`verify_password` (bcrypt), `create_token(user_id)` (PyJWT HS256, exp), `get_current_user` (Depends, header Bearer, 401 sinon).
- Router : `POST /api/auth/register {email,password,display_name,color?}` → crée user (409 si email pris), retourne token+user ; `POST /api/auth/login` ; `GET /api/auth/me`.
- `conftest.py` : fixture app+TestClient sur SQLite mémoire (`StaticPool`), override `get_db`.
- [ ] Tests : register→me, login ok/mauvais mdp 401, email dupliqué 409. TDD, verts, commit `feat: auth JWT`.

### Task 7: Foyers, membres, invitations, enfants

**Files:** Create `backend/app/routers/{household,children}.py`, `backend/app/deps.py`, `backend/tests/test_household.py`

- `deps.py` : `get_my_household(db, user)` → Household + rôle (404 si aucun) ; `require_member(household_id)`.
- Household : `POST /api/households {name, school_zone}` (crée + membre parent1 + 4 SpecialDayRule par défaut : christmas_eve→parent1? non — `parent_mode="auto"` : mothers/fathers day auto ; christmas_eve/christmas_day alternance non gérée au MVP → défaut `enabled=False` pour Noël, activables avec parent explicite) ; `GET /api/households/mine` (foyer + membres + enfants + règles) ; `PATCH /api/households/{id}`.
- Invitations : `POST /api/households/{id}/invitations` → token `secrets.token_urlsafe(32)`, exp 14 j, `invite_url = f"/join/{token}"` ; `GET /api/invitations/{token}` → nom du foyer + inviteur (410 si expirée/utilisée) ; `POST /api/invitations/{token}/accept` (auth requis, 409 si foyer plein ou déjà membre) → membre parent2, marque used_at, notifie parent1.
- Children : CRUD sous `/api/households/{id}/children`.
- [ ] Tests : création foyer, isolation (user étranger → 403/404), flux invitation complet, expiration. Verts, commit `feat: foyers, invitations, enfants`.

### Task 8: Règles + exceptions (API)

**Files:** Create `backend/app/routers/rules.py`, `backend/tests/test_rules.py`

- `PUT /api/households/{id}/custody-rule` (upsert ; valide pattern ∈ enum, reference_parent_id membre du foyer, custom_weeks longueur 14 si pattern=custom) ; notifie l'autre parent `rule_changed`.
- `PUT /api/households/{id}/vacation-rule` (upsert).
- `PUT /api/households/{id}/special-day-rules` (liste complète).
- `POST /api/households/{id}/exceptions {date_start,date_end,parent_id,note}` (valide start≤end, parent membre) → notifie l'autre parent `exception_created` ; `GET` liste ; `DELETE /exceptions/{eid}` → notifie.
- [ ] Tests validation + notifications créées. Verts, commit `feat: règles de garde et exceptions`.

### Task 9: Endpoint calendrier

**Files:** Create `backend/app/routers/calendar.py`, `backend/tests/test_calendar_api.py`

- `GET /api/households/{id}/calendar?start&end` (max 18 mois) : charge règles/exceptions ORM → convertit en dataclasses moteur (parents = ids str), charge fériés + vacances (via services, tolère `PublicDataUnavailable` → `school_holidays_loaded=false`), appelle `resolve_calendar`, retourne `{days:[{date,parent_id,source}], public_holidays:[{date,label}], school_holidays:[{label,start,end}], school_holidays_loaded, handover_day, handover_time, members:[{id,display_name,color}]}`. 409 si pas de custody_rule.
- [ ] Test happy path avec règle semaine/semaine et caches préremplis en DB (pas d'appel réseau). Verts, commit `feat: endpoint calendrier résolu`.

### Task 10: Export iCal + notifications API

**Files:** Create `backend/app/services/ical_export.py`, `backend/app/routers/{ical,notifications}.py`, `backend/tests/test_ical.py`

- iCal : `GET /api/ical/{ical_token}.ics` (sans auth). Fusionne les jours consécutifs du même parent sur ±12 mois en `VEVENT` all-day (`DTSTART;VALUE=DATE` / `DTEND` exclusif) `SUMMARY: 🏠 {display_name}`. Génération manuelle du texte ICS (CRLF, VCALENDAR/PRODID/UID stables `{token}-{start}`). `POST /api/ical/regenerate` (auth) → nouveau token.
- Notifications : `GET /api/notifications` (50 dernières), `POST /api/notifications/read {ids}`.
- [ ] Test : ICS parseable (contient BEGIN:VCALENDAR, events fusionnés corrects sur 3 semaines simulées). Verts, commit `feat: export iCal et notifications`.

### Task 11: Frontend scaffold + client API

**Files:** Create `frontend/` (Vite react-ts), `frontend/src/api.ts`, `frontend/src/auth.tsx`, `frontend/vite.config.ts` (proxy `/api`→`http://localhost:8000`), router de base.

- `api.ts` : fetch wrapper (base `/api`, JSON, Bearer depuis localStorage, 401 → redirect /login) + fonctions typées par endpoint (types miroirs des schémas).
- `auth.tsx` : contexte user + token, `RequireAuth`.
- Routes : `/login`, `/register`, `/join/:token`, `/onboarding`, `/` (calendrier), `/settings`.
- [ ] `npm run build` passe. Commit `feat: scaffold frontend`.

### Task 12: Pages auth + onboarding

**Files:** Create `frontend/src/pages/{Login,Register,Join,Onboarding}.tsx`, composants `RuleForm.tsx`

- Login/Register simples (email/mdp/prénom + couleur via input color). Join : aperçu invitation → bouton rejoindre (redirige vers login/register si pas connecté, conserve le token en localStorage `pending_invite`).
- Onboarding en 3 étapes (état local) : foyer (nom + zone A/B/C) → enfants (prénoms) → `RuleForm` (pattern radio avec description FR, date de départ, parent référent, jour/heure de bascule, éditeur grille 14 jours si personnalisé) + règle vacances (mode + qui a la 1re moitié les années paires). À la fin → `/`.
- [ ] Vérif manuelle en dev (uvicorn + vite). Commit `feat: auth et onboarding front`.

### Task 13: Vue calendrier + exceptions + réglages + bell

**Files:** Create `frontend/src/pages/{Calendar,Settings}.tsx`, `frontend/src/components/{CalendarView,ExceptionDialog,NotificationBell}.tsx`

- `CalendarView` : FullCalendar `dayGridMonth`/`timeGridWeek` sans heures → utiliser `dayGridMonth` + `dayGridWeek`, locale fr, événements background colorés par parent (couleur user), badges fériés (`display:"background"` gris + titre), bandeaux vacances scolaires, pictos source (échange ↔️, fête ⭐). Légende (pastille + prénom par parent). Bandeau « 🔁 Changement de foyer demain » si le parent de demain ≠ celui d'aujourd'hui.
- Clic jour → `ExceptionDialog` (plage, parent, note) → POST + refetch.
- `Settings` : règles (réédition RuleForm), zone, invitation parent2 (génère URL + bouton copier), lien iCal (copier + régénérer), profil (couleur).
- `NotificationBell` : badge non-lus (poll 60s), liste, marquer lu.
- [ ] Vérif manuelle. Commit `feat: calendrier interactif et réglages`.

### Task 14: Servir le build (monolithe) + smoke final

**Files:** Modify `backend/app/main.py`; Create `README.md`

- `main.py` : si `frontend/dist` existe → `StaticFiles` sur `/assets`, route catch-all non-`/api` → `index.html`.
- `npm run build` ; lancer uvicorn seul ; parcours complet manuel (register → onboarding → calendrier → invitation dans un 2e navigateur privé → exception → notification → iCal téléchargé).
- README : setup (venv, npm, `DATABASE_URL` alwaysdata), commandes dev/prod.
- [ ] `pytest` complet vert. Commit `feat: monolithe servi par FastAPI + README`.

## Self-review

Spec coverage : §4→T2, §5→T3-4, §6→T5, §7→T6-10, §8→T11-13, §9→T8/T10/T13 (bandeau demain calculé côté front), §10→T3-10, monolithe→T14. Noël : désactivé par défaut, activable avec parent explicite (décision actée T7). Types moteur cohérents T3/T4/T9.
