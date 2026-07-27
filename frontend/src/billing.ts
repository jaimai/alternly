import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import type { User } from './types'

const TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined
const PRICE_ANNUAL = import.meta.env.VITE_PADDLE_PRICE_ID as string | undefined
const PRICE_MONTHLY = import.meta.env.VITE_PADDLE_PRICE_ID_MONTHLY as string | undefined
const ENV = (import.meta.env.VITE_PADDLE_ENV as string | undefined) === 'production' ? 'production' : 'sandbox'

export type Plan = 'annual' | 'monthly'
export const paddleConfigured = Boolean(TOKEN && PRICE_ANNUAL)

let paddlePromise: Promise<Paddle | undefined> | null = null

function getPaddle(onComplete: () => void): Promise<Paddle | undefined> {
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      token: TOKEN as string,
      environment: ENV,
      eventCallback: (ev) => {
        if (ev?.name === 'checkout.completed') onComplete()
      },
    })
  }
  return paddlePromise
}

/** Ouvre le checkout Paddle. `plan` = 'annual' (défaut) ou 'monthly'. `onComplete`
 *  est appelé après paiement (l'activation réelle passe par le webhook). */
export async function openCheckout(user: User, onComplete: () => void, plan: Plan = 'annual') {
  const priceId = plan === 'monthly' ? PRICE_MONTHLY ?? PRICE_ANNUAL : PRICE_ANNUAL
  if (!paddleConfigured || !priceId) {
    alert("Le paiement n'est pas encore configuré. Réessayez plus tard.")
    return
  }
  const paddle = await getPaddle(onComplete)
  paddle?.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email: user.email },
    customData: { user_id: String(user.id) },
    settings: { locale: 'fr', displayMode: 'overlay' },
  })
}
