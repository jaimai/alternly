// Rattache les achats intégrés au compte connecté (RevenueCat app_user_id = id Alternly),
// puis resynchronise une fois par lancement : rattrape un webhook perdu.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { iapAvailable, identifyPurchaser } from '@/lib/purchases'
import { keys, useMe } from '@/lib/queries'

export function PurchasesManager() {
  const userId = useMe().data?.id
  const qc = useQueryClient()

  useEffect(() => {
    if (userId === undefined || !iapAvailable()) return
    let cancelled = false
    identifyPurchaser(userId)
      .then(() => api.storeSync())
      .then((status) => !cancelled && qc.setQueryData(keys.billing, status))
      .catch(() => {}) // hors ligne : le statut se rechargera à l'ouverture de l'écran Premium
    return () => {
      cancelled = true
    }
  }, [userId, qc])

  return null
}
