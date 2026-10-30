# Pipeline Instagram automatisé — de l'idée au post, puis à l'analyse

Objectif : **2 posts par jour** (14 / semaine), produits de bout en bout par Claude.
Thomas ne fait que : relire et valider (2 min/post), publier à la main tant que l'API
n'est pas branchée, et fournir de temps en temps des captures ou des infos.

```
 ┌─────────┐   ┌───────────┐   ┌────────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐
 │ 1. IDÉES│ → │ 2. BRIEF  │ → │ 3. RENDU   │ → │4. REVUE │ → │5. POST   │ → │6. ANALYSE│
 │ backlog │   │ post.yaml │   │ PNG / MP4  │   │ Thomas  │   │ manuel → │   │ stats +  │
 │ scoré   │   │ + légende │   │ templates  │   │ ✅ / ✏️  │   │ API Meta │   │ coms     │
 └────▲────┘   └───────────┘   └────────────┘   └─────────┘   └──────────┘   └────┬─────┘
      └──────────────────────── les résultats re-scorent le backlog ─────────────────┘
```

---

## 1. Organisation dans le repo

```
docs/marketing/instagram/
  ideas.yaml                  # backlog d'idées scorées
  veille/                     # comptes suivis, posts concurrents relevés, tendances de la semaine
  calendrier.yaml             # dates clés (vacances, fêtes, rentrée, fête des pères…)
  templates/
    carrousel/                # 6-8 mises en page HTML pilotées par des données
      couverture.html  liste.html  comparatif.html  citation.html  dates.html  cta.html
    reel/                     # reels « motion design » rendus avec videos/src/render.cjs
      texte-cinetique.html  avant-apres.html  liste-rapide.html  pov.html  calendrier.html
  posts/
    2026-11-03-am-noel-2026/
      post.yaml               # type, slides (texte), légende, hashtags, statut, créneau
      out/slide-1.png …       # ou out/reel.mp4 + cover.png
      caption.txt             # légende + hashtags, prête à copier
  metrics/
    posts.csv                 # une ligne par post : portée, enregistrements, partages, coms…
    commentaires.jsonl        # commentaires récupérés (texte, date, post)
    rapports/2026-S45.md      # rapport hebdo
  scripts/
    build.mjs                 # post.yaml → PNG / MP4 + caption.txt
    publish.mjs               # (phase 3) publication via l'API Instagram
    fetch-metrics.mjs         # (phase 3) stats + commentaires via l'API
```

Le point clé : **on n'écrit plus de HTML à la main pour chaque post**. Claude écrit un
`post.yaml` (contenu), et `build.mjs` le pose dans un template de la charte Alternly.
C'est ce qui rend 14 posts / semaine réalistes et toujours cohérents visuellement.

Exemple de `post.yaml` :

```yaml
id: 2026-11-03-am-noel-2026
format: carrousel            # carrousel | reel
creneau: 2026-11-03 12:00
pilier: vacances             # vacances | communication | organisation | argent | juridique | emotion | produit
source: content/blog/vacances-noel-2026-garde-alternee.md
slides:
  - { layout: couverture, kicker: Garde alternée, titre: "Noël 2026 : qui a *les enfants ?*" }
  - { layout: dates, debut: 19 déc., fin: 4 janv. }
  - …
legende: |
  Noël approche et la question tombe chaque année…
hashtags: bloc-vacances
statut: a-relire              # idee | a-relire | valide | publie
```

---

## 2. Étape par étape

### Étape 1 — Idées (automatique)

Sources que Claude exploite pour remplir `ideas.yaml`, de la plus forte à la plus faible :

1. **Concurrents : refaire ce qui marche déjà** (voir « Veille » ci-dessous). Un post qui a fait 10× la moyenne d'un compte du même sujet est une idée validée par le public : on reprend le **sujet, l'accroche et la structure**, avec nos propres mots, notre charte et nos sources. Jamais de copie de texte ou de visuel.
2. **La vague du moment** : sons et formats de reels en tendance, mèmes, actualité (réforme de la pension, calendrier scolaire publié, affaire médiatisée, saison). On colle un trend à un sujet coparentalité dans les **48-72 h**, après c'est trop tard.
3. **Hashtags qui montent** : les meilleurs posts des hashtags cibles indiquent quels sujets prennent en ce moment.
4. **Le calendrier** : vacances par zone, Noël, fête des mères / pères, rentrée, Saint-Valentin (« première Saint-Valentin après la séparation »), impôts (enfants à charge en alternée)…
5. **Les commentaires et DM** : chaque question posée devient un post (« vous nous avez demandé… »).
6. **Le blog** (`content/blog/*.md`) : il sert surtout à **vérifier les faits** et à donner de la profondeur aux carrousels, et à combler les trous du planning.

