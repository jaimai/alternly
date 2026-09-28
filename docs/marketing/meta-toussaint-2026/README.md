# Test pub Meta — Toussaint 2026

**But** : savoir, pour 300 à 500 €, si Facebook/Instagram peut amener des parents qui
**s'inscrivent et posent leur règle de garde** à un coût acceptable. Ce n'est pas
une campagne de croissance : on arrête ou on continue sur des chiffres.

| | |
| --- | --- |
| Dates | du **mer. 1er au mar. 20 octobre 2026** (vacances : 17 oct → 2 nov, toutes zones) |
| Budget | **20 €/jour** (≈ 400 €), 1 campagne, 1 ensemble de publicités, 3 annonces |
| Page d'arrivée | l'outil gratuit `/outils/vacances-garde-alternee` (pas la page d'inscription) |
| Objectif Meta | **Trafic** → optimisation « vues de la page de destination » (pas de pixel pour ce test) |
| Mesure | PostHog, via les UTM (voir plus bas) |

## Critères de décision (au bout de 10 jours, puis à la fin)

| Mesure (PostHog) | Continuer | Couper |
| --- | --- | --- |
| Coût par inscription (dépense Meta ÷ inscriptions attribuées) | ≤ 10 € | > 15 € |
| Inscrits qui posent leur règle de garde | ≥ 40 % | < 20 % |
| Visiteurs qui font un calcul dans l'outil | ≥ 25 % | < 10 % (l'annonce attire les mauvaises personnes) |

À 10 jours : couper les annonces dont le coût par inscription dépasse 2× celui de la
meilleure, et remettre leur budget sur la gagnante.

## Ciblage

- **Lieu** : France métropolitaine.
- **Âge** : 28–50 ans, tous genres.
- **Audience** : *Advantage+ audience* (ciblage large). Pour guider l'algorithme,
  suggestions de centres d'intérêt : parentalité, éducation des enfants, école primaire.
  Ne pas cibler une situation familiale (« divorcé », « séparé ») : Meta limite ce type
  de ciblage et il n'est pas nécessaire, la créa fait le tri.
- **Placements** : Advantage+ (fil Facebook et Instagram, Stories, Reels). Chaque
  visuel existe en 4:5 (fil) et 9:16 (Stories/Reels).
- **Catégorie spéciale** : aucune (ni crédit, ni emploi, ni logement, ni politique).

## Les 3 annonces

Visuels dans ce dossier : `vX-feed.png` (1080×1350) et `vX-story.png` (1080×1920).
Dans Meta, créer chaque annonce avec les deux formats (« Personnaliser le visuel par
placement »).

Règle d'or de Meta : ne pas **affirmer ni sous-entendre** une situation personnelle du
lecteur (« Vous êtes séparé·e ? », « Votre ex… »). On parle de la **situation** (la garde
alternée, les vacances), jamais de la personne.

### V1 — « Chez qui ? » (question directe, résultat montré)
- **Texte principal** : Toussaint : du 17 octobre au 2 novembre. En garde alternée, qui a
  les enfants la première semaine ? Choisissez votre zone et votre règle de partage :
  l'outil gratuit donne les dates exactes et le jour du passage. Sans inscription.
- **Titre** : Qui a les enfants à la Toussaint ?
- **Description** : Outil gratuit · dates officielles
- **Bouton** : En savoir plus
- **Lien** : voir `v1-quiachezqui` plus bas

### V2 — « Fini les SMS » (douleur du quotidien)
- **Texte principal** : « Tu les prends quand pour la Toussaint ? » Pour éviter les
  échanges de messages à chaque vacances : un calendrier de garde partagé entre les deux
  parents, avec les vacances scolaires déjà calculées. Commencez par l'outil gratuit.
- **Titre** : Garde alternée : un seul calendrier
- **Description** : Gratuit · vacances scolaires incluses
- **Bouton** : En savoir plus
- **Lien** : voir `v2-sms`

