import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, setToken } from '../api'
import { useAuth } from '../auth'
import PasswordField, { passwordProblem } from '../components/PasswordField'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const resp = await api.resetPassword(token, password)
      setToken(resp.access_token)
      setUser(resp.user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
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
          <h2>Lien incomplet</h2>
          <p className="hint">Ce lien de réinitialisation est incomplet. Ouvrez le lien reçu par e-mail, ou demandez-en un nouveau.</p>
          <Link to="/forgot-password">Demander un nouveau lien</Link>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <h2>Nouveau mot de passe</h2>
          <PasswordField id="password" label="Nouveau mot de passe" value={password} onChange={setPassword} autoComplete="new-password" />
          <p className="fine-print">Vos autres appareils seront déconnectés.</p>
          {error && (
            <div className="error">
              {error}
              {error.includes('expiré') && (
                <>
                  {' '}
                  — <Link to="/forgot-password">demander un nouveau lien</Link>
                </>
              )}
            </div>
          )}
          <p style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Enregistrement…' : 'Enregistrer et me connecter'}
            </button>
          </p>
        </form>
      )}
    </div>
  )
}
