import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import type { User } from './types'

const TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined
const PRICE_ID = import.meta.env.VITE_PADDLE_PRICE_ID as string | undefined
const ENV = (import.meta.env.VITE_PADDLE_ENV as string | undefined) === 'production' ? 'production' : 'sandbox'

export const paddleConfigured = Boolean(TOKEN && PRICE_ID)

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

/** Ouvre le checkout Paddle pour l'abonnement annuel. `onComplete` est appelé
 *  après paiement (l'activation réelle passe par le webhook, avec un léger délai). */
export async function openCheckout(user: User, onComplete: () => void) {
  if (!paddleConfigured) {
    alert("Le paiement n'est pas encore configuré. Réessayez plus tard.")
    return
  }
  const paddle = await getPaddle(onComplete)
  paddle?.Checkout.open({
    items: [{ priceId: PRICE_ID as string, quantity: 1 }],
    customer: { email: user.email },
    customData: { user_id: String(user.id) },
    settings: { locale: 'fr', displayMode: 'overlay' },
  })
}
