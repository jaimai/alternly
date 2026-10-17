// Jours de fête : ils passent outre le rythme habituel et le partage des vacances.
// Avec deux parents, chaque modification part en demande.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { pendingMessage } from '@/components/ChangeRequests'
import { Chips } from '@/components/form'
import { Body, Card, ErrorBanner, Loading, Screen, Title } from '@/components/ui'
import { api, isPendingChange } from '@/lib/api'
import { useHousehold, useHouseholdAction } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { SpecialDayKind, SpecialDayRule } from '@/lib/types'

export default function SpecialDays() {
  const { t } = useTranslation()
  const household = useHousehold().data
  const [notice, setNotice] = useState<string | null>(null)
  const save = useHouseholdAction(
    (rules: SpecialDayRule[]) => api.setSpecialDayRules(household!.id, rules),
    (r) => setNotice(isPendingChange(r) ? pendingMessage() : null),
  )

  if (!household) return <Loading />

  function update(kind: SpecialDayKind, patch: Partial<SpecialDayRule>) {
    save.mutate(household!.special_day_rules.map((r) => (r.kind === kind ? { ...r, ...patch } : r)))
  }

  // Valeur du choix « qui a les enfants » : auto, toujours X, ou X les années paires (Noël).
  const choiceValue = (r: SpecialDayRule) =>
    r.parent_id && r.parent_mode !== 'auto' ? `${r.parent_mode}:${r.parent_id}` : 'auto'

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{t('settings.specialDays.title')}</Title>
      <Body muted>{t('settings.specialDays.intro')}</Body>
      <ErrorBanner message={save.error?.message} />
      {notice ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{notice}</Body>
        </Card>
      ) : null}

      {household.special_day_rules.map((r) => {
        const christmas = r.kind === 'christmas_eve' || r.kind === 'christmas_day'
        const label = t(`settings.specialDays.kinds.${r.kind}`)
        const options = [
          { value: 'auto', label: t('settings.specialDays.auto') },
          ...household.members.map((m) => ({ value: `fixed:${m.id}`, label: t('settings.specialDays.always', { name: m.display_name }), dot: m.color })),
          ...(christmas
            ? household.members.map((m) => ({ value: `alternate:${m.id}`, label: t('settings.specialDays.evenYears', { name: m.display_name }), dot: m.color }))
            : []),
        ]
        return (
          <Card key={r.kind}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={s.label}>{label}</Text>
              <Switch
                accessibilityLabel={label}
                value={r.enabled}
                disabled={save.isPending}
                onValueChange={(enabled) => update(r.kind, { enabled })}
                trackColor={{ true: colors.pine, false: colors.line }}
              />
            </View>
            {r.enabled ? (
              <Chips
                options={options}
                value={choiceValue(r)}
                onChange={(v) => {
                  if (v === 'auto') return update(r.kind, { parent_mode: 'auto', parent_id: null })
                  const [mode, id] = v.split(':')
                  update(r.kind, { parent_mode: mode as 'fixed' | 'alternate', parent_id: Number(id) })
                }}
              />
            ) : null}
          </Card>
        )
      })}
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
})
