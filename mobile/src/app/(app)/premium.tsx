// Alternly Premium (Réglages) : le paywall, ou si le foyer est déjà abonné, par quel
// canal — jamais un second abonnement.
import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Icon } from '@/components/Icon'
import { Paywall } from '@/components/Paywall'
import { Body, Button, ErrorBanner, ErrorState, Loading, Screen, Title } from '@/components/ui'
import { manageSubscription } from '@/lib/purchases'
import { useBilling, useBillingAction } from '@/lib/queries'
import { colors } from '@/lib/theme'
import type { BillingStatus } from '@/lib/types'

const STORE_NAME = { app_store: 'l’App Store', play_store: 'Google Play' } as const

export default function Premium() {
  const billing = useBilling()
  if (billing.isPending) return <Loading />
  if (billing.isError) return <ErrorState message={billing.error.message} onRetry={() => billing.refetch()} />
  if (billing.data.access) return <Subscribed status={billing.data} />
  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Paywall />
    </Screen>
  )
}

function Subscribed({ status }: { status: BillingStatus }) {
  const manage = useBillingAction(async () => {
    await manageSubscription()
    return status
  })
  const store = status.source === 'app_store' || status.source === 'play_store' ? status.source : null
  let text = 'Toutes les fonctions sont débloquées pour les deux parents.'
  if (!status.is_payer && status.source) text = 'Grâce à l’abonnement de l’autre parent : toutes les fonctions sont débloquées pour vous deux.'
  else if (store) text = `Abonnement souscrit dans ${STORE_NAME[store]}. Il se gère et se résilie dans le store.`
  else if (status.source === 'paddle') text = 'Abonnement souscrit sur le site alternly.com : il se gère sur le site, depuis un navigateur.'

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={s.badge}>
        <Icon name="check" color="#fff" strokeWidth={3} />
      </View>
      <Title>Votre foyer est Premium</Title>
      <Body muted>{text}</Body>
      <ErrorBanner message={manage.error?.message} />
      {store && status.is_payer ? (
        <Button title="Gérer mon abonnement" variant="secondary" onPress={() => manage.mutate()} loading={manage.isPending} />
      ) : null}
      <Button title="Fermer" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const s = StyleSheet.create({
  badge: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.pine, alignItems: 'center', justifyContent: 'center' },
})
