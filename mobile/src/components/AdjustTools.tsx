// Outils du mode « Ajuster » (portage de frontend/src/components/AdjustTools.tsx) :
// pinceau (chez qui vont les jours touchés), jour par jour ou une période d'un coup.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { addDays, daysBetween, isoLocal, parseIso, todayIso } from '@/lib/dates'
import { colors, fonts } from '@/lib/theme'
import type { Member } from '@/lib/types'
import { DateField } from './form'
import { Button } from './ui'

export type AdjustTool = 'day' | 'period'
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

export function AdjustTools({ members, meId, tool, onTool, brush, onBrush, onApplyPeriod }: {
  members: Member[]
  meId: number | undefined
  tool: AdjustTool
  onTool: (tool: AdjustTool) => void
  brush: number | null
  onBrush: (parentId: number) => void
  /** Met la période chez le parent du pinceau ; renvoie un message d'erreur, sinon null. */
  onApplyPeriod: (start: string, end: string) => Promise<string | null>
}) {
  const today = todayIso()
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(addDays(today, 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = (m: Member) => (m.id === meId ? 'Chez vous' : m.is_placeholder ? 'Chez l’autre parent' : `Chez ${m.display_name}`)

  async function apply() {
    setError(null)
    if (end < start) return setError('La date de fin est avant la date de début.')
    if (daysBetween(start, end) + 1 > PERIOD_MAX_DAYS) return setError(`${PERIOD_MAX_DAYS} jours au plus d’un coup.`)
    setBusy(true)
    const err = await onApplyPeriod(start, end)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <View style={s.box}>
      <View style={s.seg} accessibilityRole="tablist">
        {(['day', 'period'] as AdjustTool[]).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: tool === k }}
            onPress={() => onTool(k)}
            style={[s.segItem, tool === k && s.segOn]}
          >
            <Text style={[s.segText, tool === k && { color: colors.ink }]}>{k === 'day' ? 'Jour par jour' : 'Une période'}</Text>
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
      ) : (
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
          {error ? <Text style={[s.hint, { color: colors.danger }]}>{error}</Text> : null}
          <Button title={busy ? 'Calcul…' : 'Appliquer à ces dates'} onPress={apply} loading={busy} />
        </View>
      )}
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
})