Chaque idée reçoit un score : `preuve de performance (concurrent / tendance) + urgence (tendance, saison) + performance de notre pilier + fraîcheur`.

#### Veille concurrents, hashtags et tendances

Fichiers : `veille/comptes.yaml` (liste suivie), `veille/posts.csv` (posts relevés), `veille/tendances.md` (la semaine).

- **Comptes suivis** (15-30) : comptes coparentalité FR et EN (les tendances US arrivent en France avec quelques semaines de retard), avocats en droit de la famille, médiateurs familiaux, psys enfants, comptes « maman/papa solo », applis concurrentes (2houses, OurFamilyWizard, Cozi, TimeTree…). Première liste construite par Claude par recherche web, puis complétée par Thomas.
- **Ce qu'on relève par post** : format, sujet, accroche (slide 1 / 1re seconde), nombre de slides, durée, likes, commentaires, vues, date. On calcule un **ratio de surperformance** = engagement du post / moyenne du compte. Ce sont les posts au-dessus de ×3 qui nous intéressent.
- **Comment on récupère les données** :
  - *Phase 1* : recherche web + captures envoyées par Thomas (profil d'un concurrent trié par vues, onglet Reels, page d'un hashtag, écran « audio tendance »). Claude lit les captures et remplit `veille/posts.csv`.
  - *Phase 3* : **API Instagram officielle**, `business_discovery` (posts publics, likes et commentaires des comptes pro concurrents) et recherche de hashtags (`top_media` / `recent_media`, 30 hashtags différents par semaine). Pas de scraping : c'est contraire aux conditions d'Instagram et ça fait risquer le blocage du compte.
