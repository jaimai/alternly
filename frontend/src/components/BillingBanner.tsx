import { Link, useLocation } from 'react-router-dom'
import { useBilling } from '../billing'

// Bandeau discret : fin d'essai proche, essai terminé (lecture seule), paiement en échec.
export default function BillingBanner() {
  const billing = useBilling()
  const { pathname } = useLocation()
  if (!billing || !billing.enabled || pathname === '/billing') return null

  let text: string | null = null
  let tone = ''
  if (billing.read_only) {
    text = "Votre essai est terminé : Alternly est en lecture seule. Abonnez-vous pour proposer des échanges, ajouter des dépenses et écrire sur le mur."
    tone = ' strong'
  } else if (billing.status === 'past_due') {
    text = "Le dernier paiement n'est pas passé. Mettez à jour votre moyen de paiement pour garder l'accès."
    tone = ' strong'
  } else if (billing.status === 'trialing' && billing.days_left !== null && billing.days_left <= 5) {
    text =
      billing.days_left <= 0
        ? "Dernier jour d'essai gratuit."
        : `Plus que ${billing.days_left} jour${billing.days_left > 1 ? 's' : ''} d'essai gratuit.`
  }
  if (!text) return null

  return (
    <div className={`billing-banner${tone}`}>
      <span>{text}</span>
      <Link to="/billing" className="button small">
        {billing.status === 'past_due' ? 'Mettre à jour' : "S'abonner"}
      </Link>
    </div>
  )
}
