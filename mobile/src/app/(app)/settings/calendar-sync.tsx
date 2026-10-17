// Synchronisation avec l'agenda du téléphone (Apple Calendrier) ou Google Agenda :
// abonnement à un flux iCal privé, mis à jour automatiquement. Fonction Premium.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Alert, Linking, Platform, Share, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Paywall } from '@/components/Paywall'
import { Body, Button, Card, ErrorBanner, ErrorState, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { icalLinks } from '@/lib/ical'
import { useHouseholdAction } from '@/lib/queries'
import { colors } from '@/lib/theme'

const KEY = ['icalLink'] as const

export default function CalendarSync() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const link = useQuery({ queryKey: KEY, queryFn: api.icalLink, retry: false })
  const regenerate = useHouseholdAction(api.regenerateIcal, (r) => qc.setQueryData(KEY, r))

  if (link.isPending) return <Loading />
  if (link.error instanceof ApiError && link.error.status === 402) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Paywall
          title={t('settings.calendarSync.paywallTitle')}
          intro={t('settings.calendarSync.paywallIntro')}
        />
      </Screen>
    )
  }
  if (link.isError) return <ErrorState message={link.error.message} onRetry={() => link.refetch()} />

  const urls = icalLinks(link.data.ical_token)

  function confirmRegenerate() {
    Alert.alert(
      t('settings.calendarSync.regenerateTitle'),
      t('settings.calendarSync.regenerateBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.calendarSync.regenerateAction'), style: 'destructive', onPress: () => regenerate.mutate() },
      ],
    )
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>{t('settings.calendarSync.title')}</Title>
        <Body muted>{t('settings.calendarSync.intro')}</Body>
      </View>
      <ErrorBanner message={regenerate.error?.message} />

      {Platform.OS === 'ios' ? (
        <Button title={t('settings.calendarSync.addApple')} onPress={() => Linking.openURL(urls.webcal)} />
      ) : null}
      <Button
        title={t('settings.calendarSync.addGoogle')}
        variant={Platform.OS === 'ios' ? 'secondary' : 'primary'}
        onPress={() => Linking.openURL(urls.google)}
      />
      <Button title={t('settings.calendarSync.share')} variant="secondary" onPress={() => Share.share({ message: urls.https })} />

      <Card>
        <SectionLabel>{t('settings.calendarSync.tipsTitle')}</SectionLabel>
        <Body style={{ fontSize: 14 }}>{t('settings.calendarSync.tipGoogle')}</Body>
        <Body style={{ fontSize: 14 }}>{t('settings.calendarSync.tipOther')}</Body>
        <Body muted style={{ fontSize: 13 }}>{t('settings.calendarSync.private')}</Body>
      </Card>

      <Button title={t('settings.calendarSync.newLink')} variant="ghost" onPress={confirmRegenerate} loading={regenerate.isPending} />
      {regenerate.isSuccess ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{t('settings.calendarSync.newLinkDone')}</Body>
        </Card>
      ) : null}
    </Screen>
  )
}
