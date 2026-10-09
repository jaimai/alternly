// Synchronisation avec l'agenda du téléphone (Apple Calendrier) ou Google Agenda :
// abonnement à un flux iCal privé, mis à jour automatiquement. Fonction Premium.
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  const qc = useQueryClient()
  const link = useQuery({ queryKey: KEY, queryFn: api.icalLink, retry: false })
  const regenerate = useHouseholdAction(api.regenerateIcal, (r) => qc.setQueryData(KEY, r))

  if (link.isPending) return <Loading />
  if (link.error instanceof ApiError && link.error.status === 402) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Paywall
          title="Votre garde dans votre agenda"
          intro="Les jours avec les enfants et les passations apparaissent dans Calendrier ou Google Agenda, à jour automatiquement. Un seul abonnement suffit pour les deux parents."
        />
      </Screen>
    )
  }
  if (link.isError) return <ErrorState message={link.error.message} onRetry={() => link.refetch()} />

  const urls = icalLinks(link.data.ical_token)

  function confirmRegenerate() {
    Alert.alert(
      'Créer un nouveau lien ?',
      'L’ancien lien cesse de fonctionner : les agendas déjà abonnés ne seront plus mis à jour. Utile si le lien a été partagé par erreur.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Nouveau lien', style: 'destructive', onPress: () => regenerate.mutate() },
      ],
    )
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>Synchroniser mon agenda</Title>
        <Body muted>
          Les jours avec les enfants et les passations s’ajoutent à votre agenda habituel, et se mettent à jour tout seuls
          quand le planning change.
        </Body>
      </View>
      <ErrorBanner message={regenerate.error?.message} />

      {Platform.OS === 'ios' ? (
        <Button title="Ajouter à Calendrier (iPhone)" onPress={() => Linking.openURL(urls.webcal)} />
      ) : null}
      <Button
        title="Ajouter à Google Agenda"
        variant={Platform.OS === 'ios' ? 'secondary' : 'primary'}
        onPress={() => Linking.openURL(urls.google)}
      />
      <Button title="Partager le lien" variant="secondary" onPress={() => Share.share({ message: urls.https })} />

      <Card>
        <SectionLabel>Bon à savoir</SectionLabel>
        <Body style={{ fontSize: 14 }}>
          Google Agenda : connectez-vous au compte Google voulu, puis validez « Ajouter ». Les mises à jour peuvent prendre
          quelques heures chez Google.
        </Body>
        <Body style={{ fontSize: 14 }}>
          Autre application d’agenda : ajoutez un « calendrier par URL » (ou « abonnement ») avec le lien partagé.
        </Body>
        <Body muted style={{ fontSize: 13 }}>
          Ce lien est privé : toute personne qui l’a peut voir le planning de garde.
        </Body>
      </Card>

      <Button title="Créer un nouveau lien" variant="ghost" onPress={confirmRegenerate} loading={regenerate.isPending} />
      {regenerate.isSuccess ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>Nouveau lien créé : abonnez de nouveau vos agendas.</Body>
        </Card>
      ) : null}
    </Screen>
  )
}
