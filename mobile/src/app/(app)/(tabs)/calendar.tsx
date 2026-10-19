import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AdjustTools, type AdjustTool } from '@/components/AdjustTools'
import { CalendarNotices } from '@/components/CalendarNotices'
import { Icon } from '@/components/Icon'
import { Body, Button, Card, ErrorState, Loading } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { isSolo, memberById, pendingOn, publicHolidayOn, schoolHolidayOn, whoName } from '@/lib/custody'
import { addDays, addMonths, formatLong, formatMonth, formatRange, monthGrid, monthStart, parseIso, todayIso } from '@/lib/dates'
import {
  useAcceptedExchanges, useCalendar, useCancelExchange, useHousehold, useMe, usePrefetchCalendars, useSaveAdjustments,
  useWithdrawExchange,
} from '@/lib/queries'
import { colors, fonts, tint } from '@/lib/theme'
import type { CalendarResponse, ScheduleException } from '@/lib/types'

const WEEKDAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const SOURCE_LABEL: Record<string, string> = {
  rule: 'Rythme habituel',
  vacation: 'Vacances scolaires',
  special: 'Jour spécial',
  exception: 'Échange accepté',
  adjustment: 'Jour personnalisé',
}

/** Jour touché en mode « Ajuster » : parent visé, et jour personnalisé à rendre au rythme le cas échéant. */
interface Flip {
  to: number
  clearId: number | null
}

/** Jour personnalisé accepté posé sur `date`, s'il y en a un. */
function adjustmentOn(exceptions: ScheduleException[], date: string) {
  return exceptions.find((e) => e.kind === 'adjustment' && e.status === 'accepted' && e.date_start === date)
}

