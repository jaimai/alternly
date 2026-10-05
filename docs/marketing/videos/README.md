# Vidéos motion Alternly

| Fichier | Format | Durée | Usage |
|---|---|---|---|
| `alternly-reel-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels, Stories, TikTok, Shorts |
| `alternly-feed-4x5.mp4` | 1080×1350 (4:5) | 17 s | Fil Facebook / Instagram, LinkedIn |

Muettes (lecture auto sans son sur Meta) : tout le message est à l'écran.
Ajoutez une musique libre de droits dans Meta / CapCut si besoin.

- **Reel** : « Qui a les enfants ce week-end ? » → messages qui s'emmêlent →
  calendrier d'octobre 2026 qui se remplit (semaine/semaine, Toussaint
  moitié/moitié, passage le dimanche 25) → échanges, dépenses, synchro → CTA.
- **Feed** : extrait de jugement surligné → 3 réglages → toute l'année
  2026-2027 (zone A) calculée → échange accepté, dépense → CTA.

## Modifier et regénérer

Sources dans `src/` (HTML/CSS, polices de la marque). Chaque animation CSS est
figée et positionnée image par image : le rendu est déterministe.

```bash
cd docs/marketing/videos/src
npm i playwright            # Chromium déjà présent ou `npx playwright install chromium`
FFMPEG=/chemin/vers/ffmpeg node render.cjs v1-reel.html 1080 1920 15000 ../alternly-reel-9x16.mp4
FFMPEG=/chemin/vers/ffmpeg node render.cjs v2-feed.html 1080 1350 17000 ../alternly-feed-4x5.mp4
# aperçus : … sortie.mp4 30 --stills 2600,7000
```

`render.cjs` utilise le Chromium de Playwright via `executablePath` : adaptez le
chemin à votre machine.
