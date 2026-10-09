// Retour de la page web d'Apple (Android). L'onglet de connexion récupère déjà le résultat
// (socialAuth.ts) ; si Android ouvre aussi ce lien dans l'app, on revient simplement en arrière.
import { router } from 'expo-router'
import { useEffect } from 'react'

export default function AppleCallback() {
  useEffect(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }, [])
  return null
}
