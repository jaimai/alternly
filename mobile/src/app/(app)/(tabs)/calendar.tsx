import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Icon } from '@/components/Icon'
import { Button, Card, ErrorState, Loading } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { memberById, pendingOn, publicHolidayOn, schoolHolidayOn, whoName } from '@/lib/custody'
import { addMonths, formatLong, formatMonth, formatRange, monthGrid, monthStart, parseIso, todayIso } from '@/lib/dates'
import { useCalendar, useHousehold, useMe, useWithdrawExchange } from '@/lib/queries'
import { colors, fonts, tint } from '@/lib/theme'
import type { CalendarResponse } from '@/lib/types'

const WEEKDAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const SOURCE_LABEL: Record<string, string> = {
  rule: 'Rythme habituel',
  vacation: 'Vacances scolaires',
  special: 'Jour spécial',
  exception: 'Échange accepté',
}

export default function CalendarScreen() {
  const today = todayIso()
  const [month, setMonth] = useState(monthStart(today))
  const [selected, setSelected] = useState(today)
  const grid = useMemo(() => monthGrid(month), [month])
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const calendar = useCalendar(household?.id, grid[0], grid[grid.length - 1])

  const goTo = (delta: number) => {
    const next = addMonths(month, delta)
    setMonth(next)
    setSelected(next.slice(0, 7) === today.slice(0, 7) ? today : next)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>
          {capitalize(formatMonth(month))}
        </Text>
        <NavButton icon="back" label="Mois précédent" onPress={() => goTo(-1)} />
        <NavButton icon="chevron" label="Mois suivant" onPress={() => goTo(1)} />
      </View>

      {calendar.isPending ? (
        <Loading />
      ) : calendar.isError ? (
        <ErrorState
          message={
            calendar.error instanceof ApiError && calendar.error.status === 409
              ? 'Aucun rythme de garde défini. Configurez-le sur alternly.com.'
              : calendar.error.message
          }
          onRetry={() => calendar.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, gap: 12 }}>
          <View style={s.legendRow}>
            {calendar.data.members.map((m) => (
              <Legend key={m.id} color={m.color} label={m.id === meId ? 'Vous' : m.display_name} />
            ))}
            <Legend color={colors.holiday} label="Vacances" bar />
          </View>

          <View style={s.grid}>
            {WEEKDAYS.map((d) => (
              <Text key={d} style={s.weekday}>
                {d}
              </Text>
            ))}
            {grid.map((date) => (
              <DayCell
                key={date}
                date={date}
                cal={calendar.data}
                inMonth={date.slice(0, 7) === month.slice(0, 7)}
                isToday={date === today}
                isSelected={date === selected}
                onPress={() => setSelected(date)}
              />
            ))}
          </View>

          <DayDetail key={selected} date={selected} cal={calendar.data} meId={meId} householdId={household?.id} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function DayCell({ date, cal, inMonth, isToday, isSelected, onPress }: {
  date: string
  cal: CalendarResponse
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  onPress: () => void
}) {
  const day = cal.days.find((d) => d.date === date)
  const color = memberById(cal.members, day?.parent_id)?.color
  const vacation = schoolHolidayOn(cal, date)
  const holiday = publicHolidayOn(cal, date)
  const pending = pendingOn(cal, date)
  const owner = memberById(cal.members, day?.parent_id)?.display_name

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={[formatLong(date), owner ? `chez ${owner}` : null, vacation?.label, holiday?.label, pending ? 'échange proposé' : null]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
      style={[
        s.cell,
        { backgroundColor: color ? tint(color, 0.3) : colors.paperDeep, opacity: inMonth ? 1 : 0.4 },
        isSelected && { borderColor: colors.ink, borderWidth: 2 },
        pending && !isSelected && { borderColor: colors.terraText, borderWidth: 2, borderStyle: 'dashed' },
      ]}
    >
      <View style={isToday ? s.todayDot : null}>
        <Text style={[s.cellNum, isToday && { color: '#fff' }]}>{parseIso(date).getDate()}</Text>
      </View>
      {holiday ? <View style={s.holidayDot} /> : null}
      {pending ? <Icon name="swap" size={13} color={colors.terraText} strokeWidth={2.4} /> : null}
      {color ? <View style={[s.strip, { backgroundColor: color }]} /> : null}
      {vacation ? <View style={s.vacationBar} /> : null}
    </Pressable>
  )
}

function DayDetail({ date, cal, meId, householdId }: { date: string; cal: CalendarResponse; meId?: number; householdId?: number }) {
  const withdraw = useWithdrawExchange(householdId)
  const day = cal.days.find((d) => d.date === date)
  const member = memberById(cal.members, day?.parent_id)
  const vacation = schoolHolidayOn(cal, date)
  const holiday = publicHolidayOn(cal, date)
  const pending = pendingOn(cal, date)
  const who = (id?: number) => whoName(cal.members, id, meId)

  return (
    <Card>
      <Text style={s.detailTitle}>{capitalize(formatLong(date))}</Text>
      {day && member ? (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 8, alignSelf: 'stretch', borderRadius: 4, backgroundColor: member.color }} />
          <View>
            <Text style={s.detailMain}>Chez {who(member.id)}</Text>
            <Text style={s.detailSub}>{SOURCE_LABEL[day.source] ?? ''}</Text>
          </View>
        </View>
      ) : (
        <Text style={s.detailSub}>Pas d’information pour ce jour.</Text>
      )}
      {vacation ? <Text style={s.detailSub}>{vacation.label} ({formatRange(vacation.start, vacation.end)})</Text> : null}
      {holiday ? <Text style={s.detailSub}>Férié : {holiday.label}</Text> : null}
      {pending ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            pending.proposed_by !== meId
              ? router.push({ pathname: '/exchange/[id]', params: { id: String(pending.id) } })
              : undefined
          }
          style={s.pending}
        >
          <Icon name="swap" size={18} color={colors.terraText} strokeWidth={2} />
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink }}>
            {pending.proposed_by === meId
              ? `Votre proposition (${formatRange(pending.date_start, pending.date_end)}) attend une réponse.`
              : `Échange proposé : ${formatRange(pending.date_start, pending.date_end)} chez ${who(pending.proposed_parent_id)}. Toucher pour répondre.`}
          </Text>
        </Pressable>
      ) : null}
      {pending && pending.proposed_by === meId ? (
        <Button
          title="Retirer ma proposition"
          variant="danger"
          onPress={() => withdraw.mutate(pending.id)}
          loading={withdraw.isPending}
        />
      ) : null}
      {withdraw.error ? <Text style={[s.detailSub, { color: colors.danger }]}>{withdraw.error.message}</Text> : null}
      {!pending && date >= todayIso() ? (
        <Button
          title="Proposer un échange"
          variant="secondary"
          icon={<Icon name="swap" size={18} color={colors.pine} strokeWidth={2} />}
          onPress={() => router.push({ pathname: '/exchange/new', params: { date } })}
        />
      ) : null}
    </Card>
  )
}

