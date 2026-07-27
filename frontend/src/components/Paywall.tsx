import { useState } from 'react'
import { openCheckout, paddleConfigured } from '../billing'
import type { Plan } from '../billing'
import { API_BASE, setToken } from '../api'
import type { User } from '../types'

// Les pages légales sont servies par le backend (site marketing).
const MARKETING = API_BASE.replace(/\/api\/?$/, '')

const PERKS = [
  'Dépenses partagées & solde entre parents',
  'Mur de communication (infos, tâches, questions)',
  'Notifications par e-mail',
  'Synchronisation Google / Apple Calendar',
]

interface Props {
  user: User
  onSubscribed: () => void
  /** Si fourni, affiche « Continuer en gratuit » au lieu de « Se déconnecter ». */
  onSkip?: () => void
  title?: string
  subtitle?: string
}

export default function Paywall({ user, onSubscribed, onSkip, title, subtitle }: Props) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [plan, setPlan] = useState<Plan>('annual')

  async function subscribe() {
    setBusy(true)
    await openCheckout(
      user,
      () => {
        setDone(true)
        onSubscribed()
        window.setTimeout(onSubscribed, 4000)
      },
      plan,
    )
    setBusy(false)
  }

  function logout() {
    setToken(null)
    window.location.href = '/login'
  }

  return (
    <div className="auth-page" style={{ maxWidth: 460 }}>
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
      </div>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2>{title ?? 'Passez à Alternly Premium'}</h2>
        <p className="hint">
          {subtitle ?? 'Le calendrier reste gratuit. L’abonnement débloque les outils du quotidien pour tout le foyer.'}
        </p>
        <div className="plan-toggle">
          <button className={plan === 'annual' ? 'active' : ''} onClick={() => setPlan('annual')}>
            Annuel <strong>69&nbsp;€</strong><span>/an · -36 %</span>
          </button>
          <button className={plan === 'monthly' ? 'active' : ''} onClick={() => setPlan('monthly')}>
            Mensuel <strong>8,99&nbsp;€</strong><span>/mois</span>
          </button>
        </div>
        <p className="hint" style={{ marginTop: 4 }}>Un seul parent paie — les deux en profitent.</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', textAlign: 'left' }}>
          {PERKS.map((p) => (
            <li key={p} style={{ padding: '6px 0 6px 26px', position: 'relative', fontSize: '0.92rem' }}>
              <span style={{ position: 'absolute', left: 2, color: 'var(--pine)', fontWeight: 700 }}>✓</span>
              {p}
            </li>
          ))}
        </ul>
        {done && <div className="info-banner">Merci ! Activation de votre abonnement en cours…</div>}
        <button onClick={subscribe} disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Ouverture du paiement…' : "S'abonner"}
        </button>
        {!paddleConfigured && (
          <p className="hint" style={{ marginTop: 10 }}>Le paiement sera bientôt disponible.</p>
        )}
        <p style={{ marginTop: 14 }}>
          {onSkip ? (
            <button className="danger-link" onClick={onSkip}>Continuer en gratuit</button>
          ) : (
            <button className="danger-link" onClick={logout}>Se déconnecter</button>
          )}
        </p>
        <p className="hint" style={{ fontSize: '0.8rem' }}>
          Paiement sécurisé par Paddle. Voir nos{' '}
          <a href={`${MARKETING}/refund`} target="_blank" rel="noreferrer">conditions de remboursement</a>.
        </p>
      </div>
    </div>
  )
}
