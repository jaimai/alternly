# Vidéos motion Alternly

| Fichier | Format | Durée | Usage |
|---|---|---|---|
| `alternly-reel-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels, Stories, TikTok, Shorts |
| `alternly-feed-4x5.mp4` | 1080×1350 (4:5) | 17 s | Fil Facebook / Instagram, LinkedIn |
| `alternly-reel-paires-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels FB / Insta (Toussaint, outil gratuit) |
| `alternly-reel-noel-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels FB / Insta (Noël) |

Muettes (lecture auto sans son sur Meta) : tout le message est à l'écran.
Ajoutez une musique libre de droits dans Meta / CapCut si besoin.

- **Reel** : « Qui a les enfants ce week-end ? » → messages qui s'emmêlent →
  calendrier d'octobre 2026 qui se remplit (semaine/semaine, Toussaint
  moitié/moitié, passage le dimanche 25) → échanges, dépenses, synchro → CTA.
- **Feed** : extrait de jugement surligné → 3 réglages → toute l'année
  2026-2027 (zone A) calculée → échange accepté, dépense → CTA.

- **Reel paires / impaires** : la règle « 1re moitié les années paires… » →
  2026 = année paire → résultat de l'outil pour la Toussaint (17 → 24 oct. /
  25 oct. → 1er nov., passage dim. 25, reprise lun. 2 nov.) → toutes les autres
  vacances → CTA outil gratuit.
- **Reel Noël** : « 24 décembre / 31 décembre : chez qui ? » → vacances du 19 déc.
  au 3 janv. → calendrier (19 → 26 chez Camille, 27 → 3 chez Alex, passage dim. 27)
  → l'an prochain c'est l'inverse + échange de jours → CTA.

Dates calculées avec le moteur de l'app (`vacation_tool.vacation_split`, moitié/moitié).

### Légendes à poster

Reel paires / impaires :

> « La première moitié les années paires, la seconde les années impaires »… Pour la
> Toussaint 2026, ça donne quoi ? 2026 est paire : 1re moitié du samedi 17 au samedi
> 24 octobre, passage le dimanche 25, reprise le lundi 2 novembre. Pour une autre
> règle ou une autre période, l'outil gratuit fait le calcul, sans inscription
> 👉 alternly.com/outils/vacances-garde-alternee
>
> #gardealternee #coparentalite #vacancesscolaires #toussaint2026 #parents

Reel Noël :

> 24 décembre, 31 décembre : cette année, c'est chez qui ? Vacances de Noël 2026 :
> du 19 décembre au 3 janvier, toutes zones. En moitié/moitié, passage le dimanche
> 27 décembre, et l'an prochain c'est l'inverse. Alternly calcule le calendrier de
> garde, vacances comprises, et le partage avec l'autre parent. Gratuit 👉 alternly.com
>
> #gardealternee #coparentalite #noel2026 #vacancesdenoel #parents

Lien en bio sur Instagram (les liens des légendes ne sont pas cliquables). Pour le
suivi PostHog, ajouter `?utm_source=instagram&utm_medium=social&utm_campaign=reels`
(ou `facebook`) au lien.

## Modifier et regénérer

Sources dans `src/` (HTML/CSS, polices de la marque). Chaque animation CSS est
figée et positionnée image par image : le rendu est déterministe.

```bash
cd docs/marketing/videos/src
npm i playwright            # Chromium déjà présent ou `npx playwright install chromium`
FFMPEG=/chemin/vers/ffmpeg node render.cjs v1-reel.html 1080 1920 15000 ../alternly-reel-9x16.mp4
FFMPEG=/chemin/vers/ffmpeg node render.cjs v2-feed.html 1080 1350 17000 ../alternly-feed-4x5.mp4
FFMPEG=/chemin/vers/ffmpeg node render.cjs v3-reel-paires.html 1080 1920 15000 ../alternly-reel-paires-9x16.mp4
FFMPEG=/chemin/vers/ffmpeg node render.cjs v4-reel-noel.html 1080 1920 15000 ../alternly-reel-noel-9x16.mp4
# aperçus : … sortie.mp4 30 --stills 2600,7000
```

`render.cjs` prend le navigateur dans `CHROME` (sinon le Chromium de Playwright
en dur), et `playwright` ou `playwright-core`. Sur Mac :
`CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
