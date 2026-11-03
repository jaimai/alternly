import type { ReactNode } from 'react'
import { useAuth } from '../auth'
import FeatureTeaser from './FeatureTeaser'
import Spinner from './Spinner'

/** Protège une fonctionnalité premium : les comptes gratuits voient d'abord un écran
 *  « découverte » (aperçu et bénéfices), l'offre ne s'ouvre qu'à leur demande. */
export default function PremiumGate({
  featureKey,
  children,
}: {
  /** Libellé traduit de la fonctionnalité (gardé pour les appelants existants). */
  feature: string
  /** Identifiant stable pour l'analytics (le libellé `feature` est traduit). */
  featureKey: string
  children: ReactNode
}) {
  const { user, billing } = useAuth()

  if (!user || billing === null) return <Spinner />
  if (!billing.access) return <FeatureTeaser featureKey={featureKey} />
  return <>{children}</>
}
