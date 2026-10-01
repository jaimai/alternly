import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { resetIdentity, track } from '../analytics'
import { EV } from '../analyticsEvents'
import PlanCheckout from './PlanCheckout'
import { api, API_BASE, setToken } from '../api'
import type { User } from '../types'

// Les pages légales sont servies par le backend (site marketing).
const MARKETING = API_BASE.replace(/\/api\/?$/, '')

const PERK_KEYS = [
  'paywall.perkExpenses',
  'paywall.perkMessageBoard',
  'paywall.perkEmailReminders',
  'paywall.perkCalendarSync',
]

interface Props {
  user: User
  onSubscribed: () => void
  /** Si fourni, affiche « Continuer en gratuit » au lieu de « Se déconnecter ». */
  onSkip?: () => void
  title?: string
  subtitle?: string
  /** Fonctionnalité à l'origine du paywall (analytics : expenses, wall, onboarding…). */
  feature?: string
}

export default function Paywall({ user, onSubscribed, onSkip, title, subtitle, feature = 'generic' }: Props) {
  const { t } = useTranslation()

  useEffect(() => {
    track(EV.paywallViewed, { feature })
    // Intérêt réel pour Premium (pas le paywall montré à tous en fin d'onboarding) :
    // déclenche l'offre de bienvenue 48 h plus tard s'il ne souscrit pas.
    if (feature !== 'onboarding') api.markPaywallSeen().catch(() => {})
  }, [feature])

  function logout() {
    setToken(null)
    resetIdentity()
    window.location.href = '/login'
  }

  return (
    <div className="auth-page" style={{ maxWidth: 460 }}>
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
      </div>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2>{title ?? t('paywall.title')}</h2>
        <p className="hint">
          {subtitle ?? t('paywall.subtitle')}
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', textAlign: 'left' }}>
          {PERK_KEYS.map((k) => (
            <li key={k} style={{ padding: '6px 0 6px 26px', position: 'relative', fontSize: '0.92rem' }}>
              <span style={{ position: 'absolute', left: 2, color: 'var(--pine)', fontWeight: 700 }}>✓</span>
              {t(k)}
            </li>
          ))}
        </ul>
        <PlanCheckout user={user} source={`paywall_${feature}`} onSubscribed={onSubscribed} />
        <p style={{ marginTop: 14 }}>
          {onSkip ? (
            <button className="danger-link" onClick={onSkip}>{t('paywall.continueFree')}</button>
          ) : (
            <button className="danger-link" onClick={logout}>{t('paywall.logout')}</button>
          )}
        </p>
        <p className="hint" style={{ fontSize: '0.8rem' }}>
          {t('paywall.securePayment')}{' '}
          <a href={`${MARKETING}/refund`} target="_blank" rel="noreferrer">{t('paywall.refundTerms')}</a>.
        </p>
      </div>
    </div>
  )
}
