import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, SITE_URL } from '../api'
import { invalidateBilling, useBilling } from '../billing'
import TopBar from '../components/TopBar'
import { fmtDate } from '../dates'

const INCLUDED = [
  'Calendrier de garde illimité, des années à l’avance',
  'Vacances scolaires A/B/C et années paires / impaires',
  'Échanges de jours proposés / acceptés',
  'Dépenses partagées et solde entre parents',
  'Mur de communication',
  'Notifications e-mail et synchronisation Google / Apple',
]

export default function BillingPage() {
  const billing = useBilling()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const success = params.get('success') === '1'

  // Retour de Stripe : le webhook peut arriver quelques secondes après.
  useEffect(() => {
    if (success) invalidateBilling()
  }, [success])

  async function go(fn: () => Promise<{ url: string }>) {
    setBusy(true)
    setError(null)
    try {
      const { url } = await fn()
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  if (!billing) return <div className="page-loading">Chargement…</div>

  const active = billing.status === 'active' || billing.status === 'past_due'

  return (
    <>
      <TopBar />
      <div className="layout narrow">
        <h1>Abonnement</h1>
        {success && <div className="info-banner">Merci ! Votre abonnement est en cours d'activation.</div>}
        {error && <div className="error">{error}</div>}

        {!billing.enabled ? (
          <div className="card">
            <h2>Bêta gratuite</h2>
            <p className="hint">Alternly est gratuit pendant la bêta : toutes les fonctionnalités sont ouvertes.</p>
          </div>
        ) : (
          <section className="plan-card">
            <div>
              <p className="eyebrow">Alternly · tout compris</p>
              <p className="plan-price">
                {billing.price_label}
              </p>
              <p className="plan-status">
                {billing.status === 'trialing' && billing.trial_ends_at && (
                  <>Essai gratuit jusqu'au {fmtDate(billing.trial_ends_at)}.</>
                )}
                {billing.status === 'active' && billing.current_period_end && (
                  <>
                    Abonnement actif.{' '}
                    {billing.cancel_at_period_end
                      ? `Il s'arrêtera le ${fmtDate(billing.current_period_end)}.`
                      : `Prochain renouvellement le ${fmtDate(billing.current_period_end)}.`}
                  </>
                )}
                {billing.status === 'past_due' && <>Le dernier paiement a échoué.</>}
                {(billing.status === 'expired' || billing.status === 'canceled') && (
                  <>Aucun abonnement actif : l'app est en lecture seule.</>
                )}
              </p>
            </div>
            <ul className="plan-list">
              {INCLUDED.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="actions">
              {active ? (
                <button onClick={() => go(api.billingPortal)} disabled={busy}>
                  Gérer mon abonnement
                </button>
              ) : (
                <button onClick={() => go(api.billingCheckout)} disabled={busy}>
                  {busy ? 'Redirection…' : "S'abonner"}
                </button>
              )}
            </div>
            <p className="fine-print">
              Paiement sécurisé par Stripe. Résiliable à tout moment depuis cette page. Chaque parent a son propre
              abonnement. <a href={`${SITE_URL}/cgu`} target="_blank" rel="noreferrer">Conditions de vente</a>
            </p>
          </section>
        )}
      </div>
    </>
  )
}