export default function CalendarScreen() {
  const today = todayIso()
  const [month, setMonth] = useState(monthStart(today))
  const [selected, setSelected] = useState(today)
  const grid = useMemo(() => monthGrid(month), [month])
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const calendar = useCalendar(household?.id, grid[0], grid[grid.length - 1])
  const neighbors = useMemo(
    () => [-1, 1].map((d) => monthGrid(addMonths(month, d))).map((g) => ({ start: g[0], end: g[g.length - 1] })),
    [month],
  )
  usePrefetchCalendars(household?.id, neighbors, calendar.isSuccess)
  const exceptions = useAcceptedExchanges(household?.id).data ?? []
  const save = useSaveAdjustments(household?.id)
  const [adjusting, setAdjusting] = useState(false)
  const [flips, setFlips] = useState<Record<string, Flip>>({})
  const [notice, setNotice] = useState<string | null>(null)
  // Pinceau : parent à qui va chaque jour touché ; outil jour par jour ou période.
  const [brush, setBrush] = useState<number | null>(null)
  const [tool, setTool] = useState<AdjustTool>('day')
  const solo = household ? isSolo(household.members) : true
  const otherName = household?.members.find((m) => m.id !== meId && !m.is_placeholder)?.display_name ?? 'l’autre parent'
  const flipCount = Object.keys(flips).length
  const nameOf = (id: number) => whoName(household?.members ?? [], id, meId)

  // Récapitulatif : jours consécutifs vers le même parent regroupés en une ligne.
  const groups = useMemo(() => {
    const out: { start: string; end: string; to: number; dates: string[] }[] = []
    for (const date of Object.keys(flips).sort()) {
      const last = out[out.length - 1]
      if (last && last.to === flips[date].to && addDays(last.end, 1) === date) {
        last.end = date
        last.dates.push(date)
      } else {
        out.push({ start: date, end: date, to: flips[date].to, dates: [date] })
      }
    }
    return out
  }, [flips])

  /** Pinceau : le jour va chez le parent choisi ; s'il y est déjà, il n'est plus modifié. */
  function paintDay(date: string) {
    const day = calendar.data?.days.find((d) => d.date === date)
    if (!day || brush === null) return
    setFlips((prev) => {
      const next = { ...prev }
      if (day.parent_id === brush) delete next[date]
      else next[date] = { to: brush, clearId: null }
      return next
    })
  }

  /** Une période d'un coup : seuls les jours qui changent de parent sont retenus. */
  async function applyPeriod(start: string, end: string): Promise<string | null> {
    if (!household || brush === null) return null
    try {
      const cal = await api.calendar(household.id, start, end)
      setFlips((prev) => {
        const next = { ...prev }
        for (const d of cal.days) {
          if (d.parent_id === brush) delete next[d.date]
          else next[d.date] = { to: brush, clearId: null }
        }
        return next
      })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Impossible de calculer cette période.'
    }
  }

  function removeFlips(dates: string[]) {
    const next = { ...flips }
    for (const d of dates) delete next[d]
    setFlips(next)
  }

  function noticeFor(status: 'applied' | 'proposed' | 'pending_consent', count: number) {
    const days = count > 1 ? `${count} jours` : '1 jour'
    if (status === 'proposed') return `${days} proposé${count > 1 ? 's' : ''} à ${otherName} : ${count > 1 ? 'ils s’appliqueront' : 'il s’appliquera'} dès son accord.`
    if (status === 'pending_consent') return `Demande envoyée à ${otherName} pour revenir au rythme habituel.`
    return `${days} personnalisé${count > 1 ? 's' : ''}. Votre rythme habituel reprend ensuite tout seul.`
  }

  function saveAdjust() {
    const set: { date: string; parent_id: number }[] = []
    const clear: number[] = []
    for (const [date, f] of Object.entries(flips)) {
      if (f.clearId !== null) clear.push(f.clearId)
      else set.push({ date, parent_id: f.to })
    }
    const count = flipCount
    save.mutate({ set, clear }, {
      onSuccess: (res) => {
        setNotice(noticeFor(res.status, count))
        setAdjusting(false)
        setFlips({})
      },
    })
  }

  function backToRhythm(id: number) {
    save.mutate({ set: [], clear: [id] }, { onSuccess: (res) => setNotice(noticeFor(res.status, 1)) })
  }

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
        calendar.error instanceof ApiError && calendar.error.status === 409 ? (
          <View style={{ padding: 20, gap: 12 }}>
            <Body>Aucun rythme de garde défini pour l’instant.</Body>
            <Button title="Configurer mon rythme" onPress={() => router.push('/settings/rules')} />
          </View>
        ) : (
          <ErrorState message={calendar.error.message} onRetry={() => calendar.refetch()} />
        )
      ) : (
        <>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, gap: 12 }}>
          <CalendarNotices cal={calendar.data} />
          <View style={s.legendRow}>
            {calendar.data.members.map((m) => (
              <Legend key={m.id} color={m.color} label={m.id === meId ? 'Vous' : m.display_name} />
            ))}
            <Legend color={colors.holiday} label="Vacances" bar />
            {calendar.data.days.some((d) => d.source === 'adjustment') ? (
              <Legend color={colors.ink} label="Jour personnalisé" ring />
            ) : null}
          </View>

          {adjusting ? (
            <AdjustTools
              members={household?.members ?? []}
              meId={meId}
              tool={tool}
              onTool={setTool}
              brush={brush}
              onBrush={setBrush}
              onApplyPeriod={applyPeriod}
            />
          ) : (
            <View style={{ gap: 8, paddingHorizontal: 4 }}>
              {notice ? (
                <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
                  <Body style={{ fontSize: 14 }}>{notice}</Body>
                </Card>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  title="Ajuster mon planning"
                  variant="secondary"
                  icon={<Icon name="pencil" size={18} color={colors.pine} strokeWidth={2} />}
                  onPress={() => {
                    setAdjusting(true)
                    setTool('day')
                    setBrush(household?.members.find((m) => m.id !== meId)?.id ?? meId ?? null)
                    setFlips({})
                    setNotice(null)
                  }}
                  style={{ flex: 1 }}
                />
              </View>
              <Text accessibilityRole="button" onPress={() => router.push('/settings/rules')} style={s.rhythmLink}>
                Changer mon rythme habituel
              </Text>
            </View>
          )}

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
                isSelected={!adjusting && date === selected}
                flipColor={flips[date] ? memberById(calendar.data.members, flips[date].to)?.color : undefined}
                onPress={() => (adjusting ? paintDay(date) : setSelected(date))}
              />
            ))}
          </View>

          {!adjusting ? (
            <DayDetail
              key={selected}
              date={selected}
              cal={calendar.data}
              meId={meId}
              householdId={household?.id}
              adjustment={adjustmentOn(exceptions, selected)}
              onBackToRhythm={backToRhythm}
              busy={save.isPending}
            />
          ) : null}
          {save.error ? <Text style={[s.detailSub, { color: colors.danger, paddingHorizontal: 8 }]}>{save.error.message}</Text> : null}
        </ScrollView>
        {adjusting ? (
          <View style={s.bar}>
            {groups.length ? (
              <View style={{ gap: 6 }} accessibilityLabel="Jours modifiés">
                {groups.map((g) => (
                  <View key={g.start} style={s.recapRow}>
                    <View style={[s.recapDot, { backgroundColor: memberById(calendar.data.members, g.to)?.color ?? colors.ink }]} />
                    <Text style={[s.detailSub, { flex: 1, color: colors.ink }]}>
                      {formatRange(g.start, g.end)} · chez {nameOf(g.to)}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Retirer ${formatRange(g.start, g.end)}`}
                      onPress={() => removeFlips(g.dates)}
                      hitSlop={10}
                    >
                      <Icon name="close" size={16} color={colors.inkSoft} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={s.detailSub}>
              {flipCount === 0 ? 'Aucun jour modifié' : `${flipCount} ${flipCount > 1 ? 'jours modifiés' : 'jour modifié'}`}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                title="Annuler"
                variant="secondary"
                onPress={() => {
                  setAdjusting(false)
                  setFlips({})
                }}
                disabled={save.isPending}
                style={{ flex: 1 }}
              />
              <Button
                title={solo ? 'Enregistrer' : 'Proposer'}
                onPress={saveAdjust}
                loading={save.isPending}
                disabled={flipCount === 0}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}
        </>
      )}
    </SafeAreaView>
  )
}

function DayCell({ date, cal, inMonth, isToday, isSelected, flipColor, onPress }: {
  date: string
  cal: CalendarResponse
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  /** Couleur du parent visé quand le jour est touché en mode « Ajuster ». */
  flipColor?: string
  onPress: () => void
}) {
  const day = cal.days.find((d) => d.date === date)
  const color = flipColor ?? memberById(cal.members, day?.parent_id)?.color
  const adjusted = day?.source === 'adjustment'
  const vacation = schoolHolidayOn(cal, date)
  const holiday = publicHolidayOn(cal, date)
  const pending = pendingOn(cal, date)
  const owner = memberById(cal.members, day?.parent_id)?.display_name

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={[formatLong(date), owner ? `chez ${owner}` : null, adjusted ? 'jour personnalisé' : null, flipColor ? 'modifié' : null, vacation?.label, holiday?.label, pending ? 'échange proposé' : null]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
      style={[
        s.cell,
        { backgroundColor: color ? tint(color, 0.3) : colors.paperDeep, opacity: inMonth ? 1 : 0.4 },
        isSelected && { borderColor: colors.ink, borderWidth: 2 },
        adjusted && !isSelected && { borderColor: colors.ink, borderWidth: 1.5 },
        pending && !isSelected && { borderColor: colors.terraText, borderWidth: 2, borderStyle: 'dashed' },
        flipColor ? { borderColor: colors.ink, borderWidth: 2, borderStyle: 'dashed' } : null,
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

function DayDetail({ date, cal, meId, householdId, adjustment, onBackToRhythm, busy }: {
  date: string
  cal: CalendarResponse
  meId?: number
  householdId?: number
  adjustment?: ScheduleException
  onBackToRhythm: (id: number) => void
  busy: boolean
}) {
  const withdraw = useWithdrawExchange(householdId)
  const accepted = useAcceptedExchanges(householdId).data ?? []
  const [cancelNotice, setCancelNotice] = useState<string | null>(null)
  const cancel = useCancelExchange(householdId, (pending) =>
    setCancelNotice(pending ? 'Demande envoyée : l’échange sera annulé quand l’autre parent l’acceptera.' : 'Échange annulé.'),
  )
  const day = cal.days.find((d) => d.date === date)
  const member = memberById(cal.members, day?.parent_id)
  const vacation = schoolHolidayOn(cal, date)
  const holiday = publicHolidayOn(cal, date)
  const pending = pendingOn(cal, date)
  const who = (id?: number) => whoName(cal.members, id, meId)
  // Échange accepté qui couvre ce jour (annulable tant qu'il n'est pas passé) ; un jour
  // personnalisé se rend au rythme avec son propre bouton.
  const exchange = accepted.find((e) => e.kind !== 'adjustment' && e.date_start <= date && date <= e.date_end)

  function confirmCancel() {
    if (!exchange) return
    Alert.alert(
      'Annuler cet échange ?',
      `${formatRange(exchange.date_start, exchange.date_end)} : le rythme habituel reprend.${cal.members.length > 1 ? ' Avec deux parents, l’autre doit accepter l’annulation.' : ''}`,
      [
        { text: 'Garder', style: 'cancel' },
        { text: 'Annuler l’échange', style: 'destructive', onPress: () => cancel.mutate(exchange.id) },
      ],
    )
  }

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
      {day?.source === 'adjustment' && adjustment ? (
        <Button title="Revenir au rythme habituel" variant="ghost" onPress={() => onBackToRhythm(adjustment.id)} loading={busy} />
      ) : null}
      {exchange && exchange.date_end >= todayIso() ? (
        <Button title="Annuler cet échange" variant="ghost" onPress={confirmCancel} loading={cancel.isPending} />
      ) : null}
      {cancel.error ? <Text style={[s.detailSub, { color: colors.danger }]}>{cancel.error.message}</Text> : null}
      {cancelNotice ? <Text style={s.detailSub}>{cancelNotice}</Text> : null}
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

function Legend({ color, label, bar, ring }: { color: string; label: string; bar?: boolean; ring?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={
          bar
            ? { width: 14, height: 3, borderRadius: 2, backgroundColor: color }
            : ring
              ? { width: 10, height: 10, borderRadius: 3, borderWidth: 1.5, borderColor: color }
              : { width: 10, height: 10, borderRadius: 3, backgroundColor: color }
        }
      />
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
  hint: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, marginHorizontal: 4, borderRadius: 12,
    backgroundColor: colors.pineSoft,
  },
  rhythmLink: { alignSelf: 'center', fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine, paddingVertical: 6 },
  bar: {
    gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recapDot: { width: 10, height: 10, borderRadius: 5 },
  pending: {
    flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: 12,
    backgroundColor: '#fdf3ee', borderWidth: 1, borderColor: '#e8c4b2', borderStyle: 'dashed',
  },
})
