// Règle de garde en 4 petites étapes (portage de frontend/src/components/RuleWizard.tsx) :
// rythme → qui a les enfants à une date précise → vérifier/ajuster jour par jour → vacances.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { flipDay, mondayOf, sideOn, weekday, type Pattern, type Side } from '@/lib/custodyPreview'
import { addDays, formatLong, parseIso, todayIso } from '@/lib/dates'
import { intlLocale } from '@/lib/i18n'
import { colors, fonts, tint } from '@/lib/theme'
import type { CustodyRule, Member, VacationRule } from '@/lib/types'
import { ChoiceCard, DateField, Progress, Segmented } from './form'
import { Avatar, Body, Button, Title } from './ui'

// Libellés traduits au rendu : onboarding.wizard.patterns.<key>Title / <key>Desc.
const PATTERNS: { value: Pattern; key: string; thumb: string }[] = [
  { value: 'alternate_weeks', key: 'alternateWeeks', thumb: 'aaaaaaabbbbbbb' },
  { value: 'every_other_weekend', key: 'everyOtherWeekend', thumb: 'bbbbaaabbbbbbb' },
  { value: 'two_two_three', key: 'twoTwoThree', thumb: 'aabbaaabbaabbb' },
  { value: 'custom', key: 'custom', thumb: 'xxxxxxxxxxxxxx' },
]
/** Nom du jour dans la langue de l'app : « L » / « lundi » (narrow / long). */
const dayName = (iso: string, style: 'narrow' | 'long') => parseIso(iso).toLocaleDateString(intlLocale(), { weekday: style })
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
  const { t } = useTranslation()
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
  const [vacMode, setVacMode] = useState<'split_half' | 'alternate_full'>(v?.mode ?? 'split_half')
  const [evenParent, setEvenParent] = useState(v?.even_year_first_half_parent_id ?? myId)
  const [adjust, setAdjust] = useState<{ day: string; before: { pattern: Pattern; customWeeks: Side[] } } | null>(null)

  const kids = childNames.length === 1
    ? childNames[0]
    : childNames.length > 1 ? t('onboarding.wizard.kidsMany') : t('onboarding.wizard.kidsUnknown')
  const rule = { pattern, start_date: startDate, handover_day: handoverDay, custom_weeks: customWeeks }
  const memberOf = (side: Side) => members.find((m) => (side === 'ref' ? m.id === referenceParent : m.id !== referenceParent))
  const colorOf = (side: Side) => memberOf(side)?.color ?? (side === 'ref' ? colors.pine : colors.terra)
  const nameOf = (side: Side) => {
    const m = memberOf(side)
    if (!m) return t('common.otherParent')
    return m.id === myId
      ? t('common.youSuffix', { name: m.display_name })
      : m.is_placeholder ? t('common.otherParent') : m.display_name
  }
  const thisMonday = mondayOf(todayIso())
  const weeks = [0, 1].map((w) => Array.from({ length: 7 }, (_, i) => addDays(thisMonday, w * 7 + i)))
  const timeValid = TIME.test(handoverTime)

  function whoQuestion(): string {
    switch (pattern) {
      case 'alternate_weeks': {
        const offset = (((weekday(startDate) - handoverDay) % 7) + 7) % 7
        return t('onboarding.wizard.whoWeek', { kids, date: formatLong(addDays(startDate, -offset)) })
      }
      case 'every_other_weekend':
        return t('onboarding.wizard.whoWeekend', { kids, date: formatLong(addDays(mondayOf(startDate), 5)) })
      default:
        return t('onboarding.wizard.whoDay', { kids, date: formatLong(mondayOf(startDate)) })
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

  const next = () => setStep(step === 0 && pattern === 'custom' ? 2 : step + 1)
  const back = () => setStep(step === 2 && pattern === 'custom' && !adjust ? 0 : step - 1)

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
      vacation: { mode: vacMode, even_year_first_half_parent_id: evenParent },
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
            <Text style={s.whoTitle}>{m.id === myId ? t('onboarding.wizard.me') : t('common.otherParentTitle')}</Text>
            {!compact ? (
              <Text style={s.whoSub}>{m.id === myId ? m.display_name : m.is_placeholder ? t('onboarding.wizard.notInvited') : m.display_name}</Text>
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
          <Text style={s.weekLabel}>{t('onboarding.wizard.weekOf', { date: formatLong(week[0]) })}</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {week.map((day, i) => {
              const side = sideOn(rule, day)
              const label = t('onboarding.wizard.dayLabel', { day: dayName(day, 'long'), date: parseIso(day).getDate(), name: nameOf(side) })
              return (
                <Pressable
                  key={day}
                  disabled={!editable}
                  accessibilityRole={editable ? 'button' : 'text'}
                  accessibilityLabel={editable ? t('onboarding.wizard.dayTapHint', { label }) : label}
                  onPress={() => flip(day)}
                  style={[s.day, { backgroundColor: tint(colorOf(side), 0.32) }, adjust?.day === day && editable && s.dayTouched]}
                >
                  <Text style={s.dayDow}>{dayName(day, 'narrow')}</Text>
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
            ← {t('common.back')}
          </Text>
        ) : null}
        <View style={{ flex: 1 }}>
          <Progress step={stepOffset + step + 1} total={stepTotal} label={t('onboarding.wizard.progress', { step: step + 1 })} />
        </View>
      </View>

      {step === 0 && (
        <>
          <View style={{ gap: 6 }}>
            <Title>{t('onboarding.wizard.patternTitle')}</Title>
            <Body muted>{t('onboarding.wizard.patternIntro')}</Body>
          </View>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {PATTERNS.map((p) => (
              <ChoiceCard
                key={p.value}
                title={t(`onboarding.wizard.patterns.${p.key}Title`)}
                description={t(`onboarding.wizard.patterns.${p.key}Desc`)}
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

      {step === 1 && (
        <>
          <Title style={{ fontSize: 24, lineHeight: 30 }}>{whoQuestion()}</Title>
          {pattern === 'every_other_weekend' ? (
            <Body muted>{t('onboarding.wizard.weekendRest', { kids, count: Math.max(childNames.length, 1) })}</Body>
          ) : null}
          {whoButtons(false, referenceParent, setReferenceParent)}
          {pattern === 'alternate_weeks' ? (
            <>
              <Segmented
                label={t('onboarding.wizard.handoverDay')}
                value={handoverDay}
                onChange={setHandoverDay}
                options={weeks[0].map((d, i) => ({ value: i, label: dayName(d, 'narrow') }))}
              />
              <View style={{ gap: 8 }}>
                <Text style={s.label}>{t('onboarding.wizard.handoverTime')}</Text>
                <TextInput
                  accessibilityLabel={t('onboarding.wizard.handoverTimeA11y')}
                  value={handoverTime}
                  onChangeText={setHandoverTime}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={[s.input, !timeValid && { borderColor: colors.danger }]}
                />
                {!timeValid ? <Text style={s.error}>{t('onboarding.wizard.timeFormat')}</Text> : null}
              </View>
            </>
          ) : null}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={s.label}>{t('onboarding.wizard.preview')}</Text>
              <Text style={s.hint}>{t('onboarding.wizard.live')}</Text>
            </View>
            {preview(false)}
          </View>
          {showDate ? (
            <DateField label={t('onboarding.wizard.startDate')} value={startDate} onChange={setStartDate} />
          ) : (
            <Body muted style={{ fontSize: 14 }}>
              {t('onboarding.wizard.wrongWeek')}{' '}
              <Text accessibilityRole="button" onPress={() => setShowDate(true)} style={s.link}>
                {t('onboarding.wizard.pickDate')}
              </Text>
            </Body>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <View style={{ gap: 6 }}>
            <Title>{t('onboarding.wizard.checkTitle')}</Title>
            <Body muted>{t('onboarding.wizard.checkIntro')}</Body>
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
                  {t('onboarding.wizard.movedDay', { date: formatLong(adjust.day), name: nameOf(sideOn(rule, adjust.day)) })}
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
                  {t('onboarding.wizard.nowCustom')}
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
                {t('common.cancel')}
              </Text>
            </View>
          ) : null}
        </>
      )}

      {step === 3 && (
        <>
          <Title>{t('onboarding.wizard.vacationTitle')}</Title>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {(['split_half', 'alternate_full'] as const).map((mode) => {
              const first = colorOf(thisYearParent === referenceParent ? 'ref' : 'other')
              const second = colorOf(thisYearParent === referenceParent ? 'other' : 'ref')
              return (
                <ChoiceCard
                  key={mode}
                  title={mode === 'split_half' ? t('onboarding.wizard.splitHalfTitle') : t('onboarding.wizard.alternateFullTitle')}
                  description={
                    mode === 'split_half'
                      ? t('onboarding.wizard.splitHalfDesc')
                      : t('onboarding.wizard.alternateFullDesc')
                  }
                  selected={vacMode === mode}
                  onPress={() => setVacMode(mode)}
                  aside={
                    <View style={{ gap: 4, width: 92 }}>
                      {[0, 1].map((i) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={{ fontFamily: fonts.body, fontSize: 10, color: colors.inkSoft, width: 28 }}>{year + i}</Text>
                          <View style={{ flex: 1, height: 10, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' }}>
                            {mode === 'split_half' ? (
                              <>
                                <View style={{ flex: 1, backgroundColor: i === 0 ? first : second }} />
                                <View style={{ flex: 1, backgroundColor: i === 0 ? second : first }} />
                              </>
                            ) : (
                              <View style={{ flex: 1, backgroundColor: i === 0 ? first : second }} />
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  }
                />
              )
            })}
          </View>
          <Text style={s.question}>
            {vacMode === 'split_half'
              ? t('onboarding.wizard.firstHalfQuestion', { year })
              : t('onboarding.wizard.fullQuestion', { year })}
          </Text>
          {whoButtons(true, thisYearParent, setThisYearParent)}
          <Body muted style={{ fontSize: 14 }}>
            {vacMode === 'split_half'
              ? thisYearParent === myId
                ? t('onboarding.wizard.exampleSplitMe')
                : t('onboarding.wizard.exampleSplitOther')
              : thisYearParent === myId
                ? t('onboarding.wizard.exampleFullMe')
                : t('onboarding.wizard.exampleFullOther')}
          </Body>
        </>
      )}

      {step < 3 ? (
        <Button
          title={step === 2 ? t('onboarding.wizard.confirm') : t('common.continue')}
          onPress={next}
          disabled={step === 1 && pattern === 'alternate_weeks' && !timeValid}
        />
      ) : (
        <Button title={submitLabel ?? t('onboarding.wizard.generate')} onPress={submit} loading={busy} />
      )}
    </View>
  )
}

/** Vignette 2 semaines : a = un parent, b = l'autre, x = à définir. */
function Thumb({ code }: { code: string }) {
  const color = (c: string) => (c === 'a' ? colors.pine : c === 'b' ? colors.terra : colors.line)
  return (
    <View style={{ gap: 2, width: 84 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1].map((w) => (
        <View key={w} style={{ flexDirection: 'row', gap: 2 }}>
          {code.slice(w * 7, w * 7 + 7).split('').map((c, i) => (
            <View key={i} style={{ flex: 1, height: 14, borderRadius: 3, backgroundColor: color(c) }} />
          ))}
        </View>
      ))}
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
