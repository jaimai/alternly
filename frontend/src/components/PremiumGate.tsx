import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import Spinner from './Spinner'
import Paywall from './Paywall'

/** Protège une fonctionnalité premium : montre un paywall (skippable) aux
 *  utilisateurs gratuits, sinon rend le contenu. */
export default function PremiumGate({
  feature,
  featureKey,
  children,
}: {
  feature: string
  /** Identifiant stable pour l'analytics (le libellé `feature` est traduit). */
  featureKey: string
  children: ReactNode
}) {
  const { user, billing, refreshBilling } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()

  if (!user || billing === null) return <Spinner />
  if (!billing.access) {
    return (
      <Paywall
        user={user}
        onSubscribed={refreshBilling}
        onSkip={() => navigate('/app')}
        feature={featureKey}
        title={t('paywall.gateTitle', { feature })}
        subtitle={t('paywall.gateSubtitle')}
      />
    )
  }
  return <>{children}</>
}
