# Instagram Alternly — la fabrique

Plan d'ensemble : [`../reseaux-sociaux/pipeline-contenu-automatise.md`](../reseaux-sociaux/pipeline-contenu-automatise.md).
Règles éditoriales : [`../reseaux-sociaux/instagram-contenu-organique.md`](../reseaux-sociaux/instagram-contenu-organique.md).

## Poster un post (phase 1, manuel)

Chaque dossier `posts/AAAA-MM-JJ-(midi|soir)-sujet/` contient dans `out/` :

- carrousel : `slide-1.png` … (1080×1350) ;
- reel : `reel.mp4` (1080×1920, piste audio muette) + `couverture.png` ;
- `caption.txt` : légende + hashtags, à copier telle quelle.

Créneaux : **12 h** (carrousel) et **20 h 30** (reel). Pour les reels, ajouter dans
Instagram le son indiqué par `son:` dans `post.yaml`. Après publication, passer
`statut: publie` dans `post.yaml`.

## Fabriquer / modifier

```bash
cd docs/marketing/instagram
npm i                       # une fois
node scripts/build.mjs      # reconstruit les posts dont post.yaml a changé
node scripts/build.mjs posts/2026-11-05-midi-noel-2026 --force
```

Prérequis : Google Chrome et `ffmpeg` (Homebrew). Autre navigateur : `CHROME=/chemin`.

- `post.yaml` : tout le contenu. Les layouts disponibles sont décrits en tête de
  `scripts/templates/carrousel.mjs` et `scripts/templates/reel.mjs`.
  Dans les textes : `*italique terracotta*`, `**gras**`.
- `hashtags.yaml` : blocs de hashtags (`hashtags: vacances` dans `post.yaml`, `hashtags_extra` pour en ajouter).
- `ideas.yaml` : réservoir d'idées scorées.
- `veille/` : comptes suivis, veille hebdomadaire concurrents + tendances.
