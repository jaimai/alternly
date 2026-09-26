import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, setToken } from '../api'
import { useAuth } from '../auth'
import GoogleButton from '../components/GoogleButton'
import PasswordField from '../components/PasswordField'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      const resp = await api.login({ email, password })
      setToken(resp.access_token)
      setUser(resp.user)
      const pending = localStorage.getItem('pending_invite')
      navigate(pending ? `/join/${pending}` : '/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginError'))
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
        <h2>{t('auth.loginTitle')}</h2>
        <GoogleButton text="signin_with" />
        <label htmlFor="email">{t('auth.emailLabel')}</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PasswordField id="password" label={t('auth.passwordLabel')} value={password} onChange={setPassword} />
        <p className="forgot-link">
          <Link to="/forgot-password">{t('auth.forgotLink')}</Link>
        </p>
        {error && <div className="error">{error}</div>}
        <p style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? t('auth.loginBusy') : t('auth.loginSubmit')}
          </button>
        </p>
        <p style={{ textAlign: 'center', margin: 0 }}>
          {t('auth.noAccountPrompt')} <Link to="/register">{t('auth.createAccountLink')}</Link>
        </p>
      </form>
    </div>
  )
}
