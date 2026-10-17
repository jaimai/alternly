// Premier lancement (ou foyer sans règle de garde) : foyer → enfants → rythme →
// notifications → Premium (facultatif). Mêmes appels API que frontend/src/pages/Onboarding.tsx.
// L'invitation de l'autre parent n'est pas une étape (comme sur le web) : elle est
// proposée sur l'accueil.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Progress, Segmented } from '@/components/form'
import { Icon } from '@/components/Icon'
import { Paywall } from '@/components/Paywall'
import { RuleWizard, type RuleValue } from '@/components/RuleWizard'
import { Body, Button, Card, ErrorBanner, Field, Loading, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { iapAvailable } from '@/lib/purchases'
import { enablePush, pushStatus } from '@/lib/push'
import { keys, useHousehold, useMe } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'

const TOTAL_STEPS = 8 // foyer, enfants, les 4 étapes du rythme, notifications, Premium
// Villes traduites au rendu : onboarding.household.zoneCities<zone>.
const ZONES = ['A', 'B', 'C'] as const
// Avantages des notifications (onboarding.notifications.<clé>).
const PUSH_ITEMS = ['itemHandover', 'itemSwap', 'itemActivity'] as const

export default function Onboarding() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { signOut } = useAuth()
  const me = useMe().data
  const household = useHousehold()
  const h = household.data ?? null
  // Foyer déjà créé (onboarding interrompu) : on reprend là où il en était.
  // 3 (notifications) et 4 (Premium) suivent l'enregistrement du rythme.
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(h === null ? 0 : h.children.length === 0 ? 1 : 2)

  const [name, setName] = useState('')
  const [country, setCountry] = useState<'FR' | 'US'>(me?.locale === 'en' ? 'US' : 'FR')
  const [zone, setZone] = useState<'A' | 'B' | 'C'>('A')
  const [childName, setChildName] = useState('')
  const [children, setChildren] = useState<string[]>([])

  const createHousehold = useMutation({
    mutationFn: () =>
      api.createHousehold({ name: name.trim() || t('onboarding.household.defaultName', { name: me?.display_name ?? '' }).trim(), country, school_zone: zone }),
    onSuccess: (created) => {
      qc.setQueryData(keys.household, created)
      setStep(1)
    },
  })

  const saveChildren = useMutation({
    mutationFn: async () => {
      for (const first_name of children) await api.addChild(h!.id, first_name)
      return api.myHousehold()
    },
    onSuccess: (fresh) => {
      qc.setQueryData(keys.household, fresh)
      setStep(2)
    },
  })

  // Fin de l'onboarding : le foyer rechargé a une règle, la garde de (app)/_layout
  // bascule vers l'accueil. Retardé jusqu'après les étapes notifications et Premium.
  const finish = () => qc.invalidateQueries({ queryKey: keys.household })

  // Premium proposé seulement si l'achat est possible ici et le foyer pas déjà abonné.
  async function afterNotifications() {
    const offer = iapAvailable() && !(await api.billingStatus().catch(() => null))?.access
    if (offer) setStep(4)
    else await finish()
  }

  const saveRules = useMutation({
    mutationFn: async (value: RuleValue) => {
      await api.setCustodyRule(h!.id, value.custody)
      await api.setVacationRule(h!.id, value.vacation)
      // Demande système proposée seulement si elle n'a jamais été posée (une seule fois possible).
      return (await pushStatus().catch(() => 'unavailable')) === 'undetermined'
    },
    onSuccess: (askPush) => (askPush ? setStep(3) : afterNotifications()),
  })

  const activatePush = useMutation({
    mutationFn: enablePush,
    onSettled: () => afterNotifications(),
  })

  const addChild = () => {
    const n = childName.trim()
    if (!n) return
    setChildren([...children, n])
    setChildName('')
  }

  if (!me || household.isPending) return <Loading />

  const error = createHousehold.error?.message ?? saveChildren.error?.message ?? saveRules.error?.message

  return (
    <Screen edges={['top', 'bottom']}>
      {step < 2 ? <Progress step={step + 1} total={TOTAL_STEPS} /> : null}
      {step === 3 ? <Progress step={TOTAL_STEPS - 1} total={TOTAL_STEPS} /> : null}
      {step === 4 ? <Progress step={TOTAL_STEPS} total={TOTAL_STEPS} /> : null}
      <ErrorBanner message={error} />

      {step === 0 && (
        <>
          <View style={{ gap: 6 }}>
            <Title>{t('onboarding.household.title')}</Title>
            <Body muted>{t('onboarding.household.intro')}</Body>
          </View>
          <Field
            label={t('onboarding.household.nameLabel')}
            value={name}
            onChangeText={setName}
            placeholder={t('onboarding.household.defaultName', { name: me.display_name })}
          />
          <Segmented
            label={t('onboarding.household.country')}
            value={country}
            onChange={setCountry}
            options={[
              { value: 'FR', label: t('onboarding.household.countryFR') },
              { value: 'US', label: t('onboarding.household.countryUS') },
            ]}
          />
          {country === 'FR' ? (
            <View style={{ gap: 8 }}>
              <Text style={s.label}>{t('onboarding.household.schoolZone')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
                {ZONES.map((z) => {
                  const selected = zone === z
                  const label = t('onboarding.household.zone', { zone: z })
                  const cities = t(`onboarding.household.zoneCities${z}`)
                  return (
                    <Pressable
                      key={z}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t('onboarding.household.zoneA11y', { zone: label, cities })}
                      onPress={() => setZone(z)}
                      style={[s.zone, selected && s.zoneOn]}
                    >
                      <Text style={[s.zoneTitle, selected && { color: colors.pine }]}>{label}</Text>
                      <Text style={s.zoneCities} numberOfLines={2}>{cities}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : (
            <Body muted style={{ fontSize: 14 }}>
              {t('onboarding.household.usHolidays')}
            </Body>
          )}
          <Button title={t('common.continue')} onPress={() => createHousehold.mutate()} loading={createHousehold.isPending} />
        </>
      )}

      {step === 1 && (
        <>
          <View style={{ gap: 6 }}>
            <Title>{t('onboarding.children.title')}</Title>
            <Body muted>{t('onboarding.children.intro')}</Body>
          </View>
          {children.map((c, i) => (
            <View key={`${c}-${i}`} style={s.child}>
              <Text style={s.childName}>{c}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.children.remove', { name: c })}
                onPress={() => setChildren(children.filter((_, j) => j !== i))}
                style={s.remove}
              >
                <Icon name="close" size={18} color={colors.inkSoft} />
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field
                label={children.length === 0 ? t('onboarding.children.firstName') : t('onboarding.children.addAnother')}
                value={childName}
                onChangeText={setChildName}
                onSubmitEditing={addChild}
                returnKeyType="done"
                autoCapitalize="words"
              />
            </View>
            <Button title={t('common.add')} variant="secondary" onPress={addChild} disabled={!childName.trim()} />
          </View>
          <Button
            title={t('common.continue')}
            onPress={() => saveChildren.mutate()}
            loading={saveChildren.isPending}
            disabled={children.length === 0}
          />
        </>
      )}

      {step === 2 && h && (
        <RuleWizard
          members={h.members}
          myId={me.id}
          childNames={h.children.map((c) => c.first_name)}
          busy={saveRules.isPending}
          stepOffset={2}
          stepTotal={TOTAL_STEPS}
          onSubmit={(value) => saveRules.mutate(value)}
        />
      )}

      {step === 3 && (
        <>
          <View style={s.bell}>
            <Icon name="bell" size={30} color={colors.pine} />
          </View>
          <View style={{ gap: 6 }}>
            <Title>{t('onboarding.notifications.title')}</Title>
            <Body muted>{t('onboarding.notifications.intro')}</Body>
          </View>
          <Card>
            {PUSH_ITEMS.map((item) => (
              <View key={item} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon name="check" size={18} color={colors.pine} strokeWidth={2.4} />
                <Body style={{ flex: 1, fontSize: 15 }}>{t(`onboarding.notifications.${item}`)}</Body>
              </View>
            ))}
          </Card>
          <Body muted style={{ fontSize: 13 }}>{t('onboarding.notifications.footer')}</Body>
          <Button title={t('onboarding.notifications.enable')} onPress={() => activatePush.mutate()} loading={activatePush.isPending} />
          <Button title={t('common.later')} variant="ghost" onPress={() => void afterNotifications()} disabled={activatePush.isPending} />
        </>
      )}

      {step === 4 && (
        <Paywall
          title={t('onboarding.paywall.title')}
          intro={t('onboarding.paywall.intro')}
          onPurchased={() => void finish()}
          onSkip={() => void finish()}
          skipLabel={t('onboarding.paywall.skip')}
        />
      )}

      {step < 3 ? (
        <Text accessibilityRole="button" onPress={() => void signOut()} style={s.signOut}>
          {t('onboarding.signOut')}
        </Text>
      ) : null}
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  zone: {
    flex: 1, minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 2,
  },
  zoneOn: { borderWidth: 2, borderColor: colors.pine, backgroundColor: colors.pineSoft },
  zoneTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  zoneCities: { fontFamily: fonts.body, fontSize: 11, color: colors.inkSoft, textAlign: 'center' },
  child: {
    flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: 14, paddingRight: 6,
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
  },
  childName: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bell: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.pineSoft, alignItems: 'center', justifyContent: 'center' },
  signOut: { textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSoft, paddingVertical: 12 },
})
