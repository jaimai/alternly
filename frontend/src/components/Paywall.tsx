import { useState } from 'react'
import { openCheckout, paddleConfigured } from '../billing'
import { API_BASE, setToken } from '../api'
import type { User } from '../types'

// Les pages légales sont servies par le backend (site marketing).
const MARKETING = API_BASE.replace(/\/api\/?$/, '')

const PERKS = [
  'Calendrier de garde illimité, des années à l’avance',
  'Vacances scolaires A/B/C & alternance années paires/impaires',
  'Échanges de jours proposés / acceptés',
  'Dépenses partagées & solde entre parents',
  'Mur de communication (infos, tâches, questions)',
  'Notifications e-mail & synchronisation Google / Apple',
]

export default function Paywall({ user, onSubscribed }: { user: User; onSubscribed: () => void }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function subscribe() {
    setBusy(true)
    await openCheckout(user, () => {
      // Paiement terminé : l'activation arrive via webhook (léger délai).
      setDone(true)
      onSubscribed()
      window.setTimeout(onSubscribed, 4000)
    })
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
        <h2>Votre essai est terminé</h2>
        <p className="hint">Abonnez-vous pour continuer à organiser la garde en toute sérénité.</p>
        <div style={{ margin: '16px 0' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.6rem', color: 'var(--pine)' }}>39&nbsp;€</span>
          <span className="hint"> / an et par parent</span>
        </div>
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
          <button className="danger-link" onClick={logout}>Se déconnecter</button>
        </p>
        <p className="hint" style={{ fontSize: '0.8rem' }}>
          Paiement sécurisé par Paddle. Voir nos{' '}
          <a href={`${MARKETING}/refund`} target="_blank" rel="noreferrer">conditions de remboursement</a>.
        </p>
      </div>
    </div>
  )
}
