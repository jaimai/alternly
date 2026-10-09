// Historique du foyer : toutes les modifications, horodatées et non modifiables,
// visibles par les deux parents (qui a changé quoi, et quand).
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Avatar, Body, Button, ErrorState, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { formatLong, isoLocal, parseTimestamp } from '@/lib/dates'
import { intlLocale } from '@/lib/i18n'
import { useHousehold } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { HistoryEntry } from '@/lib/types'

const PAGE = 50

export default function History() {
  const { t } = useTranslation()
  const household = useHousehold().data
  const hid = household?.id ?? 0
  const history = useInfiniteQuery({
    queryKey: ['history', hid],
    queryFn: ({ pageParam }) => api.history(hid, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1].id),
    enabled: !!household,
  })

  if (!household || history.isPending) return <Loading />
  if (history.isError) return <ErrorState message={history.error.message} onRetry={() => history.refetch()} />

  const entries = history.data.pages.flat()
  const member = (id: number | null) => household.members.find((m) => m.id === id)
  // Regroupement par jour (heure locale).
  const days = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const key = isoLocal(parseTimestamp(e.created_at))
    days.set(key, [...(days.get(key) ?? []), e])
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>{t('settings.history.title')}</Title>
        <Body muted>{t('settings.history.intro')}</Body>
      </View>

      {entries.length === 0 ? (
        <Body muted>{t('settings.history.empty')}</Body>
      ) : null}

      {[...days.entries()].map(([day, items]) => (
        <View key={day} style={{ gap: 8 }}>
          <SectionLabel>{capitalize(formatLong(day))}</SectionLabel>
          <View style={s.group}>
            {items.map((e, i) => {
              const m = member(e.actor_id)
              const time = parseTimestamp(e.created_at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
              return (
                <View key={e.id} style={[s.row, i > 0 && s.border]}>
                  <Avatar name={m?.display_name ?? '·'} color={m?.color ?? colors.line} size={30} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.text}>
                      <Text style={s.strong}>{m?.display_name ?? t('settings.history.system')}</Text> {e.summary}
                    </Text>
                    <Text style={s.time}>{time}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        </View>
      ))}

      {history.hasNextPage ? (
        <Button title={t('settings.history.more')} variant="secondary" onPress={() => history.fetchNextPage()} loading={history.isFetchingNextPage} />
      ) : null}
    </Screen>
  )
}

function capitalize(v: string) {
  return v.charAt(0).toUpperCase() + v.slice(1)
}

const s = StyleSheet.create({
  group: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  strong: { fontFamily: fonts.bodySemiBold },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
})