- **Hashtags** : chaque semaine, on regarde les meilleurs posts de nos ~30 hashtags cibles, on repère les hashtags qui reviennent chez les posts performants et ceux qui stagnent. Les blocs de hashtags sont mis à jour, et notre propre rapport mesure la portée apportée par les hashtags.
- **Tendances** : sons et formats en tendance (écran « audio tendance » d'Instagram envoyé par Thomas, ou classements publiés chaque semaine sur le web), actualité famille / justice / école. Une tendance validée part en **production express**, posté sous 48 h, et passe devant le planning.
- **Rendu** : la veille alimente la section « Concurrents & tendances » du rapport hebdo (top 10 des posts de la semaine dans la niche et ce qu'on en tire).

**Mix quotidien** : 1 carrousel (créneau midi) + 1 reel (créneau 20 h 30). Sur la semaine :
5 piliers utiles, 1 émotion / relatable, 1 produit (montrer Alternly en solution).

### Étape 2 — Brief (automatique)

Claude écrit `post.yaml` : texte des slides ou script du reel, légende (accroche,
valeur, question, CTA), bloc de hashtags. Règles reprises de
`instagram-contenu-organique.md`. Vérification des faits sur l'article source
(dates, règles juridiques).

### Étape 3 — Rendu (automatique)

- **Carrousels** : templates HTML → PNG 1080×1350 avec Chrome headless (méthode déjà utilisée).
- **Reels** : templates animés HTML → MP4 1080×1920 avec `docs/marketing/videos/src/render.cjs`, + couverture PNG. Musique : choisie dans l'app Instagram au moment de poster (les sons tendance ne sont pas utilisables hors de l'app).
- **Captures de l'app** : pour les posts « produit », Claude prend les captures lui-même dans le simulateur iOS ou dans l'app web (`mobile/assets/screen/` existe déjà).
- **Reels 100 % sans face cam**, réalisés entièrement par Claude :
  - **Motion design** : texte cinétique, listes animées, avant / après, calendrier qui se remplit, « mythe / réalité », compte à rebours (Noël J-30…), conversations SMS animées (le message énervé vs le message BIFF).
  - **Texte sur vidéo d'ambiance** : plans neutres libres de droits (Pexels, Pixabay : sac d'enfant, voiture, porte d'école, cuisine, mains) avec le texte du hook et des étapes par-dessus. C'est le format « POV » des comptes sans visage.
  - **Écran de l'app** : enregistrements du simulateur iOS ou de l'app web, pour les posts produit.
  - **Voix off** optionnelle par synthèse vocale française (à tester : elle augmente le temps de visionnage mais doit sonner naturelle).
  Les reels POV et « question sincère » du plan éditorial sont adaptés en version texte à l'écran.

### Étape 4 — Revue (Thomas, 2 min)

Chaque matin, Claude produit **les posts de J+2** (un jour d'avance pour corriger
tranquillement) et envoie une planche contact + les légendes. Thomas répond ✅ ou
« slide 3 : changer X ». Statut `valide` → prêt à poster.

### Étape 5 — Publication

- **Phase 1 (manuel)** : dossier `posts/…/out` + `caption.txt`. Pour poster depuis le téléphone : un dossier iCloud Drive / Google Drive synchronisé, ou l'envoi des fichiers sur le téléphone. Programmation possible directement dans l'app Instagram ou dans Meta Business Suite (gratuit, programme carrousels et reels).
- **Phase 3 (automatique)** : **API Instagram (Graph API)**, `publish.mjs`.
  - Pré-requis : compte Instagram **professionnel**, lié à la **page Facebook** Alternly, une **app Meta** avec les permissions `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_comments`, et un token longue durée.
  - L'API récupère les médias par **URL publique** : on les héberge sur alternly.com (route statique du backend sur Railway, ou bucket Railway).
  - Carrousels (jusqu'à 10 images) et reels sont supportés, plafond 100 posts / 24 h.
  - Lancement par une tâche planifiée aux heures des créneaux, uniquement pour les posts `valide`.
  - Limite : on ne peut pas ajouter de son tendance via l'API. Pour les reels où le son compte, on garde la publication manuelle.

### Étape 6 — Analyse et amélioration

- **Phase 1** : chaque dimanche, Thomas envoie les captures des statistiques Instagram (onglet « Statistiques » de chaque post, ou l'export de Meta Business Suite). Claude les lit, remplit `metrics/posts.csv`, lit les commentaires visibles sur les captures.
- **Phase 3** : `fetch-metrics.mjs` récupère automatiquement par post la portée, les vues, les likes, les commentaires, les **enregistrements**, les partages, et le texte des commentaires.
- **Rapport hebdo** (`metrics/rapports/2026-SXX.md`) :
  - top 3 / flop 3, avec une hypothèse sur la cause (accroche, sujet, format, horaire) ;
  - score d'engagement = (enregistrements × 3 + partages × 3 + commentaires × 2 + likes) / portée ;
  - performance par pilier, format, créneau, bloc de hashtags ;
  - questions et objections relevées dans les commentaires → nouvelles idées dans `ideas.yaml` ;
  - 2-3 décisions pour la semaine suivante (ex. « reels liste > POV, passer à 4 / semaine »).
- **Commentaires** : Claude propose des réponses (ton Alternly, jamais de pitch). Thomas les colle, puis en phase 3 elles partent via l'API après validation.

---

## 3. Automatisation (qui lance quoi)

| Quand | Tâche planifiée Claude | Sortie |
|---|---|---|
| Lundi et jeudi, 7 h | Veille concurrents + hashtags + tendances, re-scoring du backlog | `veille/tendances.md`, idées express |
| Chaque jour, 8 h | Produire les 2 posts de J+2 (idée → brief → rendu) | Planche contact + légendes à valider |
| Créneaux 12 h / 20 h 30 | Phase 1 : rappel « à poster » avec les fichiers. Phase 3 : publication API | Post en ligne |
| Lundi, 9 h | Rapport hebdo + nouvelles idées + re-scoring | `rapports/AAAA-SXX.md` |
| 1er du mois | Mise à jour du calendrier (vacances, fêtes du mois suivant) | `calendrier.yaml` |

Les tâches tournent **en local sur le Mac** (tâches planifiées de l'app Claude), parce
que le rendu a besoin de Chrome, des polices et du repo. Le Mac doit être allumé.
Sinon, plus tard, on bascule le rendu dans un conteneur Railway.

---

## 4. Feuille de route

| Phase | Contenu | Durée |
|---|---|---|
| **1. Fabrique** | Templates carrousel + reel, `post.yaml`, `build.mjs`, backlog des ~100 premières idées tirées du blog, 1re semaine produite (14 posts) | 2-3 sessions |
| **2. Routine** | Tâches planifiées (production quotidienne, rappels, rapport hebdo à partir des captures) | 1 session |
| **3. API Meta** | App Meta, hébergement des médias, `publish.mjs`, `fetch-metrics.mjs`, réponses aux commentaires | 1-2 sessions + validation de l'app côté Meta |
| **4. Optimisation** | Tests A/B d'accroches et de créneaux, recyclage des meilleurs posts (un carrousel gagnant devient un reel) | continu |

## 5. Ce dont Claude a besoin de Thomas

- **Tout de suite** : le compte Instagram est-il déjà **professionnel** et lié à la page Facebook ? (Ça conditionne la phase 3.)
- Les stats des reels « pub » déjà postés (captures), comme point de départ.
- Les comptes concurrents ou inspirants que vous connaissez déjà (Claude complète la liste).
- De temps en temps, des captures des profils concurrents (onglet Reels), des pages de hashtags et de l'écran « audio tendance », tant que l'API n'est pas branchée.
- Phase 3 : accès développeur Meta (Claude guide la création de l'app pas à pas, mais c'est Thomas qui saisit ses identifiants).