function NavButton({ icon, label, onPress }: { icon: 'back' | 'chevron'; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.nav}>
      <Icon name={icon} size={20} />
    </Pressable>
  )
}

function Legend({ color, label, bar }: { color: string; label: string; bar?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={bar ? { width: 14, height: 3, borderRadius: 2, backgroundColor: color } : { width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft }}>{label}</Text>
    </View>
  )
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  nav: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 11, color: colors.inkSoft, paddingBottom: 4 },
  cell: {
    width: `${100 / 7 - 1}%`, marginHorizontal: '0.5%', height: 60, borderRadius: 12, alignItems: 'center',
    paddingTop: 6, gap: 2, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent',
  },
  cellNum: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  todayDot: { backgroundColor: colors.ink, borderRadius: 13, width: 26, height: 26, alignItems: 'center', justifyContent: 'center', marginTop: -3 },
  holidayDot: { position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: 3, backgroundColor: '#4a6fa5' },
  strip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 },
  vacationBar: { position: 'absolute', left: 6, right: 6, bottom: 8, height: 3, borderRadius: 2, backgroundColor: colors.holiday },
  detailTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  detailMain: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  detailSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  pending: {
    flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: 12,
    backgroundColor: '#fdf3ee', borderWidth: 1, borderColor: '#e8c4b2', borderStyle: 'dashed',
  },
})
