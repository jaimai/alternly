#!/usr/bin/env bash
# « Ignored Build Step » Vercel (ignoreCommand de vercel.json), lancé depuis frontend/.
# Code de sortie 0 = NE PAS construire, 1 = construire.
# On ne construit que si frontend/ (ou le futur code partagé) a changé depuis le dernier
# déploiement réussi de cette branche : un push dans mobile/, backend/ ou docs/ ne
# redéploie pas le web. Dans le doute, on construit.
set -u

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
# Premier déploiement de la branche : pas de référence.
if [ -z "$base" ]; then
  echo "Pas de déploiement précédent : build."
  exit 1
fi
# Commit absent du clone superficiel de Vercel : impossible de comparer.
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Commit ${base} introuvable dans le clone : build."
  exit 1
fi
if git diff --quiet "$base" HEAD -- . ../packages/shared; then
  echo "Aucun changement dans frontend/ depuis ${base} : build ignoré."
  exit 0
fi
echo "frontend/ (ou code partagé) modifié depuis ${base} : build."
exit 1
