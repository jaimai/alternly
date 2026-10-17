// « Autre organisation » (portage de frontend/src/components/CustomRhythm.tsx) : on part du
// modèle le plus proche, on corrige les jours qui diffèrent, puis on vérifie sur un mois.
// Côté « ref » = le parent qui remplit le parcours (« vous »).
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { mondayOf, sideOn, weekday, type Side } from '@/lib/custodyPreview'
import { addDays, formatLong, parseIso, todayIso } from '@/lib/dates'
import { colors, fonts, tint } from '@/lib/theme'
import { ChoiceCard, DateField } from './form'
import { Body, Title } from './ui'

export type Cell = Side | null

/** Modèles sur 2 semaines (lundi → dimanche) : a = vous, b = l'autre parent, x = à placer. */
export const TEMPLATES = [
  { id: 'two_two_five_five', title: '2-2-5-5', desc: 'Lun-mar chez vous, mer-jeu chez l’autre, les week-ends en alternance.', cells: 'aabbaaaaabbbbb' },
  { id: 'weekdays_weekends', title: 'Semaine chez l’un, week-ends chez l’autre', desc: 'Du lundi au jeudi chez vous, du vendredi au dimanche chez l’autre.', cells: 'aaaabbbaaaabbb' },
  { id: 'weekend_wednesday', title: 'Un week-end sur deux + le mercredi', desc: 'L’enfant vit chez vous ; l’autre a le mercredi et un week-end sur deux.', cells: 'aabaabbaabaaaa' },
  { id: 'week_week_wednesday', title: 'Semaine / semaine + mercredi chez l’autre', desc: 'Une semaine chacun, et le mercredi passe chez l’autre parent.', cells: 'aabaaaabbabbbb' },
  { id: 'weekend_evening', title: 'Un week-end sur deux + une soirée', desc: 'Comme le week-end sur deux, avec un soir en semaine (mardi).', cells: 'abaabbbabaaaaa' },
  { id: 'blank', title: 'Je pars d’une grille vide', desc: 'Vous placez chaque jour vous-même.', cells: 'xxxxxxxxxxxxxx' },
] as const

/** Index réservé au rythme personnalisé déjà enregistré (réglages). */
export const CURRENT = -1

export function templateCells(index: number): Cell[] {
  return TEMPLATES[index].cells.split('').map((c) => (c === 'a' ? 'ref' : c === 'b' ? 'other' : null))
}

const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const DAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
const code = (cells: Cell[]) => cells.map((c) => (c === 'ref' ? 'a' : c === 'other' ? 'b' : 'x')).join('')

interface Common {
  colorOf: (side: Side) => string
  /** « chez vous », « chez l'autre parent » ou « chez Marie ». */
  atLabel: (side: Side) => string
}

export function TemplatePicker({ template, onPick, current, colorOf, atLabel }: Common & {
  template: number
  onPick: (i: number) => void
  /** Rythme personnalisé déjà en place : proposé en premier pour le retoucher. */
  current?: Cell[] | null
}) {
  return (
    <>
      <View style={{ gap: 6 }}>
        <Title>Lequel ressemble le plus à votre rythme ?</Title>
        <Body muted>Prenez le plus proche : vous corrigerez les jours qui diffèrent juste après.</Body>
      </View>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        {current ? (
          <ChoiceCard
            title="Mon rythme actuel"
            description="Repartir de vos deux semaines enregistrées."
            selected={template === CURRENT}
            onPress={() => onPick(CURRENT)}
            aside={<Thumb code={code(current)} colorOf={colorOf} />}
          />
        ) : null}
        {TEMPLATES.map((tpl, i) => (
          <ChoiceCard
            key={tpl.id}
            title={tpl.title}
            description={tpl.desc}
            selected={template === i}
            onPress={() => onPick(i)}
            aside={<Thumb code={tpl.cells} colorOf={colorOf} />}
          />
        ))}
      </View>
      <View style={s.legend}>
        {(['ref', 'other'] as Side[]).map((side) => (
          <View key={side} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: colorOf(side) }]} />
            <Text style={s.legendText}>{capitalize(atLabel(side))}</Text>
          </View>
        ))}
        <Text style={s.legendText}>Deux semaines, du lundi au dimanche</Text>
      </View>
    </>
  )
}

