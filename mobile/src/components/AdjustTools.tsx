// Outils du mode « Ajuster » (portage de frontend/src/components/AdjustTools.tsx) :
// pinceau (chez qui vont les jours touchés), jour par jour ou une période d'un coup.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { addDays, daysBetween, isoLocal, parseIso, todayIso } from '@/lib/dates'
import { colors, fonts } from '@/lib/theme'
import type { Member } from '@/lib/types'
import { DateField } from './form'
import { Button } from './ui'

export type AdjustTool = 'day' | 'period' | 'repeat'
/** Une période : seulement cette fois, ou chaque année (pareil ou en alternance). */
export type PeriodRepeat = 'once' | 'alternate' | 'every_year'
const TOOL_LABEL: Record<AdjustTool, string> = { day: 'Jour par jour', period: 'Une période', repeat: 'Répéter' }
const REPEAT_LABEL: Record<PeriodRepeat, string> = {
  once: 'Seulement cette fois',
  alternate: 'Une année sur deux, en alternance',
  every_year: 'Tous les ans pareil',
}
const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const DAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
export const PERIOD_MAX_DAYS = 120

function shortcuts(today: string) {
  const d = parseIso(today)
  const weekday = (d.getDay() + 6) % 7 // 0 = lundi
  const saturday = weekday === 6 ? addDays(today, -1) : addDays(today, 5 - weekday)
  const nextMonday = addDays(today, 7 - weekday)
  const summerYear = d.getMonth() > 7 ? d.getFullYear() + 1 : d.getFullYear()
  const month = (m: number) => ({ start: isoLocal(new Date(summerYear, m, 1)), end: isoLocal(new Date(summerYear, m + 1, 0)) })
  return [
    { label: 'Ce week-end', start: saturday, end: addDays(saturday, 1) },
    { label: 'Semaine prochaine', start: nextMonday, end: addDays(nextMonday, 6) },
    { label: 'Tout juillet', ...month(6) },
    { label: 'Tout août', ...month(7) },
  ]
}

