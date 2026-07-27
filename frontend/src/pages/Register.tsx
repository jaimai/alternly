import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, setToken } from '../api'
import { useAuth } from '../auth'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [color, setColor] = useState('#3b6ea5')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const resp = await api.register({ email, password, display_name: displayName, color })
      setToken(resp.access_token)
      setUser(resp.user)
      const pending = localStorage.getItem('pending_invite')
      navigate(pending ? `/join/${pending}` : '/onboarding')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.registerError'))
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
      <form className="card" onSubmit={submit}>
        <h2>{t('auth.registerTitle')}</h2>
        <label htmlFor="name">{t('auth.firstNameLabel')}</label>
        <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        <label htmlFor="email">{t('auth.emailLabel')}</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
          title={t('auth.emailPatternTitle')}
        />
        <label htmlFor="password">{t('auth.passwordLabelMin')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={72}
        />
        <label htmlFor="color">{t('auth.colorLabel')}</label>
        <input id="color" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4 }} />
        {error && <div className="error">{error}</div>}
        <p style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? t('auth.registerBusy') : t('auth.registerSubmit')}
          </button>
        </p>
        <p style={{ textAlign: 'center', margin: 0 }}>
          {t('auth.haveAccountPrompt')} <Link to="/login">{t('auth.loginLink')}</Link>
        </p>
      </form>
    </div>
  )
}
