import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export default function ForgotPasswordPage() {
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
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
      </div>
      {sent ? (
        <div className="card">
          <h2>Vérifiez votre boîte mail</h2>
          <p className="hint">
            Si un compte existe pour <strong>{email}</strong>, un lien de réinitialisation vient d'être envoyé. Il est
            valable une heure. Pensez à regarder dans les indésirables.
          </p>
          <Link to="/login">Retour à la connexion</Link>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <h2>Mot de passe oublié</h2>
          <p className="hint">Indiquez votre e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <div className="error">{error}</div>}
          <p style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Envoi…' : 'Envoyer le lien'}
            </button>
          </p>
          <p style={{ textAlign: 'center', margin: 0 }}>
            <Link to="/login">Retour à la connexion</Link>
          </p>
        </form>
      )}
    </div>
  )
}
