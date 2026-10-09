// Monté dans l'espace connecté : réinscrit le téléphone, rafraîchit les données à
// l'arrivée d'un push et ouvre le bon écran quand on le touche (même app fermée).
import { useQueryClient } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { syncPushRegistration } from '@/lib/push'
import { pushTarget } from '@/lib/pushTarget'
import { keys } from '@/lib/queries'

export function PushManager() {
  const qc = useQueryClient()
  const lastResponse = Notifications.useLastNotificationResponse()

  useEffect(() => {
    void syncPushRegistration().catch(() => {}) // best effort : l'app marche sans push
    const received = Notifications.addNotificationReceivedListener(() => {
      qc.invalidateQueries({ queryKey: keys.notifications })
      qc.invalidateQueries({ queryKey: ['calendar'] })
    })
    return () => received.remove()
  }, [qc])

  // Notification touchée (y compris celle qui a ouvert l'app).
  useEffect(() => {
    if (!lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const data = lastResponse.notification.request.content.data as Record<string, unknown> | undefined
    qc.invalidateQueries({ queryKey: keys.notifications })
    router.push(pushTarget(data))
  }, [lastResponse, qc])

  return null
}
