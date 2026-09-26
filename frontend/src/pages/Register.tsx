import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, setToken } from '../api'
import { useAuth } from '../auth'
import { DEFAULT_PARENT_COLOR } from '../colors'
import ColorPicker from '../components/ColorPicker'
import GoogleButton from '../components/GoogleButton'
import PasswordField from '../components/PasswordField'
import { passwordProblem } from '../password'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [color, setColor] = useState(DEFAULT_PARENT_COLOR)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  // Pages légales servies par le backend sur le même domaine (proxy Vercel).
  const legal = (page: 'terms' | 'privacy') => (i18n.language.startsWith('en') ? `/en/${page}` : `/${page}`)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password)
    if (problem) {
      setError(t(problem))
      return
    }
    if (!accepted) {
      setError(t('auth.consentRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      // La langue affichée (venue de la landing) devient celle du compte.
      const locale = i18n.language.startsWith('en') ? 'en' : 'fr'
      const resp = await api.register({ email, password, display_name: displayName, color, locale })
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
        <GoogleButton text="signup_with" consent />
        <label htmlFor="name">{t('auth.firstNameLabel')}</label>
        <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        <label htmlFor="email">{t('auth.emailLabel')}</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
          title={t('auth.emailPatternTitle')}
        />
        <PasswordField
          id="password"
          label={t('auth.passwordLabelMin')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <label id="color-label">{t('auth.colorLabel')}</label>
        <ColorPicker value={color} onChange={setColor} labelledBy="color-label" />
        <label className="consent">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required />
          <span>
            {t('auth.consentLead')}{' '}
            <a href={legal('terms')} target="_blank" rel="noreferrer">{t('auth.consentTerms')}</a>{' '}
            {t('auth.consentAnd')}{' '}
            <a href={legal('privacy')} target="_blank" rel="noreferrer">{t('auth.consentPrivacy')}</a>
            {t('auth.consentTail')}
          </span>
        </label>
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
