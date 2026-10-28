# Test pub Meta — Noël 2026

**But** : avec **40 €**, savoir si la **page Noël** transforme mieux les visiteurs en
inscrits que l'outil vacances utilisé pour la Toussaint. Ce n'est ni une campagne de
croissance ni une mesure fiable du coût par inscription (budget trop faible) : on
regarde surtout **le taux de clic vers l'inscription**, puis on décide d'une relance
plus forte avant les vacances.

| | |
| --- | --- |
| Dates | du **mar. 1er au mar. 8 décembre 2026** (après le Black Friday et le Cyber Monday, quand les enchères redescendent ; 2 à 3 semaines avant les vacances, quand les parents s'organisent) |
| Vacances | du **samedi 19 décembre 2026 au dimanche 3 janvier 2027**, zones A, B et C (reprise le lundi 4) |
| Budget | **40 € au total**, en *budget de la campagne sur toute la durée* (Meta répartit, impossible de dépasser), 1 campagne, 1 ensemble de publicités, 2 annonces |
| Page d'arrivée | `/outils/noel-garde-alternee` : dates, partage moitié/moitié déjà calculé, deux boutons « Créer mon calendrier gratuit » |
| Objectif Meta | **Trafic** → optimisation « vues de la page de destination » (comme la Toussaint, pour comparer) |
| Mesure | PostHog, via les UTM (voir plus bas) |

## Ce que la Toussaint nous a appris

Campagne `toussaint-2026-meta`, du 5 au 12 octobre, vers l'outil vacances :

| | Toussaint |
| --- | --- |
| Visiteurs (robots Meta exclus) | 240 |
| Ont vu la réponse de l'outil | 126 (51 %) |
| Temps médian sur la page | 31 s |
| Clic vers l'inscription | **3 (1,2 %)** |
| Inscriptions attribuées | **0** |
| Erreurs du navigateur Facebook/Instagram | 40 visiteurs (16 %), sans gravité, déjà masquées |

La pub attirait, mais l'outil donnait la réponse sans raison de créer un compte. La page
Noël garde la réponse immédiate et ajoute ce que l'app apporte en plus (réveillon et 25
réglés à part, échanges, rappel la veille du passage), avec un bouton juste sous la
réponse. C'est ce qu'on teste.

Avant de lancer, reporter la **dépense réelle de la Toussaint** (Gestionnaire de
publicités) ici, pour comparer le coût par visiteur : ______ € → ______ € par visiteur.

## Critères de décision (le 9 décembre)

| Mesure (PostHog, entonnoir ci-dessous) | Relancer plus fort | Revoir la page avant toute dépense |
| --- | --- | --- |
| Visiteurs qui cliquent « Créer mon calendrier » | ≥ 3 % (2,5× la Toussaint) | < 1,5 % |
| Inscriptions attribuées | ≥ 2 | 0 |
| Coût par visiteur (dépense Meta ÷ visiteurs) | proche ou mieux que la Toussaint | nettement pire |

Si on relance : **60 à 100 €** du 10 au 18 décembre sur l'annonce gagnante uniquement.

À titre indicatif, 40 € donnent en général de l'ordre de 100 à 250 visiteurs : quelques
inscriptions au mieux. Un zéro est donc possible sans que la pub soit mauvaise ; c'est le
taux de clic qui tranche.

## Ciblage

- **Lieu** : France métropolitaine.
- **Âge** : 28–50 ans, tous genres.
- **Audience** : *Advantage+ audience* (ciblage large). Suggestions de centres d'intérêt
  pour guider l'algorithme : parentalité, éducation des enfants, école primaire. Ne pas
  cibler une situation familiale (« divorcé », « séparé ») : Meta limite ce ciblage et la
  créa fait le tri.
- **Placements** : Advantage+ (fil Facebook et Instagram, Stories, Reels).
- **Catégorie spéciale** : aucune.

## Les 2 annonces

Règle de Meta : ne pas **affirmer ni sous-entendre** la situation personnelle du lecteur
(« Vous êtes séparé·e ? », « Votre ex… »). On parle de la **situation** (la garde
alternée, Noël), jamais de la personne.

### V1 — « Chez qui à Noël ? » (visuel fixe)
- **Visuels** : `v1-feed.png` (1080×1350, fil) et `v1-story.png` (1080×1920, Stories et
  Reels), avec « Personnaliser le visuel par placement ».
- **Texte principal** : Vacances de Noël 2026 : du 19 décembre au 3 janvier, toutes
  zones. En garde alternée, chez qui tombent le réveillon, le 25 et le Nouvel An ? La
  page gratuite donne les dates et le jour du passage pour le partage le plus courant, et
  les autres façons de partager Noël. Sans inscription.
