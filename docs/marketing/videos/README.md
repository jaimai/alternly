# Vidéos motion Alternly

| Fichier | Format | Durée | Usage |
|---|---|---|---|
| `alternly-reel-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels, Stories, TikTok, Shorts |
| `alternly-feed-4x5.mp4` | 1080×1350 (4:5) | 17 s | Fil Facebook / Instagram, LinkedIn |
| `alternly-reel-paires-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels FB / Insta (Toussaint, outil gratuit) |
| `alternly-reel-noel-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels FB / Insta (Noël) |
| `alternly-reel-echange-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels FB / Insta, **avec son** |
| `alternly-reel-depenses-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels FB / Insta, **avec son** |
| `alternly-reel-rythmes-9x16.mp4` | 1080×1920 (9:16) | 15 s | Reels FB / Insta, **avec son** |

Les trois Reels « échange », « dépenses » et « rythmes » ne sont pas versionnés
(fichiers lourds) : regénérez-les depuis `src/` (commandes plus bas).

Tout le message est à l'écran (lecture auto sans son sur Meta). Les trois Reels
« échange », « dépenses » et « rythmes » ont une bande-son : musique originale de
synthèse et bruitages calés sur l'animation (`src/audio.py`), sans droits à gérer,
mixée à −14 LUFS. Les autres sont muettes : ajoutez une musique dans Meta / CapCut.

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

- **Reel échange** (sans saison) : 14 SMS pour échanger un mercredi → « Ou en un
  clic » → Camille propose l'échange dans l'app → Alex reçoit la notification et
  accepte → le calendrier se met à jour pour les deux → CTA (gratuit pour les deux parents).
- **Reel dépenses** : tickets (lunettes 189 €, foot 120 €, cantine 64 €) → « qui doit
  combien ? » → le solde se recalcule à chaque dépense (Alex doit 66,50 € à Camille,
  partage 50/50) → contester, marquer remboursée, répartition au choix → CTA
  (les dépenses sont dans l'abonnement, c'est indiqué).
- **Reel rythmes** : « Semaine/semaine ? 2-2-3 ? Un week-end sur deux ? » → le même
  cycle de 2 semaines bascule entre les 4 rythmes de l'app (cycles identiques au
  moteur) → appliqué à toute l'année → CTA.

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

Reel échange :

> Échanger un mercredi ne devrait pas prendre 14 messages. Dans Alternly, un parent
> propose l'échange, l'autre accepte en un clic, et le calendrier est à jour pour
> les deux. Gratuit 👉 alternly.com
>
> #gardealternee #coparentalite #parents #organisationfamiliale #calendrierpartage

Reel dépenses :

> Lunettes, licence de foot, cantine… Qui a avancé quoi, et qui doit combien ?
> Notez chaque dépense des enfants : le solde se calcule tout seul, en 50/50 ou selon
> la part prévue entre vous. 👉 alternly.com
>
> #gardealternee #coparentalite #depensesenfants #parents #budgetfamille

Reel rythmes :

> Semaine/semaine, 2-2-3, un week-end sur deux ou un rythme bien à vous : Alternly
> l'applique à toute l'année, vacances comprises, dans un calendrier partagé.
> Gratuit, sans carte bancaire 👉 alternly.com
>
> #gardealternee #coparentalite #residencealternee #parents #organisationfamiliale

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
# bande-son (numpy + ffmpeg) : remplace la piste son de la vidéo
FFMPEG=/chemin/vers/ffmpeg python3 audio.py v5-reel-echange.html ../alternly-reel-echange-9x16.mp4
# aperçus : … sortie.mp4 30 --stills 2600,7000
```

`render.cjs` prend le navigateur dans `CHROME` (sinon le Chromium de Playwright
en dur), et `playwright` ou `playwright-core`.

La bande-son se règle dans chaque page, bloc `<script type="application/json"
id="audio">` : tempo, grille d'accords, entrée de la batterie et liste des
bruitages `[ms, nom, gain]` (pop, tap, tick, whoosh, ding, success, coin, riser,
paper). Pour une musique tendance Instagram à la place, publiez la vidéo et baissez
le son d'origine dans l'éditeur Reels. Sur Mac :
`CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
