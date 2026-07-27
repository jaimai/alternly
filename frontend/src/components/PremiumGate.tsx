import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import Spinner from './Spinner'
import Paywall from './Paywall'

/** Protège une fonctionnalité premium : montre un paywall (skippable) aux
 *  utilisateurs gratuits, sinon rend le contenu. */
export default function PremiumGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { user, billing, refreshBilling } = useAuth()
  const navigate = useNavigate()

  if (!user || billing === null) return <Spinner />
  if (!billing.access) {
    return (
      <Paywall
        user={user}
        onSubscribed={refreshBilling}
        onSkip={() => navigate('/app')}
        title={`${feature} — fonctionnalité premium`}
        subtitle="Le calendrier est gratuit. Cette fonctionnalité est incluse dans l’abonnement Alternly."
      />
    )
  }
  return <>{children}</>
}
