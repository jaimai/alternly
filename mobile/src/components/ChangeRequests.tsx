// Demandes de changement en attente (règles, jours de fête, retrait d'un enfant) :
// l'autre parent accepte ou refuse, l'auteur peut retirer la sienne.
import { StyleSheet, Text, View } from 'react-native'
import { api } from '@/lib/api'
import { formatAgo } from '@/lib/dates'
import { useChangeRequests, useHouseholdAction } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { Household } from '@/lib/types'
import { Button, Card, ErrorBanner, SectionLabel } from './ui'

export function ChangeRequests({ household, meId }: { household: Household; meId?: number }) {
  const requests = useChangeRequests(household.id)
  const answer = useHouseholdAction(({ id, action }: { id: number; action: 'accept' | 'refuse' | 'withdraw' }) =>
    api.answerChange(household.id, id, action),
  )
  const items = requests.data ?? []
  if (items.length === 0) return null
  const name = (id: number) => household.members.find((m) => m.id === id)?.display_name ?? 'L’autre parent'
  const busy = (id: number) => answer.isPending && answer.variables?.id === id

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>Demandes de changement</SectionLabel>
      <ErrorBanner message={answer.error ? 'Action impossible. Réessayez.' : null} />
      {items.map((r) => {
        const mine = r.requested_by === meId
        return (
          <Card key={r.id} style={mine ? undefined : { borderColor: colors.terra }}>
            <Text style={s.who}>{mine ? 'Votre demande · en attente' : `${name(r.requested_by)} demande votre accord`}</Text>
            <Text style={s.summary}>{r.summary}</Text>
            <Text style={s.when}>{formatAgo(r.created_at)}</Text>
            {mine ? (
              <Button title="Retirer" variant="ghost" loading={busy(r.id)} onPress={() => answer.mutate({ id: r.id, action: 'withdraw' })} />
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Refuser" variant="secondary" style={{ flex: 1 }} disabled={answer.isPending} onPress={() => answer.mutate({ id: r.id, action: 'refuse' })} />
                <Button title="Accepter" style={{ flex: 1 }} loading={busy(r.id) && answer.variables?.action === 'accept'} disabled={answer.isPending} onPress={() => answer.mutate({ id: r.id, action: 'accept' })} />
              </View>
            )}
          </Card>
        )
      })}
    </View>
  )
}

export const PENDING_MESSAGE = 'Demande envoyée : l’autre parent doit l’accepter avant qu’elle s’applique.'

const s = StyleSheet.create({
  who: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  summary: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  when: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
})