### V3 — « Années paires / impaires » (casse-tête du jugement)
- **Texte principal** : « Première moitié les années paires, seconde moitié les années
  impaires »… Pour la Toussaint 2026, ça donne quoi ? L'outil gratuit applique la règle
  de votre jugement ou de votre convention et vous donne les dates exactes.
- **Titre** : Paires, impaires : faites le calcul
- **Description** : Gratuit · sans inscription
- **Bouton** : En savoir plus
- **Lien** : voir `v3-paires`

## Liens (à coller tels quels dans « URL du site web »)

Tous pointent vers l'outil avec la Toussaint 2026 déjà sélectionnée.

| Annonce | URL |
| --- | --- |
| V1 | `https://alternly.com/outils/vacances-garde-alternee?vacances=toussaint-2026&utm_source=facebook&utm_medium=paid_social&utm_campaign=toussaint-2026-meta&utm_content=v1-quiachezqui` |
| V2 | `https://alternly.com/outils/vacances-garde-alternee?vacances=toussaint-2026&utm_source=facebook&utm_medium=paid_social&utm_campaign=toussaint-2026-meta&utm_content=v2-sms` |
| V3 | `https://alternly.com/outils/vacances-garde-alternee?vacances=toussaint-2026&utm_source=facebook&utm_medium=paid_social&utm_campaign=toussaint-2026-meta&utm_content=v3-paires` |

`utm_source=facebook` couvre aussi Instagram. Pour distinguer les deux, remplacer
`utm_source=facebook` par `utm_source={{site_source_name}}` (paramètre dynamique Meta : fb, ig…).

Ces UTM suivent le visiteur jusqu'à l'inscription : le site les ajoute aux liens
« Créer mon calendrier », et ils **remplacent** les UTM internes de l'outil (correctif
livré avec ce dossier).

## Suivi dans PostHog

- [Entonnoir par annonce](https://eu.posthog.com/project/285303/insights/Rt8SSuz3) :
  visiteurs → calcul fait → clic inscription → inscrits → règle posée, par variante.
  Les étapes sont reliées sur le même navigateur. Sans consentement, le suivi ne dure
  que la journée : les chiffres des étapes suivantes sont donc des minimums.
- [Inscriptions attribuées par annonce](https://eu.posthog.com/project/285303/insights/BRHckQXH) :
  le chiffre qui compte pour le coût par inscription. Il est fiable même sans cookie,
  car l'attribution passe par l'URL.

Chaque lundi : reporter la dépense Meta par annonce à côté des inscriptions attribuées.

## Avant de lancer (checklist)

- [ ] La PR de ce dossier est fusionnée et déployée : correctif UTM et image d'aperçu de l'outil.
- [ ] Dans le navigateur, ouvrir le lien V1 → faire un calcul → cliquer « Créer mon
      calendrier » : l'URL d'inscription doit contenir `utm_source=facebook` (et plus `outil`).
- [ ] Page Facebook « Alternly » créée (photo = logo, lien alternly.com), rattachée
      au compte publicitaire.
- [ ] Moyen de paiement ajouté dans le Gestionnaire de publicités, en euros, fuseau Europe/Paris.
- [ ] Vérifier les dates de la Toussaint 2026 sur le visuel V1 (17 oct → 2 nov) avant
      diffusion, et que l'outil affiche bien la période.
- [ ] Commentaires sous les annonces : les surveiller chaque jour (sujet sensible) ;
      répondre sobrement, masquer les propos agressifs.

## Aperçu de partage (groupes Facebook, WhatsApp)

L'outil a maintenant sa propre image d'aperçu (`/static/og-outil-vacances.png`,
1200×630). Pour le partage organique dans des groupes de parents, utiliser le lien
de l'outil **sans** UTM Meta, ou avec `utm_source=groupe&utm_medium=social&utm_campaign=toussaint-2026`.
