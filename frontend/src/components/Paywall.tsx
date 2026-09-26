import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openCheckout, paddleConfigured } from '../billing'
import type { Plan } from '../billing'
import { API_BASE, setToken } from '../api'
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
}

export default function Paywall({ user, onSubscribed, onSkip, title, subtitle }: Props) {
  const { t } = useTranslation()
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
        <h2>{title ?? t('paywall.title')}</h2>
        <p className="hint">
          {subtitle ?? t('paywall.subtitle')}
        </p>
        <div className="plan-toggle">
          <button className={plan === 'annual' ? 'active' : ''} onClick={() => setPlan('annual')}>
            {t('paywall.planAnnual')} <strong>69&nbsp;€</strong><span>{t('paywall.planAnnualSuffix')}</span>
          </button>
          <button className={plan === 'monthly' ? 'active' : ''} onClick={() => setPlan('monthly')}>
            {t('paywall.planMonthly')} <strong>8,99&nbsp;€</strong><span>{t('paywall.planMonthlySuffix')}</span>
          </button>
        </div>
        <p className="hint" style={{ marginTop: 4 }}>{t('paywall.oneParentPays')}</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', textAlign: 'left' }}>
          {PERK_KEYS.map((k) => (
            <li key={k} style={{ padding: '6px 0 6px 26px', position: 'relative', fontSize: '0.92rem' }}>
              <span style={{ position: 'absolute', left: 2, color: 'var(--pine)', fontWeight: 700 }}>✓</span>
              {t(k)}
            </li>
          ))}
        </ul>
        {done && <div className="info-banner">{t('paywall.activating')}</div>}
        <button onClick={subscribe} disabled={busy} style={{ width: '100%' }}>
          {busy ? t('paywall.opening') : t('paywall.subscribe')}
        </button>
        {!paddleConfigured && (
          <p className="hint" style={{ marginTop: 10 }}>{t('paywall.paymentSoon')}</p>
        )}
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
