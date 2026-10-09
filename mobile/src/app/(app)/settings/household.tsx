// Enfants (ajouter, retirer), zone scolaire, et prénom de l'autre parent tant qu'il n'a
// pas de compte ; congés scolaires des foyers US. Avec deux parents, retirer un enfant attend l'accord de l'autre.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { pendingMessage } from '@/components/ChangeRequests'
import { BackButton } from '@/components/BackButton'
import { Chips, DateField } from '@/components/form'
import { Icon } from '@/components/Icon'
import { Body, Button, Card, ErrorBanner, Field, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { api, isPendingChange } from '@/lib/api'
import { formatRange, todayIso } from '@/lib/dates'
import { useHousehold, useHouseholdAction } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { SchoolVacation } from '@/lib/types'

// Noms donnés par défaut au second parent sans compte (backend/app/services/parents.py).
const DEFAULT_PARTNER_NAMES = ["L'autre parent", 'Co-parent']

const ZONES = ['A', 'B', 'C'] as const

export default function HouseholdSettings() {
  const { t } = useTranslation()
  const household = useHousehold().data
  const [childName, setChildName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const placeholder = household?.members.find((m) => m.is_placeholder)
  const [partnerName, setPartnerName] = useState<string | null>(null)

  const hid = household?.id ?? 0
  const add = useHouseholdAction(() => api.addChild(hid, childName.trim()), () => setChildName(''))
  const remove = useHouseholdAction((id: number) => api.deleteChild(hid, id), (r) => setNotice(isPendingChange(r) ? pendingMessage() : null))
  const zone = useHouseholdAction((z: 'A' | 'B' | 'C') => api.updateHousehold(hid, { school_zone: z }), () => setNotice(t('settings.household.zoneUpdated')))
  const rename = useHouseholdAction(
    () => api.renamePartner(hid, (partnerName ?? '').trim()),
    () => {
      setPartnerName(null)
      setNotice(t('settings.household.partnerSaved'))
    },
  )
  const error = [add, remove, zone, rename].find((m) => m.error)?.error?.message

  if (!household) return <Loading />

  function confirmRemove(id: number, name: string) {
    Alert.alert(t('settings.household.removeChildTitle', { name }), t('settings.household.removeChildBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.household.removeChildAction'), style: 'destructive', onPress: () => remove.mutate(id) },
    ])
  }

  const zones = ZONES.map((z) => ({ value: z, label: t(`settings.household.zones.${z}.label`) }))
  const currentZone = ZONES.find((z) => z === household.school_zone)

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{t('settings.household.title')}</Title>
      <ErrorBanner message={error} />
      {notice ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{notice}</Body>
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionLabel>{t('settings.household.children')}</SectionLabel>
        <View style={s.group}>
          {household.children.map((c) => (
            <View key={c.id} style={s.row}>
              <Text style={[s.strong, { flex: 1 }]}>{c.first_name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settings.household.removeChildA11y', { name: c.first_name })}
                hitSlop={8}
                onPress={() => confirmRemove(c.id, c.first_name)}
                disabled={remove.isPending}
              >
                <Icon name="close" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
          {household.children.length === 0 ? <Text style={[s.muted, { padding: 14 }]}>{t('settings.household.noChildren')}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label={t('settings.household.addChild')} placeholder={t('settings.household.firstNamePlaceholder')} value={childName} onChangeText={setChildName} maxLength={50} returnKeyType="done" onSubmitEditing={() => childName.trim() && add.mutate()} />
          </View>
          <Button title={t('common.add')} variant="secondary" onPress={() => add.mutate()} loading={add.isPending} disabled={!childName.trim()} />
        </View>
      </View>

      {placeholder ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>{t('common.otherParentTitle')}</SectionLabel>
          <Body muted style={{ fontSize: 14 }}>
            {t('settings.household.partnerIntro')}
          </Body>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t('settings.household.partnerName')}
                placeholder={t('settings.household.partnerPlaceholder')}
                value={partnerName ?? (DEFAULT_PARTNER_NAMES.includes(placeholder.display_name) ? '' : placeholder.display_name)}
                onChangeText={setPartnerName}
                maxLength={50}
              />
            </View>
            <Button
              title={t('common.save')}
              variant="secondary"
              onPress={() => rename.mutate()}
              loading={rename.isPending}
              disabled={!partnerName?.trim()}
            />
          </View>
        </View>
      ) : null}

      {household.country === 'US' ? <SchoolBreaks householdId={household.id} breaks={household.school_vacations} /> : null}

      {household.country === 'FR' ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>{t('settings.household.schoolZone')}</SectionLabel>
          <Chips options={zones} value={household.school_zone} onChange={(z) => z !== household.school_zone && zone.mutate(z)} />
          {currentZone ? <Body muted style={{ fontSize: 13 }}>{t(`settings.household.zones.${currentZone}.hint`)}</Body> : null}
        </View>
      ) : null}
    </Screen>
  )
}

/** Foyers US : pas de calendrier scolaire national, les congés se saisissent à la main. */
function SchoolBreaks({ householdId, breaks }: { householdId: number; breaks: SchoolVacation[] }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [start, setStart] = useState(todayIso())
  const [end, setEnd] = useState(todayIso(7))
  const add = useHouseholdAction(
    () => api.addSchoolVacation(householdId, { label: label.trim(), start, end }),
    () => setLabel(''),
  )
  const remove = useHouseholdAction((id: number) => api.deleteSchoolVacation(householdId, id))

  function confirmRemove(v: SchoolVacation) {
    Alert.alert(t('settings.household.breaks.removeTitle', { label: v.label }), t('settings.household.breaks.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate(v.id) },
    ])
  }

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>{t('settings.household.breaks.title')}</SectionLabel>
      <Body muted style={{ fontSize: 14 }}>{t('settings.household.breaks.intro')}</Body>
      <ErrorBanner message={add.error?.message ?? remove.error?.message} />
      <View style={s.group}>
        {breaks.length === 0 ? <Text style={[s.muted, { padding: 14 }]}>{t('settings.household.breaks.none')}</Text> : null}
        {[...breaks].sort((a, b) => a.start.localeCompare(b.start)).map((v) => (
          <View key={v.id} style={s.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.strong}>{v.label}</Text>
              <Text style={s.muted}>{formatRange(v.start, v.end)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('settings.household.breaks.removeA11y', { label: v.label })} hitSlop={8} onPress={() => confirmRemove(v)}>
              <Icon name="close" size={18} color={colors.danger} />
            </Pressable>
          </View>
        ))}
      </View>
      <Field label={t('settings.household.breaks.name')} placeholder={t('settings.household.breaks.namePlaceholder')} value={label} onChangeText={setLabel} maxLength={80} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <DateField
          label={t('settings.household.breaks.start')}
          value={start}
          onChange={(d) => {
            setStart(d)
            if (d > end) setEnd(d)
          }}
        />
        <DateField label={t('settings.household.breaks.end')} value={end} onChange={setEnd} min={start} />
      </View>
      <Button title={t('settings.household.breaks.add')} variant="secondary" onPress={() => add.mutate()} loading={add.isPending} disabled={!label.trim() || end < start} />
    </View>
  )
}

const s = StyleSheet.create({
  group: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  strong: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
})