- **Titre** : Qui a les enfants à Noël ?
- **Description** : Gratuit · dates officielles
- **Bouton** : En savoir plus
- **Lien** : voir `v1-chezqui` plus bas

### V2 — Reel Noël (vidéo)
- **Vidéo** : `../videos/alternly-reel-noel-9x16.mp4` (15 s, muette : tout le message est à
  l'écran). Dans l'aperçu du fil, vérifier que le texte n'est pas coupé ; s'il l'est, ne
  garder pour V2 que les emplacements Stories et Reels.
- **Texte principal** : 24 décembre, 31 décembre : cette année, c'est chez qui ? En
  moitié/moitié, passage le dimanche 27 décembre, et l'an prochain c'est l'inverse. Les
  dates exactes et les autres façons de partager Noël, sur une page gratuite.
- **Titre** : Noël en garde alternée : les dates
- **Description** : Gratuit · sans inscription
- **Bouton** : En savoir plus
- **Lien** : voir `v2-reel` plus bas

## Liens (à coller tels quels dans « URL du site web »)

| Annonce | URL |
| --- | --- |
| V1 | `https://alternly.com/outils/noel-garde-alternee?utm_source=facebook&utm_medium=paid_social&utm_campaign=noel-2026-meta&utm_content=v1-chezqui` |
| V2 | `https://alternly.com/outils/noel-garde-alternee?utm_source=facebook&utm_medium=paid_social&utm_campaign=noel-2026-meta&utm_content=v2-reel` |

`utm_source=facebook` couvre aussi Instagram. Pour distinguer les deux, remplacer par
`utm_source={{site_source_name}}` (paramètre dynamique Meta : fb, ig…).

Les UTM suivent le visiteur jusqu'à l'inscription : le site les ajoute aux boutons
« Créer mon calendrier gratuit » (et remplace l'UTM interne `utm_source=noel` de la page).
Depuis ce kit, ils suivent aussi le lien « Autre règle ? Faire le calcul » vers l'outil
vacances, d'où le visiteur peut encore s'inscrire.

## Suivi dans PostHog

- [Entonnoir par annonce](https://eu.posthog.com/project/285303/insights/lxSdKRnu) :
  visiteurs → clic vers l'inscription → inscrits → onboarding terminé, par annonce.
  Étapes reliées sur le même navigateur ; sans consentement, le suivi ne dure que la
  journée : les étapes après le clic sont des minimums.
- [Inscriptions attribuées par annonce](https://eu.posthog.com/project/285303/insights/N3XCgdcV) :
  fiable même sans cookie, car l'attribution passe par l'URL.

Le 4 et le 9 décembre : reporter la dépense Meta par annonce à côté de ces chiffres.

## Avant de lancer (checklist)

- [ ] La PR de ce dossier est fusionnée et déployée (UTM transmis au lien vers l'outil).
- [ ] Sur un téléphone, **dans l'app Facebook ou Instagram** (s'envoyer le lien V1 en
      message puis l'ouvrir) : la page Noël s'affiche, le bouton « Créer mon calendrier
      gratuit » mène à l'inscription, et son URL contient `utm_campaign=noel-2026-meta`.
- [ ] Sur cette même page, les liens du bandeau cookies (« Gérer les cookies »,
      « Confidentialité », « Conditions générales ») répondent au premier appui : pendant
      la Toussaint, des visiteurs venus de la pub ont tapé plusieurs fois dessus.
- [ ] La page affiche bien **Noël 2026** (19 décembre → 3 janvier, passage dimanche 27).
- [ ] Annonces créées avec une **date de fin** (8 décembre, 23 h 59) et le **budget total**
      de 40 €.
- [ ] Commentaires sous les annonces : les surveiller chaque jour (sujet sensible) ;
      répondre sobrement, masquer les propos agressifs.

## Partage gratuit (groupes Facebook, WhatsApp)

Pour les groupes de parents, utiliser le lien **sans** UTM Meta :
`https://alternly.com/outils/noel-garde-alternee?utm_source=groupe&utm_medium=social&utm_campaign=noel-2026`.

## Fichiers

- `v1-feed.png`, `v1-story.png` : visuels de l'annonce V1.
- `src/visuel.html` : source des visuels ; `node src/render.mjs "$PWD"` depuis ce dossier
  pour les régénérer (Playwright + Chromium, polices de `../videos/src`).
- Vidéo de l'annonce V2 : `../videos/alternly-reel-noel-9x16.mp4`.
