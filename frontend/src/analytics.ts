/**
 * Mesure d'audience et analytics produit (PostHog, région UE) avec consentement.
 *
 * - Sans VITE_POSTHOG_KEY (dev, tests) : tout est no-op, posthog-js n'est pas chargé.
 * - Avant réponse à la bannière, ou après refus : mesure anonyme « cookieless »
 *   (cookieless_mode: 'on_reject' + opt_out_capturing_by_default) — aucun cookie,
 *   aucun stockage, aucun identifiant persistant, pas de profil ni de replay.
 * - Après acceptation : persistance localStorage+cookie, identification du compte
 *   (id uniquement, jamais e-mail ni nom), replay de session avec saisies masquées.
 * - Choix mémorisé sous `alternly_consent` ({value, at}), partagé avec le site
 *   marketing (même origine) ; redemandé au bout de 13 mois (CNIL).
 *
 * posthog-js est chargé à la demande (import dynamique) : hors du bundle initial.
 */
import type { CaptureResult, PostHog, Properties } from 'posthog-js'
import type { AnalyticsEvent } from './analyticsEvents'

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
// Proxy inverse Vercel (/ingest → eu.i.posthog.com) : évite les bloqueurs de pub.
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || '/ingest'

export const analyticsEnabled = Boolean(KEY)

export type Consent = 'granted' | 'denied'
export const CONSENT_KEY = 'alternly_consent'
/** 13 mois (durée maximale de validité d'un choix recommandée par la CNIL). */
const CONSENT_MAX_AGE_MS = 395 * 24 * 3600 * 1000

// ---------------------------------------------------------------- consentement

function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { value?: string; at?: number }
    if (parsed.value !== 'granted' && parsed.value !== 'denied') return null
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > CONSENT_MAX_AGE_MS) return null
    return parsed.value
  } catch {
    return null
  }
}

let consent: Consent | null = readConsent()
const listeners = new Set<() => void>()

export function getConsent(): Consent | null {
  return consent
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Choix fait dans un autre onglet (ou sur le site marketing) : on s'aligne.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CONSENT_KEY) return
    const next = readConsent()
    if (next === consent) return
    const previous = consent
    consent = next
    applyConsent(previous)
    listeners.forEach((l) => l())
  })
}

let bannerRequested = false

/** Bannière visible : aucun choix valable, ou réouverture demandée (réglages). */
export function isConsentBannerOpen(): boolean {
  return analyticsEnabled && (consent === null || bannerRequested)
}

/** Rouvre la bannière pour modifier son choix (« Gérer les cookies »). */
export function openConsentBanner() {
  bannerRequested = true
  listeners.forEach((l) => l())
}

/** Enregistre le choix du visiteur (bannière ou réglages) et l'applique. */
export function setConsent(value: Consent) {
  const previous = consent
  consent = value
  bannerRequested = false
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ value, at: Date.now() }))
  } catch {
    /* stockage indisponible : choix valable pour cette page seulement */
  }
  if (value === 'granted') persistAttribution()
  else clearAttribution()
  applyConsent(previous)
  listeners.forEach((l) => l())
}

// ---------------------------------------------------------------- nettoyage

// Jetons secrets dans les URL (invitation, réinitialisation de mot de passe).
const SECRET_PATH = /(\/join\/)[^/?#"'\s]+/g
const SECRET_QUERY = /([?&](?:token|t|credential)=)[^&#"'\s]+/g

function scrub(value: string): string {
  return value.replace(SECRET_PATH, '$1[token]').replace(SECRET_QUERY, '$1[token]')
}

function scrubProps(props: Properties | undefined) {
  if (!props) return
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') props[k] = scrub(v)
  }
}

function beforeSend(cr: CaptureResult | null): CaptureResult | null {
  if (!cr) return cr
  scrubProps(cr.properties)
  scrubProps(cr.$set)
  scrubProps(cr.$set_once)
  return cr
}

// ---------------------------------------------------------------- chargement

let instance: PostHog | null = null
let loading: Promise<PostHog | null> | null = null

function load(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null)
  if (!loading) {
    loading = import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(KEY, {
          api_host: HOST,
          ui_host: 'https://eu.posthog.com',
          defaults: '2026-01-30',
          // Consentement : anonyme sans cookie tant que non accepté.
          cookieless_mode: 'on_reject',
          opt_out_capturing_by_default: true,
          opt_out_capturing_persistence_type: 'localStorage',
          consent_persistence_name: 'alternly_ph_optin',
          persistence: 'localStorage+cookie',
          person_profiles: 'identified_only',
          // Pages vues : envoyées à chaque changement de route (PageviewTracker).
          capture_pageview: false,
          capture_pageleave: true,
          autocapture: true,
          capture_exceptions: true,
          // Replay : seulement après consentement, saisies et zones sensibles masquées.
          disable_session_recording: consent !== 'granted',
          session_recording: {
            // Toutes les saisies masquées… sauf les menus déroulants (pays, zone,
            // rythme, parent) : masqués, le lecteur de replay en affichait une option
            // au hasard (« États-Unis » avec les zones françaises). Les noms visibles
            // restent couverts par .ph-mask.
            maskAllInputs: false,
            maskInputOptions: {
              password: true, email: true, text: true, textarea: true, search: true, tel: true, url: true,
              number: true, date: true, 'datetime-local': true, month: true, week: true, time: true,
              color: true, range: true, select: false,
            },
            maskTextSelector: '.ph-mask',
            blockSelector: '.ph-no-capture',
          },
          disable_surveys: true,
          disable_product_tours: true,
          disable_conversations: true,
          advanced_disable_feature_flags: true,
          before_send: beforeSend,
        })
        instance = posthog
        syncOptState(posthog)
        return posthog
      })
      .catch(() => null) // PostHog injoignable/bloqué : l'app continue sans analytics
  }
  return loading
}