export function AdjustTools({ members, meId, tool, onTool, brush, onBrush, onApplyPeriod, onAddWeekly }: {
  members: Member[]
  meId: number | undefined
  tool: AdjustTool
  onTool: (tool: AdjustTool) => void
  brush: number | null
  onBrush: (parentId: number) => void
  /** Met la période chez le parent du pinceau ; renvoie un message d'erreur, sinon null. */
  onApplyPeriod: (start: string, end: string, repeat: PeriodRepeat) => Promise<string | null>
  /** Ajoute une règle « chaque semaine » au récapitulatif. */
  onAddWeekly: (rule: { weekdays: number[]; every_other_week: boolean; include_vacations: boolean }) => void
}) {
  const today = todayIso()
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(addDays(today, 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repeat, setRepeat] = useState<PeriodRepeat>('once')
  const [weekdays, setWeekdays] = useState<number[]>([2])
  const [everyOther, setEveryOther] = useState(false)
  const [withHolidays, setWithHolidays] = useState(false)
  const label = (m: Member) => (m.id === meId ? 'Chez vous' : m.is_placeholder ? 'Chez l’autre parent' : `Chez ${m.display_name}`)

  async function apply() {
    setError(null)
    if (end < start) return setError('La date de fin est avant la date de début.')
    if (daysBetween(start, end) + 1 > PERIOD_MAX_DAYS) return setError(`${PERIOD_MAX_DAYS} jours au plus d’un coup.`)
    setBusy(true)
    const err = await onApplyPeriod(start, end, repeat)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <View style={s.box}>
      <View style={s.seg} accessibilityRole="tablist">
        {(['day', 'period', 'repeat'] as AdjustTool[]).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: tool === k }}
            onPress={() => onTool(k)}
            style={[s.segItem, tool === k && s.segOn]}
          >
            <Text style={[s.segText, tool === k && { color: colors.ink }]}>{TOOL_LABEL[k]}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Chez qui vont les jours touchés">
        {members.map((m) => {
          const on = brush === m.id
          return (
            <Pressable
              key={m.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onBrush(m.id)}
              style={[s.brush, on && { backgroundColor: colors.surface, borderWidth: 2.5, borderColor: m.color }]}
            >
              <View style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: m.color }} />
              <Text style={s.brushText}>{label(m)}</Text>
            </Pressable>
          )
        })}
      </View>

      {tool === 'day' ? (
        <Text style={s.hint}>Touchez les jours à mettre de ce côté. Pour en retirer un, utilisez la croix dans le récap.</Text>
      ) : null}
      {tool === 'repeat' ? (
        <View style={{ gap: 10 }}>
          <Text style={s.hint}>Une règle en plus de votre rythme, pour ce qui revient souvent. Le rythme habituel ne change pas.</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {DAY_SHORT.map((d, i) => {
              const on = weekdays.includes(i)
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={DAY_LONG[i]}
                  accessibilityState={{ selected: on }}
                  onPress={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort()))}
                  style={[s.day, on && s.dayOn]}
                >
                  <Text style={[s.dayText, on && { color: '#fff' }]}>{d}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[false, true].map((v) => (
              <Pressable key={String(v)} accessibilityRole="button" accessibilityState={{ selected: everyOther === v }} onPress={() => setEveryOther(v)} style={[s.chip, everyOther === v && s.chipOn]}>
                <Text style={[s.chipText, everyOther === v && { color: colors.pine }]}>{v ? 'Une semaine sur deux' : 'Chaque semaine'}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: withHolidays }} onPress={() => setWithHolidays(!withHolidays)} style={s.check}>
            <View style={[s.box2, withHolidays && s.box2On]} />
            <Text style={s.chipText}>Aussi pendant les vacances scolaires</Text>
          </Pressable>
          <Button
            title="Ajouter cette règle"
            disabled={weekdays.length === 0}
            onPress={() => onAddWeekly({ weekdays, every_other_week: everyOther, include_vacations: withHolidays })}
          />
        </View>
      ) : null}
      {tool === 'period' ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {shortcuts(today).map((c) => {
              const on = c.start === start && c.end === end
              return (
                <Pressable
                  key={c.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setStart(c.start)
                    setEnd(c.end)
                    setError(null)
                  }}
                  style={[s.chip, on && s.chipOn]}
                >
                  <Text style={[s.chipText, on && { color: colors.pine }]}>{c.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <DateField label="Du" value={start} onChange={setStart} />
            <DateField label="Au (inclus)" value={end} onChange={setEnd} min={start} />
          </View>
          <View style={{ gap: 4 }} accessibilityRole="radiogroup" accessibilityLabel="Et les autres années ?">
            <Text style={s.hint}>Et les autres années ?</Text>
            {(['once', 'alternate', 'every_year'] as PeriodRepeat[]).map((r) => (
              <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: repeat === r }} onPress={() => setRepeat(r)} style={s.check}>
                <View style={[s.radio, repeat === r && s.radioOn]} />
                <Text style={s.chipText}>{REPEAT_LABEL[r]}</Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text style={[s.hint, { color: colors.danger }]}>{error}</Text> : null}
          <Button title={busy ? 'Calcul…' : 'Appliquer à ces dates'} onPress={apply} loading={busy} />
        </View>
      ) : null}
    </View>
  )
}

const s = StyleSheet.create({
  box: { gap: 10, padding: 12, marginHorizontal: 4, borderRadius: 14, backgroundColor: colors.pineSoft },
  seg: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: 10, backgroundColor: colors.paperDeep },
  segItem: { flex: 1, minHeight: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface },
  segText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSoft },
  brush: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper,
  },
  brushText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: 'center' },
  chipOn: { borderWidth: 2, borderColor: colors.pine, backgroundColor: colors.pineSoft },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  day: { flex: 1, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.pine, borderColor: colors.pine },
  dayText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  box2: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: colors.inkSoft },
  box2On: { backgroundColor: colors.pine, borderColor: colors.pine },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.inkSoft },
  radioOn: { borderWidth: 6, borderColor: colors.pine },
})
