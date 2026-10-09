// Alternly Premium (Réglages) : le paywall, ou si le foyer est déjà abonné, par quel
// canal — jamais un second abonnement.
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Icon } from '@/components/Icon'
import { Paywall } from '@/components/Paywall'
import { Body, Button, ErrorBanner, ErrorState, Loading, Screen, Title } from '@/components/ui'
import { manageSubscription } from '@/lib/purchases'
import { useBilling, useBillingAction } from '@/lib/queries'
import { colors } from '@/lib/theme'
import type { BillingStatus } from '@/lib/types'

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
  const { t } = useTranslation()
  const manage = useBillingAction(async () => {
    await manageSubscription()
    return status
  })
  const store = status.source === 'app_store' || status.source === 'play_store' ? status.source : null
  let text = t('premium.subscribed.all')
  if (!status.is_payer && status.source) text = t('premium.subscribed.viaPartner')
  else if (store) text = t('premium.subscribed.store', { store: t(`premium.subscribed.storeNames.${store}`) })
  else if (status.source === 'paddle') text = t('premium.subscribed.paddle')

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={s.badge}>
        <Icon name="check" color="#fff" strokeWidth={3} />
      </View>
      <Title>{t('premium.subscribed.title')}</Title>
      <Body muted>{text}</Body>
      <ErrorBanner message={manage.error?.message} />
      {store && status.is_payer ? (
        <Button title={t('premium.subscribed.manage')} variant="secondary" onPress={() => manage.mutate()} loading={manage.isPending} />
      ) : null}
      <Button title={t('common.close')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const s = StyleSheet.create({
  badge: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.pine, alignItems: 'center', justifyContent: 'center' },
})
