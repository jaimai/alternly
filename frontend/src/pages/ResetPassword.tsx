import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, ApiError, setToken } from '../api'
import { useAuth } from '../auth'
import PasswordField from '../components/PasswordField'
import { passwordProblem } from '../password'

export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Lien expiré ou déjà utilisé : on propose d'en redemander un.
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password)
    if (problem) {
      setError(t(problem))
      return
    }
    setBusy(true)
    setError(null)
    setExpired(false)
    try {
      const resp = await api.resetPassword(token, password)
      setToken(resp.access_token)
      setUser(resp.user)
      navigate('/app')
    } catch (err) {
      setExpired(err instanceof ApiError && (err.status === 400 || err.status === 410))
      setError(err instanceof Error ? err.message : t('auth.genericError'))
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
      </div>
      {!token ? (
        <div className="card">
          <h2>{t('auth.resetIncompleteTitle')}</h2>
          <p className="hint">{t('auth.resetIncompleteBody')}</p>
          <Link to="/forgot-password">{t('auth.requestNewLink')}</Link>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <h2>{t('auth.resetTitle')}</h2>
          <PasswordField id="password" label={t('auth.newPasswordLabel')} value={password} onChange={setPassword} autoComplete="new-password" />
          <p className="fine-print">{t('auth.otherDevicesSignedOut')}</p>
          {error && (
            <div className="error">
              {error}
              {expired && (
                <>
                  {' '}
                  — <Link to="/forgot-password">{t('auth.requestNewLinkLower')}</Link>
                </>
              )}
            </div>
          )}
          <p style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? t('auth.resetBusy') : t('auth.resetSubmit')}
            </button>
          </p>
        </form>
      )}
    </div>
  )
}
