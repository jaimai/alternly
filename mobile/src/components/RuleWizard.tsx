// Règle de garde en 4 petites étapes (portage de frontend/src/components/RuleWizard.tsx) :
// rythme → qui a les enfants à une date précise → vérifier/ajuster jour par jour → vacances.
// « Autre organisation » : modèle proche → grille à corriger → aperçu du mois → vacances.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { flipDay, mondayOf, sideOn, weekday, type Pattern, type Side } from '@/lib/custodyPreview'
import { addDays, formatLong, parseIso, todayIso } from '@/lib/dates'
import { colors, fonts, tint } from '@/lib/theme'
import type { CustodyRule, Member, VacationMode, VacationPeriodModes, VacationRule } from '@/lib/types'
import { CURRENT, CycleDrawer, MonthCheck, TEMPLATES, TemplatePicker, Thumb, templateCells, type Cell } from './CustomRhythm'
import { ChoiceCard, DateField, Progress, Segmented } from './form'
import { VacationPicker } from './VacationPicker'
import { Avatar, Body, Button, Title } from './ui'

const PATTERNS: { value: Pattern; title: string; desc: string; thumb: string }[] = [
  { value: 'alternate_weeks', title: 'Semaine / semaine', desc: 'Une semaine chez chacun, avec un jour de passage fixe.', thumb: 'aaaaaaabbbbbbb' },
  { value: 'every_other_weekend', title: 'Un week-end sur deux', desc: 'L’enfant vit chez un parent ; l’autre l’accueille un week-end sur deux.', thumb: 'bbbbaaabbbbbbb' },
  { value: 'two_two_three', title: '2-2-3', desc: '2 jours chacun, puis 3 jours. Souvent choisi pour les tout-petits.', thumb: 'aabbaaabbaabbb' },
  { value: 'custom', title: 'Autre organisation', desc: 'Partez d’un modèle proche, puis corrigez les jours qui diffèrent.', thumb: 'xxxxxxxxxxxxxx' },
]
const VAC_COPY: Record<VacationMode, { who: string; me: string; other: string }> = {
  split_half: {
    who: 'Cette année ({year}), qui a la première moitié ?',
    me: 'Exemple : aux prochaines vacances, vous avez la première moitié, l’autre parent la seconde. L’an prochain, c’est l’inverse.',
    other: 'Exemple : aux prochaines vacances, l’autre parent a la première moitié, vous la seconde. L’an prochain, c’est l’inverse.',
  },
  alternate_full: {
    who: 'Cette année ({year}), qui a les vacances ?',
    me: 'Exemple : cette année, les vacances sont chez vous ; l’an prochain, chez l’autre parent.',
    other: 'Exemple : cette année, les vacances sont chez l’autre parent ; l’an prochain, chez vous.',
  },
  july_august: {
    who: 'Cette année ({year}), qui a juillet ?',
    me: 'Exemple : l’été de cette année, juillet est chez vous et août chez l’autre parent. L’an prochain, c’est l’inverse.',
    other: 'Exemple : l’été de cette année, juillet est chez l’autre parent et août chez vous. L’an prochain, c’est l’inverse.',
  },
  weekly: {
    who: 'Cette année ({year}), qui a la première semaine ?',
    me: 'Exemple : aux prochaines vacances, la première semaine est chez vous, la suivante chez l’autre parent, et ainsi de suite.',
    other: 'Exemple : aux prochaines vacances, la première semaine est chez l’autre parent, la suivante chez vous, et ainsi de suite.',
  },
}
const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const DAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const DEFAULT_CUSTOM: Side[] = Array.from({ length: 14 }, (_, i) => (i < 7 ? 'ref' : 'other'))
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export interface RuleValue {
  custody: CustodyRule
  vacation: VacationRule
}

