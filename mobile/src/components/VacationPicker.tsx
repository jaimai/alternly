// Partage des vacances scolaires (portage de frontend/src/components/VacationPicker.tsx) :
// un mode général, et au besoin un réglage période par période.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fonts } from '@/lib/theme'
import type { VacationMode, VacationPeriodKind, VacationPeriodModes } from '@/lib/types'
import { ChoiceCard } from './form'

const MODES: { value: VacationMode; title: string; desc: string; isNew?: boolean }[] = [
  { value: 'july_august', title: 'Juillet / août', desc: 'Un mois d’été chacun, inversé chaque année. Petites vacances : moitié chacun.', isNew: true },
  { value: 'split_half', title: 'Moitié chacun', desc: 'Chaque période est coupée en deux. L’ordre s’inverse chaque année.' },
  { value: 'weekly', title: 'Une semaine sur deux', desc: 'Pendant les vacances, une semaine chez chacun, du lundi au dimanche.', isNew: true },
  { value: 'alternate_full', title: 'Toutes les vacances, une année sur deux', desc: 'Toute la période chez un parent, puis chez l’autre l’année suivante.' },
]
const SHORT: Record<VacationMode, string> = { split_half: 'Moitié', alternate_full: 'Tout', july_august: 'Juil. / août', weekly: 'Sem. / sem.' }
const PERIODS: { kind: VacationPeriodKind; label: string }[] = [
  { kind: 'toussaint', label: 'Toussaint' },
  { kind: 'noel', label: 'Noël' },
  { kind: 'hiver', label: 'Hiver' },
  { kind: 'printemps', label: 'Printemps' },
  { kind: 'ete', label: 'Été' },
]

export function VacationPicker({ mode, onMode, periodModes, onPeriodModes, first, second, year }: {
  mode: VacationMode
  onMode: (mode: VacationMode) => void
  periodModes: VacationPeriodModes
  onPeriodModes: (value: VacationPeriodModes) => void
  /** Couleur du parent qui commence cette année, puis de l'autre. */
  first: string
  second: string
  year: number
}) {
  const [showPeriods, setShowPeriods] = useState(Object.keys(periodModes).length > 0)

  function setPeriod(kind: VacationPeriodKind, patch: Partial<{ mode: VacationMode; flip: boolean }>) {
    const next = { ...(periodModes[kind] ?? { mode, flip: false }), ...patch }
    // « Juillet / août » ne vaut que pour l'été : ailleurs, c'est un partage par moitié.
    if (next.mode === 'july_august' && kind !== 'ete') next.mode = 'split_half'
    const copy = { ...periodModes }
    // Identique au réglage général : pas de surcharge à garder.
    const general = mode === 'july_august' && kind !== 'ete' ? 'split_half' : mode
    if (next.mode === general && !next.flip) delete copy[kind]
    else copy[kind] = next
    onPeriodModes(copy)
  }

  return (
    <>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        {MODES.map((m) => (
          <ChoiceCard
            key={m.value}
            title={m.isNew ? `${m.title} · Nouveau` : m.title}
            description={m.desc}
            selected={mode === m.value}
            onPress={() => onMode(m.value)}
            aside={<Bars mode={m.value} first={first} second={second} year={year} />}
          />
        ))}
      </View>

      {showPeriods ? (
        <View style={{ gap: 8 }}>
          <Text style={s.hint}>Chaque période s’inverse d’une année sur l’autre. Le bouton de couleur dit qui commence.</Text>
          {PERIODS.map(({ kind, label }) => {
            const value = periodModes[kind] ?? { mode, flip: false }
            const options: VacationMode[] =
              kind === 'ete' ? ['split_half', 'july_august', 'alternate_full', 'weekly'] : ['split_half', 'alternate_full', 'weekly']
            const effective = value.mode === 'july_august' && kind !== 'ete' ? 'split_half' : value.mode
            return (
              <View key={kind} style={s.period}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[s.title, { flex: 1 }]}>{label}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: value.flip }}
                    onPress={() => setPeriod(kind, { flip: !value.flip })}
                    style={s.flip}
                  >
                    <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: value.flip ? second : first }} />
                    <Text style={s.flipText}>{value.flip ? 'Inversé' : 'Comme d’habitude'}</Text>
                  </Pressable>
                </View>
                <View style={s.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
                  {options.map((o) => (
                    <Pressable
                      key={o}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: effective === o }}
                      onPress={() => setPeriod(kind, { mode: o })}
                      style={[s.segItem, effective === o && s.segOn]}
                    >
                      <Text style={[s.segText, effective === o && { color: colors.ink }]}>{SHORT[o]}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )
          })}
          {Object.keys(periodModes).length ? (
            <Text accessibilityRole="button" onPress={() => onPeriodModes({})} style={s.link}>
              Tout remettre comme le choix général
            </Text>
          ) : null}
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setShowPeriods(true)} style={s.more}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.title}>Autre chose ? Période par période</Text>
            <Text style={s.hint}>Toussaint, Noël, hiver, printemps, été : réglées une par une</Text>
          </View>
          <Text style={[s.title, { fontSize: 20 }]}>›</Text>
        </Pressable>
      )}
    </>
  )
}

function Bars({ mode, first, second, year }: { mode: VacationMode; first: string; second: string; year: number }) {
  return (
    <View style={{ gap: 4, width: 92 }}>
      {[0, 1].map((i) => {
        const a = i === 0 ? first : second
        const b = i === 0 ? second : first
        const segs = mode === 'alternate_full' ? [a] : mode === 'weekly' ? [a, b, a, b] : [a, b]
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 10, color: colors.inkSoft, width: 28 }}>{year + i}</Text>
            <View style={{ flex: 1, height: 10, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' }}>
              {segs.map((c, k) => (
                <View key={k} style={{ flex: 1, backgroundColor: c }} />
              ))}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  title: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine, paddingVertical: 6 },
  more: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.inkSoft,
  },
  period: { gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  flip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: 999,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper,
  },
  flipText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  seg: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: 10, backgroundColor: colors.paperDeep },
  segItem: { flex: 1, minHeight: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface },
  segText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
})