/** Aligne l'état d'opt-in de PostHog sur notre choix mémorisé. */
function syncOptState(ph: PostHog) {
  if (consent === 'granted') {
    if (!ph.has_opted_in_capturing()) ph.opt_in_capturing({ captureEventName: false })
    ph.startSessionRecording()
  } else if (ph.has_opted_in_capturing()) {
    // Choix expiré ou révoqué dans un autre onglet : retour au mode anonyme.
    ph.reset()
    ph.opt_out_capturing()
  }
}

function applyConsent(previous: Consent | null) {
  const ph = instance
  if (!ph) return
  if (consent === 'granted') {
    syncOptState(ph)
    identifyCurrent()
  } else if (previous === 'granted') {
    // Révocation : oubli de l'identifiant, arrêt du replay, retour au cookieless.
    ph.stopSessionRecording()
    ph.reset()
    ph.opt_out_capturing()
  } else {
    ph.opt_out_capturing()
  }
}

function withPostHog(fn: (ph: PostHog) => void) {
  if (!KEY) return
  load().then((ph) => {
    if (!ph) return
    try {
      fn(ph)
    } catch {
      /* l'analytics ne casse jamais l'app */
    }
  })
}

/** Démarre PostHog (au démarrage de l'app). */
export function initAnalytics() {
  withPostHog(() => {})
}

// ---------------------------------------------------------------- attribution

const ATTRIBUTION_KEY = 'alternly_attribution'
const ATTRIBUTION_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid',
]

function readUrlAttribution(): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof window === 'undefined') return out
  const params = new URLSearchParams(window.location.search)
  for (const p of ATTRIBUTION_PARAMS) {
    const v = params.get(p)
    if (v) out[p] = v.slice(0, 100)
  }
  return out
}

// Premier contact de cette visite (URL d'arrivée, transmise par la landing).
const landingAttribution = readUrlAttribution()

function persistAttribution() {
  // sessionStorage = stockage au sens ePrivacy : seulement après consentement.
  if (consent !== 'granted' || Object.keys(landingAttribution).length === 0) return
  try {
    if (!sessionStorage.getItem(ATTRIBUTION_KEY)) {
      sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(landingAttribution))
    }
  } catch {
    /* ignore */
  }
}

function clearAttribution() {
  try {
    sessionStorage.removeItem(ATTRIBUTION_KEY)
  } catch {
    /* ignore */
  }
}

persistAttribution()

/** UTM / gclid / fbclid du premier contact (URL courante, sinon session si consentie). */
export function getAttribution(): Record<string, string> {
  if (Object.keys(landingAttribution).length > 0) return landingAttribution
  if (consent !== 'granted') return {}
  try {
    return JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || '{}')
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------- événements

type Primitive = string | number | boolean | null | undefined
export type EventProps = Record<string, Primitive>

/** Envoie un événement produit. Propriétés : énumérations, nombres, booléens — jamais de texte libre. */
export function track(event: AnalyticsEvent, props?: EventProps) {
  withPostHog((ph) => ph.capture(event, props))
}

export function trackPageview() {
  withPostHog((ph) => ph.capture('$pageview'))
}

export function captureException(error: unknown, props?: EventProps) {
  withPostHog((ph) => ph.captureException(error, props))
}

// ---------------------------------------------------------------- identité

export interface Identity {
  userId: number
  person: EventProps
  household?: { id: number; props: EventProps }
}

let identity: Identity | null = null

function identifyCurrent() {
  const ph = instance
  if (!ph || consent !== 'granted' || !identity) return
  ph.identify(String(identity.userId), identity.person)
  if (identity.household) ph.group('household', String(identity.household.id), identity.household.props)
}

/** Associe les événements au compte connecté — effectif seulement avec consentement. */
export function setIdentity(next: Identity | null) {
  identity = next
  if (next && consent === 'granted') withPostHog(() => identifyCurrent())
}

/** Déconnexion : nouvel identifiant anonyme, plus de lien avec le compte. */
export function resetIdentity() {
  identity = null
  withPostHog((ph) => {
    if (consent !== 'granted') return
    // reset() efface aussi l'opt-in : on le rétablit aussitôt (le choix reste valable).
    ph.reset()
    ph.opt_in_capturing({ captureEventName: false })
  })
}