export function RuleWizard({ members, myId, childNames, busy, stepOffset, stepTotal, initial, submitLabel, onSubmit }: {
  members: Member[]
  myId: number
  childNames: string[]
  busy?: boolean
  /** Règles actuelles (réglages) : le parcours part de là au lieu des valeurs par défaut. */
  initial?: { custody: CustodyRule | null; vacation: VacationRule | null }
  submitLabel?: string
  /** Position dans le parcours global (barre de progression de l'onboarding). */
  stepOffset: number
  stepTotal: number
  onSubmit: (value: RuleValue) => void
}) {
  const me = members.find((m) => m.id === myId)
  const other = members.find((m) => m.id !== myId)
  const [step, setStep] = useState(0)
  const c = initial?.custody
  const v = initial?.vacation
  const [pattern, setPattern] = useState<Pattern>(c?.pattern ?? 'alternate_weeks')
  const [startDate, setStartDate] = useState(c?.start_date ?? todayIso())
  const [showDate, setShowDate] = useState(false)
  const [referenceParent, setReferenceParent] = useState(c?.reference_parent_id ?? myId)
  const [handoverDay, setHandoverDay] = useState(c?.handover_day ?? 0)
  const [handoverTime, setHandoverTime] = useState(c?.handover_time ?? '18:00')
  const [customWeeks, setCustomWeeks] = useState<Side[]>((c?.custom_weeks as Side[] | null) ?? DEFAULT_CUSTOM)
  const [vacMode, setVacMode] = useState<VacationMode>(v?.mode ?? 'split_half')
  const [periodModes, setPeriodModes] = useState<VacationPeriodModes>(v?.period_modes ?? {})
  const [evenParent, setEvenParent] = useState(v?.even_year_first_half_parent_id ?? myId)
  const [adjust, setAdjust] = useState<{ day: string; before: { pattern: Pattern; customWeeks: Side[] } } | null>(null)
  // Rythme personnalisé déjà enregistré, vu depuis « vous » (côté ref = le parent connecté).
  const [currentCells] = useState<Cell[] | null>(() =>
    c?.pattern === 'custom' && c.custom_weeks?.length === 14
      ? (c.custom_weeks as Side[]).map((x) => (c.reference_parent_id === myId ? x : x === 'ref' ? 'other' : 'ref'))
      : null,
  )
  const [customFlow, setCustomFlow] = useState(false)
  const [template, setTemplate] = useState(currentCells ? CURRENT : 0)
  const [cells, setCells] = useState<Cell[]>(() => currentCells ?? templateCells(0))
  const [cellsFrom, setCellsFrom] = useState<number | null>(null)
  const [monthView, setMonthView] = useState(false)
  const cellsOf = (i: number) => (i === CURRENT && currentCells ? currentCells : templateCells(i))

  const kids = childNames.length === 1 ? childNames[0] : childNames.length > 1 ? 'les enfants' : 'l’enfant'
  const rule = { pattern, start_date: startDate, handover_day: handoverDay, custom_weeks: customWeeks }
  const memberOf = (side: Side) => members.find((m) => (side === 'ref' ? m.id === referenceParent : m.id !== referenceParent))
  const colorOf = (side: Side) => memberOf(side)?.color ?? (side === 'ref' ? colors.pine : colors.terra)
  const nameOf = (side: Side) => {
    const m = memberOf(side)
    if (!m) return 'l’autre parent'
    return m.id === myId ? `${m.display_name} (vous)` : m.is_placeholder ? 'l’autre parent' : m.display_name
  }
  const thisMonday = mondayOf(todayIso())
  const weeks = [0, 1].map((w) => Array.from({ length: 7 }, (_, i) => addDays(thisMonday, w * 7 + i)))
  const timeValid = TIME.test(handoverTime)

  function whoQuestion(): string {
    switch (pattern) {
      case 'alternate_weeks': {
        const offset = (((weekday(startDate) - handoverDay) % 7) + 7) % 7
        return `Qui a ${kids} la semaine qui commence le ${formatLong(addDays(startDate, -offset))} ?`
      }
      case 'every_other_weekend':
        return `Qui accueille ${kids} le week-end du ${formatLong(addDays(mondayOf(startDate), 5))} ?`
      default:
        return `Qui a ${kids} le ${formatLong(mondayOf(startDate))} ?`
    }
  }

  function flip(day: string) {
    const before = { pattern, customWeeks }
    setCustomWeeks(flipDay(rule, day))
    setPattern('custom')
    setAdjust((prev) => ({ day, before: prev?.before ?? before }))
  }

  // Vacances : la question porte sur l'année en cours ; le moteur retient le parent
  // qui a la 1re moitié (ou toutes les vacances) les années paires.
  const year = new Date().getFullYear()
  const evenYear = year % 2 === 0
  const otherId = (id: number) => members.find((m) => m.id !== id)?.id ?? id
  const thisYearParent = evenYear ? evenParent : otherId(evenParent)
  const setThisYearParent = (id: number) => setEvenParent(evenYear ? id : otherId(id))

  const atLabel = (side: Side) => {
    const m = memberOf(side)
    if (m?.id === myId) return 'chez vous'
    return m && !m.is_placeholder ? `chez ${m.display_name}` : 'chez l’autre parent'
  }
  const missing = cells.some((x) => x === null)

  function next() {
    if (customFlow && step === 1) {
      if (cellsFrom !== template) {
        setCells(cellsOf(template))
        setCellsFrom(template)
      }
      setMonthView(false)
      setStep(2)
    } else if (customFlow && step === 2 && !monthView) {
      if (missing) return
      setCustomWeeks(cells as Side[])
      setMonthView(true)
    } else {
      if (step === 0) {
        const custom = pattern === 'custom'
        setCustomFlow(custom)
        if (custom) setReferenceParent(myId)
      }
      setStep(step + 1)
    }
  }

  function back() {
    if (customFlow && step === 2 && monthView) setMonthView(false)
    else setStep(step - 1)
  }

  function nextLabel() {
    if (customFlow && step === 1) return 'Partir de ce modèle'
    if (customFlow && step === 2) return monthView ? 'C’est bon, continuer' : 'Voir le résultat sur un mois'
    return step === 2 ? 'C’est bon, continuer' : 'Continuer'
  }

  function submit() {
    if (busy) return
    onSubmit({
      custody: {
        pattern,
        start_date: startDate,
        reference_parent_id: referenceParent,
        handover_day: handoverDay,
        handover_time: handoverTime,
        custom_weeks: pattern === 'custom' ? customWeeks : null,
      },
      vacation: {
        mode: vacMode,
        even_year_first_half_parent_id: evenParent,
        period_modes: Object.keys(periodModes).length ? periodModes : null,
      },
    })
  }

  const whoButtons = (compact: boolean, selectedId: number, onSelect: (id: number) => void) => (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {[me, other].filter((m): m is Member => !!m).map((m) => {
        const selected = selectedId === m.id
        return (
          <Pressable
            key={m.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onSelect(m.id)}
            style={[s.who, compact && { paddingVertical: 12 }, selected && s.whoOn]}
          >
            {!compact ? <Avatar name={m.is_placeholder ? '?' : m.display_name} color={m.color} size={40} /> : null}
            <Text style={s.whoTitle}>{m.id === myId ? 'Moi' : 'L’autre parent'}</Text>
            {!compact ? (
              <Text style={s.whoSub}>{m.id === myId ? m.display_name : m.is_placeholder ? 'pas encore invité' : m.display_name}</Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )

  const preview = (editable: boolean) => (
    <View style={s.previewCard}>
      {weeks.map((week, w) => (
        <View key={w} style={{ gap: 6 }}>
          <Text style={s.weekLabel}>Semaine du {formatLong(week[0])}</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {week.map((day, i) => {
              const side = sideOn(rule, day)
              const label = `${DAY_LONG[i]} ${parseIso(day).getDate()} : ${nameOf(side)}`
              return (
                <Pressable
                  key={day}
                  disabled={!editable}
                  accessibilityRole={editable ? 'button' : 'text'}
                  accessibilityLabel={editable ? `${label}. Toucher pour changer de parent` : label}
                  onPress={() => flip(day)}
                  style={[s.day, { backgroundColor: tint(colorOf(side), 0.32) }, adjust?.day === day && editable && s.dayTouched]}
                >
                  <Text style={s.dayDow}>{DAY_SHORT[i]}</Text>
                  <Text style={s.dayNum}>{parseIso(day).getDate()}</Text>
                  <View style={[s.dayStrip, { backgroundColor: colorOf(side) }]} />
                </Pressable>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )

  return (
    <View style={{ gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {step > 0 ? (
          <Text accessibilityRole="button" onPress={back} style={s.back}>
            ← Retour
          </Text>
        ) : null}
        <View style={{ flex: 1 }}>
          <Progress step={stepOffset + step + 1} total={stepTotal} label={`Votre rythme · ${step + 1}/4`} />
        </View>
      </View>

      {step === 0 && (
        <>
          <View style={{ gap: 6 }}>
            <Title>Comment se passe la garde aujourd’hui ?</Title>
            <Body muted>Choisissez ce qui ressemble le plus à votre organisation. Vous ajusterez jour par jour juste après.</Body>
          </View>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {PATTERNS.map((p) => (
              <ChoiceCard
                key={p.value}
                title={p.title}
                description={p.desc}
                selected={pattern === p.value}
                onPress={() => {
                  setPattern(p.value)
                  setAdjust(null)
                }}
                aside={<Thumb code={p.thumb} />}
              />
            ))}
          </View>
        </>
      )}

      {customFlow && step === 1 ? (
        <TemplatePicker template={template} onPick={setTemplate} current={currentCells} colorOf={colorOf} atLabel={atLabel} />
      ) : null}

      {customFlow && step === 2 && !monthView ? (
        <CycleDrawer
          key={cellsFrom ?? 'none'}
          cells={cells}
          onChange={setCells}
          startDate={startDate}
          onStartDate={setStartDate}
          blank={template !== CURRENT && TEMPLATES[template].id === 'blank'}
          onReset={() => setCells(cellsOf(template))}
          colorOf={colorOf}
          atLabel={atLabel}
        />
      ) : null}

      {customFlow && step === 2 && monthView ? (
        <MonthCheck cells={customWeeks} startDate={startDate} colorOf={colorOf} atLabel={atLabel} />
      ) : null}

      {!customFlow && step === 1 && (
        <>
          <Title style={{ fontSize: 24, lineHeight: 30 }}>{whoQuestion()}</Title>
          {pattern === 'every_other_weekend' ? (
            <Body muted>Le reste du temps, {kids} vit chez l’autre parent. Les week-ends s’alternent ensuite tout seuls.</Body>
          ) : null}
          {whoButtons(false, referenceParent, setReferenceParent)}
          {pattern === 'alternate_weeks' ? (
            <>
              <Segmented
                label="Jour de passage"
                value={handoverDay}
                onChange={setHandoverDay}
                options={DAY_SHORT.map((d, i) => ({ value: i, label: d }))}
              />
              <View style={{ gap: 8 }}>
                <Text style={s.label}>Heure de passage</Text>
                <TextInput
                  accessibilityLabel="Heure de passage (HH:MM)"
                  value={handoverTime}
                  onChangeText={setHandoverTime}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={[s.input, !timeValid && { borderColor: colors.danger }]}
                />
                {!timeValid ? <Text style={s.error}>Format attendu : 18:00</Text> : null}
              </View>
            </>
          ) : null}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={s.label}>Aperçu</Text>
              <Text style={s.hint}>mis à jour en direct</Text>
            </View>
            {preview(false)}
          </View>
          {showDate ? (
            <DateField label="Date de départ" value={startDate} onChange={setStartDate} />
          ) : (
            <Body muted style={{ fontSize: 14 }}>
              Ce n’est pas la bonne semaine de départ ?{' '}
              <Text accessibilityRole="button" onPress={() => setShowDate(true)} style={s.link}>
                Choisir une autre date
              </Text>
            </Body>
          )}
        </>
      )}

      {!customFlow && step === 2 && (
        <>
          <View style={{ gap: 6 }}>
            <Title>Ça correspond à votre organisation ?</Title>
            <Body muted>Un jour ne colle pas ? Touchez-le pour le donner à l’autre parent. Le cycle se répète ensuite toutes les deux semaines.</Body>
          </View>
          <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
            {(['ref', 'other'] as Side[]).map((side) => (
              <View key={side} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(side) }} />
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.ink }}>
                  {nameOf(side).charAt(0).toUpperCase() + nameOf(side).slice(1)}
                </Text>
              </View>
            ))}
          </View>
          {preview(true)}
          {adjust ? (
            <View accessibilityRole="alert" style={s.toast}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' }}>
                  Le {formatLong(adjust.day)} passe chez {nameOf(sideOn(rule, adjust.day))}.
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
                  Votre rythme devient « personnalisé ».
                </Text>
              </View>
              <Text
                accessibilityRole="button"
                onPress={() => {
                  setPattern(adjust.before.pattern)
                  setCustomWeeks(adjust.before.customWeeks)
                  setAdjust(null)
                }}
                style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff', padding: 8 }}
              >
                Annuler
              </Text>
            </View>
          ) : null}
        </>
      )}

      {step === 3 && (
        <>
          <Title>Et pendant les vacances scolaires ?</Title>
          <VacationPicker
            mode={vacMode}
            onMode={setVacMode}
            periodModes={periodModes}
            onPeriodModes={setPeriodModes}
            first={colorOf(thisYearParent === referenceParent ? 'ref' : 'other')}
            second={colorOf(thisYearParent === referenceParent ? 'other' : 'ref')}
            year={year}
          />
          <Text style={s.question}>{VAC_COPY[vacMode].who.replace('{year}', String(year))}</Text>
          {whoButtons(true, thisYearParent, setThisYearParent)}
          <Body muted style={{ fontSize: 14 }}>
            {thisYearParent === myId ? VAC_COPY[vacMode].me : VAC_COPY[vacMode].other}
          </Body>
        </>
      )}

      {step < 3 ? (
        <>
          <Button
            title={nextLabel()}
            onPress={next}
            disabled={
              (!customFlow && step === 1 && pattern === 'alternate_weeks' && !timeValid)
              || (customFlow && step === 2 && !monthView && missing)
            }
          />
          {customFlow && step === 2 && monthView ? (
            <Button title="Corriger encore" variant="ghost" onPress={() => setMonthView(false)} />
          ) : null}
        </>
      ) : (
        <Button title={submitLabel ?? 'Générer le calendrier'} onPress={submit} loading={busy} />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  back: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine, paddingVertical: 8 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
  link: { fontFamily: fonts.bodySemiBold, color: colors.pine },
  question: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  input: {
    minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    paddingHorizontal: 14, fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink,
  },
  who: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 16, paddingHorizontal: 8, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  whoOn: { backgroundColor: colors.pineSoft, borderWidth: 2, borderColor: colors.pine },
  whoTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  whoSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  previewCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 12 },
  weekLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSoft },
  day: {
    flex: 1, height: 54, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent', overflow: 'hidden',
  },
  dayStrip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5 },
  dayTouched: { borderColor: colors.ink },
  dayDow: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.inkSoft },
  dayNum: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ink, borderRadius: 14, padding: 14 },
})
