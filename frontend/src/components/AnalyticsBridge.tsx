import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api'
import { initAnalytics, setIdentity, trackPageview } from '../analytics'
import { useAuth } from '../auth'
import { useConsent } from './useConsent'

/**
 * Relie l'app à PostHog : pages vues à chaque changement de route, identité du
 * compte connecté (seulement avec consentement, sans e-mail ni nom) et
 * synchronisation du choix de consentement avec le compte (users.analytics_consent).
 */
export default function AnalyticsBridge() {
  const location = useLocation()
  const { user, household, billing, setUser } = useAuth()
  const consent = useConsent()

  useEffect(() => {
    initAnalytics()
  }, [])

  // Page vue SPA (le chemin suffit : les paramètres ne changent pas de page).
  useEffect(() => {
    trackPageview()
  }, [location.pathname])

  // Identité : propriétés de personne et groupe « household » (aucune donnée d'identification).
  useEffect(() => {
    if (!user) {
      setIdentity(null)
      return
    }
    const realMembers = household?.members.filter((m) => !m.is_placeholder).length ?? 0
    setIdentity({
      userId: user.id,
      person: {
        locale: user.locale,
        auth_method: user.auth_method ?? 'email',
        created_at: user.created_at ?? null,
        country: household?.country ?? null,
        has_household: Boolean(household),
        subscription_status: billing?.status ?? null,
        is_premium: billing?.access ?? null,
      },
      household: household
        ? {
            id: household.id,
            props: {
              country: household.country,
              zone: household.country === 'FR' ? household.school_zone : null,
              members_count: realMembers,
              children_count: household.children.length,
              premium: billing?.access ?? null,
            },
          }
        : undefined,
    })
  }, [user, household, billing])

  // Le choix fait sur cet appareil est reporté sur le compte (événements serveur).
  const syncing = useRef(false)
  useEffect(() => {
    if (!user || consent === null || syncing.current) return
    const wanted = consent === 'granted'
    if (user.analytics_consent === wanted) return
    syncing.current = true
    api
      .updateMe({ analytics_consent: wanted })
      .then(setUser)
      .catch(() => {})
      .finally(() => {
        syncing.current = false
      })
  }, [user, consent, setUser])

  return null
}
