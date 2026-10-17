// Paywall Premium : offres du store (prix locaux), achat, « Restaurer mes achats »
// (obligatoire pour l'App Store), mentions de renouvellement. Pas de lien vers le
// paiement web (règles Apple). Le statut Premium vient toujours du backend.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { PurchasesPackage } from 'react-native-purchases'
import { WEB_URL } from '@/lib/colors'
import { PurchaseCancelled, iapAvailable, loadPackages, purchase, restore } from '@/lib/purchases'
import { useBillingAction } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { BillingStatus } from '@/lib/types'
import { Icon } from './Icon'
import { Body, Button, Card, ErrorBanner, ErrorState, Loading, Title } from './ui'

// Libellés : premium.features.<clé>
const FEATURES = ['expenses', 'wall', 'reminders', 'calendar'] as const

/**
 * Offres Premium du store, achat et « Restaurer mes achats ». S'insère dans un écran
 * (onglet verrouillé, fin d'onboarding, Réglages) ; `onSkip` ajoute « Plus tard ».
 */
export function Paywall({ title = 'Alternly Premium', intro, onPurchased, onSkip, skipLabel }: {
  title?: string
  intro?: string
  /** Appelé quand le foyer devient Premium (achat ou restauration). */
  onPurchased?: () => void
  onSkip?: () => void
  skipLabel?: string
}) {
  const { t } = useTranslation()
  const available = iapAvailable()
  const packages = useQuery({ queryKey: ['iapPackages'], queryFn: loadPackages, enabled: available, staleTime: 5 * 60_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const buy = useBillingAction((pkg: PurchasesPackage) => purchase(pkg))
  const restoreAction = useBillingAction(() => restore())
  const done = (st: BillingStatus) => st.access && onPurchased?.()
  const [restored, setRestored] = useState<boolean | null>(null)

  const list = packages.data ?? []
  const chosen = list.find((p) => p.identifier === selected) ?? list[0]
  const error = [buy, restoreAction].map((m) => m.error).find((e) => e && !(e instanceof PurchaseCancelled))?.message

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Title>{title}</Title>
        <Body muted>{intro ?? t('premium.intro')}</Body>
      </View>

      <Card>
        {FEATURES.map((f) => (
          <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="check" size={18} color={colors.pine} strokeWidth={2.4} />
            <Body style={{ flex: 1, fontSize: 15 }}>{t(`premium.features.${f}`)}</Body>
          </View>
        ))}
      </Card>

      <ErrorBanner message={error} />
      {restored === false ? <Body muted>{t('premium.noRestore')}</Body> : null}

      {!available ? (
        <Body muted>{t('premium.iapUnavailable')}</Body>
      ) : packages.isPending ? (
        <Loading />
      ) : packages.isError || list.length === 0 ? (
        <ErrorState message={t('premium.offersUnavailable')} onRetry={() => packages.refetch()} />
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            {list.map((p) => (
              <Offer key={p.identifier} pkg={p} selected={p.identifier === chosen?.identifier} onPress={() => setSelected(p.identifier)} />
            ))}
          </View>
          <Button
            title={t('premium.subscribe')}
            onPress={() => chosen && buy.mutate(chosen, { onSuccess: done })}
            loading={buy.isPending}
            disabled={!chosen || restoreAction.isPending}
          />
        </>
      )}

      {available ? (
        <Button
          title={t('premium.restore')}
          variant="ghost"
          loading={restoreAction.isPending}
          disabled={buy.isPending}
          onPress={() =>
            restoreAction.mutate(undefined, {
              onSuccess: (st) => {
                setRestored(st.access)
                done(st)
              },
            })
          }
        />
      ) : null}
      {onSkip ? <Button title={skipLabel ?? t('common.later')} variant="ghost" onPress={onSkip} disabled={buy.isPending} /> : null}

      <Text style={s.legal}>
        {t('premium.legal', { store: Platform.OS === 'ios' ? 'Apple' : 'Google Play' })}{' '}
        <Text style={s.link} onPress={() => Linking.openURL(`${WEB_URL}/terms`)}>{t('common.terms')}</Text>
        {' · '}
        <Text style={s.link} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>{t('premium.privacy')}</Text>
      </Text>
    </View>
  )
}

function Offer({ pkg, selected, onPress }: { pkg: PurchasesPackage; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation()
  const annual = pkg.packageType === 'ANNUAL'
  const intro = pkg.product.introPrice
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.offer, selected && s.offerOn]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.offerTitle}>{annual ? t('premium.annual') : pkg.packageType === 'MONTHLY' ? t('premium.monthly') : pkg.product.title}</Text>
        {intro ? (
          <Text style={s.offerHint}>
            {t('premium.introOffer', {
              offer: intro.price === 0 ? t('premium.freeTrial') : t('premium.launchOffer', { price: intro.priceString }),
              duration: t(`premium.units.${unitKey(intro.periodUnit)}`, { count: intro.periodNumberOfUnits }),
            })}
          </Text>
        ) : null}
      </View>
      <Text style={s.offerPrice}>
        {annual
          ? t('premium.perYear', { price: pkg.product.priceString })
          : pkg.packageType === 'MONTHLY'
            ? t('premium.perMonth', { price: pkg.product.priceString })
            : pkg.product.priceString}
      </Text>
    </Pressable>
  )
}

/** Unité de l'offre d'introduction (store : DAY / WEEK / MONTH / YEAR) : clé de premium.units. */
function unitKey(unit: string): string {
  return ['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(unit) ? unit : 'PERIOD'
}

const s = StyleSheet.create({
  offer: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg,
    borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface,
  },
  offerOn: { borderColor: colors.pine, backgroundColor: colors.pineSoft },
  offerTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  offerHint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  offerPrice: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  legal: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkSoft, textAlign: 'center' },
  link: { color: colors.pine, textDecorationLine: 'underline' },
})
