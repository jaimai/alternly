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
marketing/instagram/
  ideas.yaml                  # backlog d'idées scorées
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

Sources que Claude exploite pour remplir `ideas.yaml` :

1. **Le blog** (`content/blog/*.md`) : chaque article donne 5 à 10 posts (une section = un carrousel, une astuce = un reel).
2. **Le calendrier** : vacances par zone, Noël, fête des mères / pères, rentrée, Saint-Valentin (« première Saint-Valentin après la séparation »), déclaration d'impôts (enfants à charge en alternée)…
3. **Les commentaires et DM** : chaque question posée en commentaire devient un post (« vous nous avez demandé… »), le format qui crée le plus de fidélité.
4. **Les formats qui marchent** : l'analyse hebdo (étape 6) double les formats et piliers gagnants.
5. **Veille** : captures de posts qui cartonnent chez d'autres comptes (fournies par Thomas, ou trouvées par recherche web), pour reprendre la *structure*, jamais le contenu.

Chaque idée reçoit un score : `saison (urgence) + performance du pilier + fraîcheur (pas de doublon récent)`.

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
- **Limite honnête** : les reels face caméra (POV, question sincère) ont besoin d'un humain. Claude écrit le script, le texte à l'écran et la légende ; Thomas filme 10 s au téléphone, et Claude ajoute le texte et la mise en forme à partir du fichier vidéo. Objectif : max 2 par semaine, le reste en motion design.

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
- 2-3 comptes Instagram que vous aimez (ton / format) comme références.
- Phase 3 : accès développeur Meta (Claude guide la création de l'app pas à pas, mais c'est Thomas qui saisit ses identifiants).
