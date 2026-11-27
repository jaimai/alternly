# Profils Facebook et Instagram

## Facebook

### Photo de couverture

`facebook-couverture-1640x856.png` (1640×856). Ce format convient aux deux affichages :
sur ordinateur, Facebook rogne environ 116 px en haut et en bas ; sur mobile, environ
59 px à gauche et à droite. Le texte et le calendrier restent dans la zone visible
dans les deux cas.

Photo de profil : `../brand/alternly-logo-icone-1080.png`.

### Intro (101 caractères max, affichée sous le nom de la page)

> Le calendrier de garde alternée partagé entre les deux parents, vacances scolaires comprises.

### Description (onglet « À propos »)

> Alternly, c'est le calendrier de garde partagée pensé pour la France.
>
> Vous choisissez votre rythme (semaine/semaine, 2-2-3, un week-end sur deux ou sur
> mesure) et Alternly calcule toute l'année, vacances scolaires officielles des zones
> A, B et C comprises, avec le partage années paires / années impaires.
>
> L'autre parent rejoint le calendrier gratuitement et voit ses jours à l'avance. Les
> échanges de jours se demandent et s'acceptent dans l'app, les dépenses partagées se
> suivent au même endroit, et tout se synchronise avec Google Agenda ou le Calendrier
> d'Apple.
>
> Moins de messages, moins de malentendus, plus de temps pour les enfants.
>
> Gratuit pour commencer 👉 alternly.com

- **Catégorie** : Application (Logiciel), ou Service à la famille
- **Site web** : `https://alternly.com/?utm_source=facebook&utm_medium=social&utm_campaign=page`

## Instagram

- **Nom** (le champ est pris en compte par la recherche) : `Alternly · Garde alternée`
- **Bio** (150 caractères max) :

```
Le calendrier de garde alternée, partagé entre les deux parents 🗓️
Vacances scolaires A/B/C comprises · échanges · dépenses
Gratuit pour commencer 👇
```

- **Lien** : `https://alternly.com/?utm_source=instagram&utm_medium=social&utm_campaign=bio`

## Regénérer la couverture

Source : `src/facebook-cover.html`. Elle utilise les polices de `../videos/src/`.

```bash
cd docs/marketing/reseaux-sociaux
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=1640,856 \
  --virtual-time-budget=3000 --screenshot="$PWD/facebook-couverture-1640x856.png" \
  "file://$PWD/src/facebook-cover.html"
```
