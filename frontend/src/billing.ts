import { useEffect, useState } from 'react'
import { api } from './api'
import type { BillingStatus } from './types'

// Statut d'abonnement partagé entre les pages (une requête par minute au plus).
let cache: { at: number; value: BillingStatus } | null = null

export function invalidateBilling() {
  cache = null
}

export function useBilling(): BillingStatus | null {
  const [status, setStatus] = useState<BillingStatus | null>(cache?.value ?? null)
  useEffect(() => {
    let alive = true
    const load = () => {
      if (cache && Date.now() - cache.at < 60_000) {
        setStatus(cache.value)
        return
      }
      api
        .billingStatus()
        .then((value) => {
          cache = { at: Date.now(), value }
          if (alive) setStatus(value)
        })
        .catch(() => {})
    }
    load()
    const onPaywall = () => {
      invalidateBilling()
      load()
    }
    window.addEventListener('alternly:paywall', onPaywall)
    return () => {
      alive = false
      window.removeEventListener('alternly:paywall', onPaywall)
    }
  }, [])
  return status
}
