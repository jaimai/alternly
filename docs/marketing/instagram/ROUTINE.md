# Routine Instagram (phase 2)

Ce sont les consignes que suivent les tâches planifiées de l'app Claude sur le Mac de Thomas.
Chaque tâche démarre sans mémoire : elle relit ce fichier, puis `README.md`, `ideas.yaml`,
`hashtags.yaml` et la stratégie (`../reseaux-sociaux/instagram-contenu-organique.md`).

## Règles communes

- Repo : `/Users/thomas/Documents/coparent`. Dossier de travail : `docs/marketing/instagram`.
- Branche : `claude/instagram-contenu-organique`, sur la PR jaimai/alternly#89.
  - Si le checkout est sur une autre branche ou contient des fichiers modifiés hors de `docs/marketing/instagram`, la tâche ne touche à rien. Elle prévient Thomas et s'arrête.
  - Sinon : `git pull --rebase`, puis le travail, puis un commit ciblé (`git add docs/marketing/instagram`) et un push.
- Tout est en français, au tutoiement côté Instagram. Le produit Alternly apparaît dans au plus 1 post sur 7.
- La tâche ne publie jamais rien sur Instagram et n'écrit jamais à personne. Elle prépare, et c'est Thomas qui poste.
- Elle finit toujours par un message court à Thomas : ce qui a été fait, ce qui attend sa réponse, les chemins des fichiers.

## 1. Veille (lundi et jeudi, 7 h)

1. Relire `veille/comptes.yaml` et le dernier `veille/tendances-*.md`.
2. Recherche web sur les deux dernières semaines : comptes coparentalité / parents séparés FR et anglophones, formats qui tournent (reels, carrousels), sons tendance, actualité (CAF, justice familiale, calendrier scolaire, fêtes à venir).
3. Lire les captures que Thomas a déposées dans `veille/captures/` depuis la dernière veille. On n'aspire pas les données d'Instagram.
4. Écrire `veille/tendances-AAAA-SXX.md` : constats, formats à copier, sons, sources avec liens.
5. Ajouter dans `ideas.yaml` les nouvelles idées et re-scorer le réservoir. Le score vaut preuve (0-4) + urgence (0-3) + pilier (0-2) + fraîcheur (0-1).

## 2. Production (chaque jour, 8 h) : les 2 posts de J+2

1. Date cible = aujourd'hui + 2 jours. Si `posts/<date>-midi-*` et `posts/<date>-soir-*` existent déjà, il n'y a rien à faire.
2. Choisir dans `ideas.yaml` les meilleures idées au statut `idee`, pour obtenir un carrousel à midi et un reel le soir.
   - Varier les piliers par rapport aux 3 derniers jours.
   - Respecter les dates : jours fériés, vacances, Noël.
3. Écrire chaque `post.yaml` en copiant la structure d'un post existant :
   - carrousel : 6 à 9 slides, couverture qui accroche, dernière slide en CTA commentaire ;
   - reel : 15 à 25 s, hook dans la première seconde, son suggéré dans `son:` ;
   - légende : accroche, valeur, question en fin de texte. `hashtags:` est un bloc de `hashtags.yaml` ;
   - `statut: a-relire`.
   - Sources : le blog (`/Users/thomas/Documents/coparent/web`, articles de blog), la veille, les commentaires.
4. Lancer `node scripts/build.mjs posts/<dossier>` pour chaque post.
5. Regarder les PNG et la couverture : un texte qui déborde, une coupure ou deux slides superposées sont à corriger, puis on relance le build.
6. Dans `ideas.yaml`, passer l'idée en `statut: planifie` et renseigner `post:`.
7. Commit `feat(instagram): posts du <date>` et push. Envoyer à Thomas la couverture de chaque post et les deux légendes.
8. Si Thomas a laissé des retours (commentaires dans un `post.yaml` sous `retours:`, ou `statut: a-corriger`), les appliquer d'abord, rebuild, puis repasser en `a-relire`.

## 3. Rappels de publication (11 h 45 et 20 h 15)

Pour le créneau en cours (midi ou soir) du jour, trouver `posts/<aujourd'hui>-<créneau>-*`.
- S'il existe : envoyer à Thomas le chemin de `out/`, la couverture et la légende complète (`out/caption.txt`), plus le son pour un reel. Rappeler de passer ensuite le statut à `publie`.
- S'il manque : prévenir Thomas.
- Pas de commit.

## 4. Rapport hebdo (lundi, 9 h)

1. Lire les captures de statistiques déposées dans `metrics/captures/` : portée, vues, likes, commentaires, enregistrements, partages, commentaires lisibles.
2. Ajouter une ligne par post dans `metrics/posts.csv`, colonnes `date,creneau,id,format,pilier,portee,vues,likes,commentaires,enregistrements,partages,score`.
   - score = (enregistrements × 3 + partages × 3 + commentaires × 2 + likes) / portée.
3. Écrire `metrics/rapports/AAAA-SXX.md` :
   - top 3 et flop 3, avec une hypothèse pour chacun ;
   - résultats par pilier, par format et par créneau ;
   - questions relevées dans les commentaires, et réponses proposées ;
   - 2 ou 3 décisions pour la semaine.
4. Transformer les questions des commentaires en idées dans `ideas.yaml`.
5. S'il n'y a aucune capture : demander à Thomas de déposer les statistiques des posts de la semaine, sans inventer de chiffres.
6. Commit et push.

## 5. Calendrier (le 1er du mois, 7 h 30)

Mettre à jour `calendrier.yaml` pour les deux mois suivants : vacances scolaires par zone, jours fériés, fêtes (fête des mères et des pères, rentrée, Saint-Valentin…), dates CAF et impôts. Ajouter les idées saisonnières dans `ideas.yaml`.

## Où Thomas dépose ses fichiers

- `veille/captures/` : profils concurrents (onglet Reels), pages de hashtags, écran « audio tendance ».
- `metrics/captures/` : les statistiques de nos posts.
- Retours sur un post : une ligne `retours:` dans son `post.yaml`, ou directement dans la conversation de la tâche.
