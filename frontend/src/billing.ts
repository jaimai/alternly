import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import { track } from './analytics'
import { EV } from './analyticsEvents'
import { API_BASE } from './api'
import i18n from './i18n'
import type { User } from './types'

const TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined
const PRICE_ANNUAL = import.meta.env.VITE_PADDLE_PRICE_ID as string | undefined
const PRICE_MONTHLY = import.meta.env.VITE_PADDLE_PRICE_ID_MONTHLY as string | undefined
const ENV = (import.meta.env.VITE_PADDLE_ENV as string | undefined) === 'production' ? 'production' : 'sandbox'

export type Plan = 'annual' | 'monthly'
export const paddleConfigured = Boolean(TOKEN)

export interface PlanInfo {
  price_id: string | null
  trial_days: number
}
export type Plans = Record<Plan, PlanInfo>

// Offres servies par l'API (source de vérité : variables Railway + prix Paddle,
// dont la durée d'essai). Repli sur les variables Vite si l'API ne répond pas.
let plansPromise: Promise<Plans> | null = null
export function loadPlans(): Promise<Plans> {
  if (!plansPromise) {
    plansPromise = fetch(`${API_BASE}/billing/plans`)
      .then((r) => (r.ok ? (r.json() as Promise<Plans>) : Promise.reject(new Error(String(r.status)))))
      .catch(() => {
        plansPromise = null // nouvel essai au prochain appel
        return {
          annual: { price_id: PRICE_ANNUAL ?? null, trial_days: 0 },
          monthly: { price_id: PRICE_MONTHLY ?? null, trial_days: 0 },
        }
      })
  }
  return plansPromise
}

let paddlePromise: Promise<Paddle | undefined> | null = null
// Le callback Paddle est fixé à l'initialisation : on garde le dernier contexte d'ouverture.
let current: { onComplete: () => void; plan: Plan } = { onComplete: () => {}, plan: 'annual' }

function getPaddle(): Promise<Paddle | undefined> {
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      token: TOKEN as string,
      environment: ENV,
      eventCallback: (ev) => {
        if (ev?.name === 'checkout.completed') {
          track(EV.checkoutCompleted, { plan: current.plan })
          current.onComplete()
        }
      },
    })
  }
  return paddlePromise
}

/** Ouvre le checkout Paddle. `plan` = 'annual' (défaut) ou 'monthly'. `onComplete`
 *  est appelé après paiement (l'activation réelle passe par le webhook). */
export async function openCheckout(
  user: User,
  onComplete: () => void,
  plan: Plan = 'annual',
  source = 'unknown',
) {
  // Jamais de repli silencieux d'une offre sur l'autre : le parent paie ce qu'il a choisi.
  const priceId = (await loadPlans())[plan].price_id
  if (!paddleConfigured || !priceId) {
    alert(i18n.t('paywall.notConfigured'))
    return
  }
  current = { onComplete, plan }
  track(EV.checkoutOpened, { plan, source })
  const paddle = await getPaddle()
  paddle?.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email: user.email },
    customData: { user_id: String(user.id) },
    settings: { locale: i18n.language.startsWith('en') ? 'en' : 'fr', displayMode: 'overlay' },
  })
}
