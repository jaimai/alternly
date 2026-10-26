# App Store — visuels « En-tête » et « Résultats de recherche » (FR)

Ressources de la fiche App Store (App Store Connect › page produit), selon les
[spécifications d'Apple](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/) :

| Fichier | Emplacement | Format Apple |
| --- | --- | --- |
| `alternly-entete-3840x1646.png` | En-tête | 21:9, 3840 × 1646 px |
| `alternly-entete-5244x2950.png` | En-tête **ou** résultats de recherche (format « universel ») | 16:9, 5244 × 2950 px, PNG |
| `alternly-recherche-3840x2560.png` | Résultats de recherche | 3:2, de 1920 × 1280 à 3840 × 2560 px |

Règles d'Apple respectées : pas de transparence, pas de prix, d'URL, de logo d'une
autre plateforme ni de distinction Apple ; l'essentiel au centre (recadrage selon
l'appareil). Vérifier le rendu avec « Aperçu » dans App Store Connect.

Source : `entete.html` (`?layout=wide233`, `wide169` ou `search32` ; polices de
`backend/app/static/fonts`, icône de `../brand`). Régénérer depuis ce dossier :
`node render.mjs "$PWD"` (Playwright + Chromium), puis recadrer à la taille exacte
si Chromium arrondit d'un pixel.
