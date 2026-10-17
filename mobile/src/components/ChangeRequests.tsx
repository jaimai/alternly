// Demandes de changement en attente (règles, jours de fête, retrait d'un enfant) :
// l'autre parent accepte ou refuse, l'auteur peut retirer la sienne.
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { api } from '@/lib/api'
import { formatAgo } from '@/lib/dates'
import { t as translate } from '@/lib/i18n'
import { useChangeRequests, useHouseholdAction } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { Household } from '@/lib/types'
import { Button, Card, ErrorBanner, SectionLabel } from './ui'

export function ChangeRequests({ household, meId }: { household: Household; meId?: number }) {
  const { t } = useTranslation()
  const requests = useChangeRequests(household.id)
  const answer = useHouseholdAction(({ id, action }: { id: number; action: 'accept' | 'refuse' | 'withdraw' }) =>
    api.answerChange(household.id, id, action),
  )
  const items = requests.data ?? []
  if (items.length === 0) return null
  const name = (id: number) => household.members.find((m) => m.id === id)?.display_name ?? t('common.otherParentTitle')
  const busy = (id: number) => answer.isPending && answer.variables?.id === id

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>{t('settings.changeRequests.title')}</SectionLabel>
      <ErrorBanner message={answer.error ? t('settings.changeRequests.error') : null} />
      {items.map((r) => {
        const mine = r.requested_by === meId
        return (
          <Card key={r.id} style={mine ? undefined : { borderColor: colors.terra }}>
            <Text style={s.who}>{mine ? t('settings.changeRequests.mine') : t('settings.changeRequests.theirs', { name: name(r.requested_by) })}</Text>
            <Text style={s.summary}>{r.summary}</Text>
            <Text style={s.when}>{formatAgo(r.created_at)}</Text>
            {mine ? (
              <Button title={t('settings.changeRequests.withdraw')} variant="ghost" loading={busy(r.id)} onPress={() => answer.mutate({ id: r.id, action: 'withdraw' })} />
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title={t('settings.changeRequests.refuse')} variant="secondary" style={{ flex: 1 }} disabled={answer.isPending} onPress={() => answer.mutate({ id: r.id, action: 'refuse' })} />
                <Button title={t('settings.changeRequests.accept')} style={{ flex: 1 }} loading={busy(r.id) && answer.variables?.action === 'accept'} disabled={answer.isPending} onPress={() => answer.mutate({ id: r.id, action: 'accept' })} />
              </View>
            )}
          </Card>
        )
      })}
    </View>
  )
}

/** Message affiché quand un changement part en demande d'accord (HTTP 202). */
export function pendingMessage(): string {
  return translate('settings.changeRequests.pending')
}


const s = StyleSheet.create({
  who: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  summary: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  when: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
})
