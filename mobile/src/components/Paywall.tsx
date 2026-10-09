// Paywall Premium : offres du store (prix locaux), achat, « Restaurer mes achats »
// (obligatoire pour l'App Store), mentions de renouvellement. Pas de lien vers le
// paiement web (règles Apple). Le statut Premium vient toujours du backend.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { PurchasesPackage } from 'react-native-purchases'
import { WEB_URL } from '@/lib/colors'
import { PurchaseCancelled, iapAvailable, loadPackages, purchase, restore } from '@/lib/purchases'
import { useBillingAction } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { BillingStatus } from '@/lib/types'
import { Icon } from './Icon'
import { Body, Button, Card, ErrorBanner, ErrorState, Loading, Title } from './ui'

const FEATURES = [
  'Dépenses partagées : solde, remboursements, contestations',
  'Tableau entre parents : infos, tâches, questions',
  'Rappels par e-mail des échanges à valider',
  'Synchronisation avec votre agenda',
]

/**
 * Offres Premium du store, achat et « Restaurer mes achats ». S'insère dans un écran
 * (onglet verrouillé, fin d'onboarding, Réglages) ; `onSkip` ajoute « Plus tard ».
 */
export function Paywall({ title = 'Alternly Premium', intro, onPurchased, onSkip, skipLabel = 'Plus tard' }: {
  title?: string
  intro?: string
  /** Appelé quand le foyer devient Premium (achat ou restauration). */
  onPurchased?: () => void
  onSkip?: () => void
  skipLabel?: string
}) {
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
        <Body muted>{intro ?? 'Un seul abonnement suffit pour les deux parents.'}</Body>
      </View>

      <Card>
        {FEATURES.map((f) => (
          <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="check" size={18} color={colors.pine} strokeWidth={2.4} />
            <Body style={{ flex: 1, fontSize: 15 }}>{f}</Body>
          </View>
        ))}
      </Card>

      <ErrorBanner message={error} />
      {restored === false ? <Body muted>Aucun abonnement à restaurer pour ce compte.</Body> : null}

      {!available ? (
        <Body muted>Les achats intégrés ne sont pas disponibles sur cet appareil.</Body>
      ) : packages.isPending ? (
        <Loading />
      ) : packages.isError || list.length === 0 ? (
        <ErrorState message="Offres indisponibles pour le moment." onRetry={() => packages.refetch()} />
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            {list.map((p) => (
              <Offer key={p.identifier} pkg={p} selected={p.identifier === chosen?.identifier} onPress={() => setSelected(p.identifier)} />
            ))}
          </View>
          <Button
            title="S’abonner"
            onPress={() => chosen && buy.mutate(chosen, { onSuccess: done })}
            loading={buy.isPending}
            disabled={!chosen || restoreAction.isPending}
          />
        </>
      )}

      {available ? (
        <Button
          title="Restaurer mes achats"
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
      {onSkip ? <Button title={skipLabel} variant="ghost" onPress={onSkip} disabled={buy.isPending} /> : null}

      <Text style={s.legal}>
        Renouvellement automatique à la fin de chaque période, sauf résiliation au moins 24 h avant, dans les réglages de
        votre compte {Platform.OS === 'ios' ? 'Apple' : 'Google Play'}. Le paiement est prélevé par le store.{' '}
        <Text style={s.link} onPress={() => Linking.openURL(`${WEB_URL}/terms`)}>Conditions d’utilisation</Text>
        {' · '}
        <Text style={s.link} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>Confidentialité</Text>
      </Text>
    </View>
  )
}

function Offer({ pkg, selected, onPress }: { pkg: PurchasesPackage; selected: boolean; onPress: () => void }) {
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
        <Text style={s.offerTitle}>{annual ? 'Annuel' : pkg.packageType === 'MONTHLY' ? 'Mensuel' : pkg.product.title}</Text>
        {intro ? (
          <Text style={s.offerHint}>
            {`${intro.price === 0 ? 'Essai gratuit' : `Offre de lancement à ${intro.priceString}`} : ${intro.periodNumberOfUnits} ${unitLabel(intro.periodUnit, intro.periodNumberOfUnits)}`}
          </Text>
        ) : null}
      </View>
      <Text style={s.offerPrice}>{`${pkg.product.priceString}${annual ? ' / an' : pkg.packageType === 'MONTHLY' ? ' / mois' : ''}`}</Text>
    </Pressable>
  )
}

function unitLabel(unit: string, n: number): string {
  const labels: Record<string, [string, string]> = { DAY: ['jour', 'jours'], WEEK: ['semaine', 'semaines'], MONTH: ['mois', 'mois'], YEAR: ['an', 'ans'] }
  const [one, many] = labels[unit] ?? ['période', 'périodes']
  return n > 1 ? many : one
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
