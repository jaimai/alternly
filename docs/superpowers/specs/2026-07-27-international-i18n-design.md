# Alternly — Internationalisation (US d'abord) : spécification de design

Date : 2026-07-27 · Statut : brouillon de conception (à valider avant implémentation)

## 1. Objet

Rendre Alternly utilisable hors de France, **États-Unis en premier**. Deux axes
bien distincts, de difficulté très différente :

1. **Traduction de l'interface** (i18n) — mécanique, faible risque.
2. **Règles spécifiques au pays** (vacances scolaires, fériés, fêtes, devise,
   vocabulaire de garde) — c'est le vrai chantier, car l'app est aujourd'hui
   profondément franco-française.

Principe directeur : introduire un **`country`** qui sélectionne des
**fournisseurs de données enfichables** (fériés, vacances), et une couche i18n
qui externalise toutes les chaînes. La France reste le comportement par défaut,
inchangé.

## 2. Ce qui est spécifique à la France aujourd'hui (à abstraire)

| Domaine | Aujourd'hui (FR) | US |
| --- | --- | --- |
| Vacances scolaires | Zones A/B/C, API `data.education.gouv` | Pas de calendrier national — par district/État. **Aucune API propre.** |
| Jours fériés | API `calendrier.api.gouv.fr` | Fériés fédéraux (source différente) + parfois fériés d'État |
| Fêtes | Fête des mères/pères (règles FR), Noël | US : Mother's Day (2e dim. mai), Father's Day (3e dim. juin), Noël |
| Zone scolaire | `school_zone` A/B/C obligatoire | Notion inexistante → à remplacer |
| Devise | EUR (dépenses) | USD |
| Vocabulaire | « garde », « foyer » | *custody / parenting time*, *household* |
| Formats | dates JJ/MM, `fr-FR` | MM/JJ, `en-US` |

## 3. Modèle de données

- **User.locale** (`fr` | `en`, défaut selon `Accept-Language`) — langue de l'UI.
- **Household.country** (`FR` | `US`, défaut `FR`) — pilote les fournisseurs de
  données et les règles.
- **Household.currency** (`EUR` | `USD`, dérivé du pays, surchargeable).
- La zone scolaire A/B/C devient **spécifique FR** : `school_zone` reste, mais
  n'est demandée qu'en France.
- **SchoolVacationPeriod** (nouvelle table, utilisée quand il n'y a pas d'API) :
  `household_id, label, start, end`. Saisie manuelle par les parents (US, MVP).

## 4. Fournisseurs enfichables (backend)

Abstraire les deux services publics derrière une interface sélectionnée par
`country` :

```
class HolidayProvider(Protocol):
    def get(self, db, year) -> dict[date, str]: ...

class VacationProvider(Protocol):
    def get(self, db, household, start, end) -> list[Period]: ...
```

- **FR** : implémentations actuelles (API gouv, zones A/B/C). Inchangées.
- **US** :
  - Fériés : bibliothèque `holidays` (fédéraux) ou table figée — pas d'appel réseau.
  - Vacances : **saisie manuelle** (`SchoolVacationPeriod`) au MVP — pas d'API
    scolaire nationale fiable. Les parents entrent les congés de leur district.
    (Évolution possible : datasets par État/district importables.)

Le moteur de garde (`custody_engine`) est **déjà agnostique** : il reçoit les
périodes de vacances en paramètre. Rien à changer côté moteur — seule la source
des périodes change. Les fêtes (`special_day`) : `mothers_day`/`fathers_day`
sont déjà calculées par formule ; vérifier qu'elles conviennent en `en-US`
(mêmes dates que FR pour ces deux fêtes, donc OK), Noël identique.

## 5. Frontend (i18n)

- **`react-i18next`** : toutes les chaînes FR extraites dans `locales/fr.json`,
  traduites dans `locales/en.json`. Détection via `User.locale` (fallback navigateur).
- **Formats** : dates et nombres via `Intl` en fonction du locale ; devise via
  `Intl.NumberFormat(locale, { style:'currency', currency })` (household.currency)
  — remplace le `toLocaleString('fr-FR', … 'EUR')` codé en dur des dépenses.
- **Sélecteur de langue** dans les Réglages (PATCH `/me { locale }`).
- **Onboarding adaptatif** selon le pays :
  - FR : demande la zone A/B/C (comme aujourd'hui).
  - US : pas de zone ; propose la **saisie des congés scolaires** (ou plus tard),
    devise USD.
- **Landing / SEO** : version EN (`/en` ou sous-domaine) — le SSR marketing peut
  rendre les deux langues ; JSON-LD `inLanguage` adapté.

## 6. Phasage proposé

1. **Phase 1 — i18n (rapide, gros effet perçu).** `react-i18next`, EN complet,
   formats `Intl`, sélecteur de langue, `User.locale`. Aucune règle métier
   changée. Livrable : app dispo en anglais, France inchangée.
2. **Phase 2 — pays US.** `Household.country`/`currency`, fournisseurs enfichables
   (fériés US via lib, vacances en saisie manuelle + table `SchoolVacationPeriod`),
   onboarding US (sans A/B/C, USD). Livrable : un parent US a un calendrier juste.
3. **Phase 3 — marketing & légal EN.** Landing/blog EN, ToS/Privacy/Refund US,
   vérif Paddle (devise/taxe US, MoR gère déjà la TVA/taxes).

## 7. Risques / points ouverts

- **Vacances scolaires US** : le vrai blocage. Pas d'API nationale → MVP = saisie
  manuelle. À cadrer : granularité (par foyer vs par district réutilisable).
- **Découpe garde** : les rythmes (semaine/semaine, 2-2-3, 1 WE/2, custom) sont
  universels — OK. Vocabulaire à traduire finement (custody vs parenting time).
- **Fuseaux horaires** : l'app raisonne en dates (jour), pas en heures précises
  hors `handover_time` affiché — impact faible, à vérifier pour US multi-fuseaux.
- **Devise sur dépenses existantes** : `amount_cents` reste en plus petite unité ;
  la devise est portée par le foyer. Pas de conversion multi-devises au sein d'un
  foyer (un foyer = une devise).

## 8. Recommandation

Commencer par la **Phase 1** (i18n) : valeur immédiate, risque quasi nul, et elle
prépare le terrain. La Phase 2 (US) mérite sa propre spec détaillée une fois la
stratégie « vacances scolaires US » tranchée (saisie manuelle confirmée comme MVP).