export function CycleDrawer({ cells, onChange, startDate, onStartDate, blank, onReset, colorOf, atLabel }: Common & {
  cells: Cell[]
  onChange: (cells: Cell[]) => void
  startDate: string
  onStartDate: (iso: string) => void
  blank: boolean
  onReset: () => void
}) {
  const [brush, setBrush] = useState<Side>(blank ? 'ref' : 'other')
  const [editDate, setEditDate] = useState(false)
  const anchor = mondayOf(startDate)
  const missing = cells.filter((c) => c === null).length
  const mine = cells.filter((c) => c === 'ref').length
  // Passages du cycle : jours où l'enfant change de foyer (le cycle boucle sur lui-même).
  const handovers = missing
    ? []
    : cells.flatMap((c, i) => (c !== cells[(i + 13) % 14] ? [`${DAY_LONG[i % 7]} (sem. ${i < 7 ? 1 : 2})`] : []))

  return (
    <>
      <View style={{ gap: 6 }}>
        <Title>{blank ? 'Placez vos deux semaines' : 'Corrigez les jours qui diffèrent'}</Title>
        <Body muted>Choisissez chez qui, puis touchez les jours à mettre de ce côté. Ces deux semaines se répètent ensuite.</Body>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Parent à placer sur les jours touchés">
        {(['ref', 'other'] as Side[]).map((side) => {
          const on = brush === side
          return (
            <Pressable
              key={side}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setBrush(side)}
              style={[s.brush, on && { backgroundColor: colors.surface, borderWidth: 2.5, borderColor: colorOf(side) }]}
            >
              <View style={[s.brushDot, { backgroundColor: colorOf(side) }]} />
              <Text style={s.brushText}>{capitalize(atLabel(side))}</Text>
            </Pressable>
          )
        })}
      </View>

      <View style={s.card}>
        {[0, 1].map((w) => (
          <View key={w} style={{ gap: 6 }}>
            <Text style={s.weekLabel}>Semaine {w + 1}</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {cells.slice(w * 7, w * 7 + 7).map((c, j) => {
                const i = w * 7 + j
                const day = addDays(anchor, i)
                return (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    accessibilityLabel={`${DAY_LONG[j]} ${parseIso(day).getDate()} : ${c ? atLabel(c) : 'à placer'}`}
                    onPress={() => onChange(cells.map((v, k) => (k === i ? brush : v)))}
                    style={[s.day, c ? { backgroundColor: tint(colorOf(c), 0.32) } : s.dayUnset]}
                  >
                    <Text style={s.dayDow}>{DAY_SHORT[j]}</Text>
                    <Text style={s.dayNum}>{parseIso(day).getDate()}</Text>
                    {c ? <View style={[s.dayStrip, { backgroundColor: colorOf(c) }]} /> : null}
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}
        {editDate ? (
          <DateField label="Début de la semaine 1" value={startDate} onChange={onStartDate} />
        ) : (
          <Body muted style={{ fontSize: 14 }}>
            La semaine 1 commence le {formatLong(anchor)}.{' '}
            <Text accessibilityRole="button" onPress={() => setEditDate(true)} style={s.link}>
              Changer
            </Text>
          </Body>
        )}
      </View>

      <View style={s.summary} accessibilityLiveRegion="polite">
        {missing ? (
          <Text style={s.summaryMain}>Il reste {missing} {missing > 1 ? 'jours' : 'jour'} à placer.</Text>
        ) : (
          <>
            <Text style={s.summaryMain}>
              Sur 2 semaines : {mine} jours chez vous, {14 - mine} chez l’autre parent.
            </Text>
            <Text style={s.summarySub}>
              {handovers.length
                ? `${handovers.length} ${handovers.length > 1 ? 'passages' : 'passage'} : ${handovers.join(', ')}.`
                : 'Aucun passage : l’enfant reste chez le même parent.'}
            </Text>
          </>
        )}
      </View>

      <Text accessibilityRole="button" onPress={onReset} style={s.reset}>
        {blank ? 'Tout effacer' : 'Revenir au modèle de départ'}
      </Text>
    </>
  )
}

export function MonthCheck({ cells, startDate, colorOf, atLabel }: Common & { cells: Side[]; startDate: string }) {
  const rule = { pattern: 'custom' as const, start_date: startDate, handover_day: 0, custom_weeks: cells }
  const today = todayIso()
  const first = `${today.slice(0, 8)}01`
  const days: string[] = []
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) days.push(d)
  const sides = days.map((d) => sideOn(rule, d))
  const mine = sides.filter((x) => x === 'ref').length
  const month = parseIso(first).toLocaleDateString('fr-FR', { month: 'long' })

  let next: string | null = null
  for (let i = 1; i <= 28 && !next; i++) {
    const d = addDays(today, i)
    if (sideOn(rule, d) !== sideOn(rule, addDays(d, -1))) next = d
  }

  const pad = weekday(first)
  const slots: (string | null)[] = [...Array<null>(pad).fill(null), ...days]
  while (slots.length % 7) slots.push(null)

  return (
    <>
      <View style={{ gap: 6 }}>
        <Title>Voici à quoi ressemble {month}</Title>
        <Body muted>Vos deux semaines, répétées. Si un jour ne va pas, revenez corriger : rien n’est figé.</Body>
      </View>
      <View style={s.card}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {DAY_SHORT.map((d, i) => (
            <Text key={i} style={[s.weekLabel, { flex: 1, textAlign: 'center' }]}>
              {d}
            </Text>
          ))}
        </View>
        {Array.from({ length: slots.length / 7 }, (_, w) => (
          <View key={w} style={{ flexDirection: 'row', gap: 4 }}>
            {slots.slice(w * 7, w * 7 + 7).map((d, j) => {
              if (!d) return <View key={j} style={{ flex: 1 }} />
              const side = sides[days.indexOf(d)]
              return (
                <View
                  key={d}
                  accessibilityLabel={`${formatLong(d)} : ${atLabel(side)}`}
                  style={[s.monthDay, { backgroundColor: tint(colorOf(side), 0.32) }, d === today && { borderColor: colors.ink }]}
                >
                  <Text style={s.dayNum}>{parseIso(d).getDate()}</Text>
                  <View style={[s.dayStrip, { backgroundColor: colorOf(side) }]} />
                </View>
              )
            })}
          </View>
        ))}
      </View>
      <View style={s.legend}>
        {(['ref', 'other'] as Side[]).map((side) => {
          const n = side === 'ref' ? mine : days.length - mine
          return (
            <View key={side} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: colorOf(side) }]} />
              <Text style={[s.legendText, { color: colors.ink }]}>
                {capitalize(atLabel(side))} · {n} {n > 1 ? 'jours' : 'jour'}
              </Text>
            </View>
          )
        })}
      </View>
      {next ? (
        <View style={s.summary}>
          <Text style={s.summarySub}>
            Prochain passage : {formatLong(next)}, {atLabel(sideOn(rule, next))}.
          </Text>
        </View>
      ) : null}
    </>
  )
}

/** Vignette 2 semaines : a = vous, b = l'autre parent, x = à placer. */
export function Thumb({ code: c, colorOf }: { code: string; colorOf?: (side: Side) => string }) {
  const color = (x: string) =>
    x === 'a' ? (colorOf?.('ref') ?? colors.pine) : x === 'b' ? (colorOf?.('other') ?? colors.terra) : colors.line
  return (
    <View style={{ gap: 2, width: 84 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1].map((w) => (
        <View key={w} style={{ flexDirection: 'row', gap: 2 }}>
          {c.slice(w * 7, w * 7 + 7).split('').map((x, i) => (
            <View key={i} style={{ flex: 1, height: 14, borderRadius: 3, backgroundColor: color(x) }} />
          ))}
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, columnGap: 14, alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  brush: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12,
    borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paperDeep,
  },
  brushDot: { width: 22, height: 22, borderRadius: 7 },
  brushText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  weekLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSoft },
  day: {
    flex: 1, height: 54, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  dayUnset: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.inkSoft, backgroundColor: 'transparent' },
  dayStrip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5 },
  dayDow: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.inkSoft },
  dayNum: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  monthDay: {
    flex: 1, height: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
  },
  link: { fontFamily: fonts.bodySemiBold, color: colors.pine },
  summary: { backgroundColor: colors.pineSoft, borderRadius: 14, padding: 14, gap: 4 },
  summaryMain: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  summarySub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  reset: { alignSelf: 'center', fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, paddingVertical: 10 },
})
