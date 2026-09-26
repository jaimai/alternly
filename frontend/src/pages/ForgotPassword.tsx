import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.forgotPassword(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.genericError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
        <p>{t('auth.tagline')}</p>
      </div>
      {sent ? (
        <div className="card">
          <h2>{t('auth.forgotSentTitle')}</h2>
          <p className="hint">{t('auth.forgotSentBody', { email })}</p>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <h2>{t('auth.forgotTitle')}</h2>
          <p className="hint">{t('auth.forgotHint')}</p>
          <label htmlFor="email">{t('auth.emailLabel')}</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <div className="error">{error}</div>}
          <p style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? t('auth.forgotBusy') : t('auth.forgotSubmit')}
            </button>
          </p>
          <p style={{ textAlign: 'center', margin: 0 }}>
            <Link to="/login">{t('auth.backToLogin')}</Link>
          </p>
        </form>
      )}
    </div>
  )
}
