import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'
import { useAuth } from '../auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const resp = await api.login({ email, password })
      setToken(resp.access_token)
      setUser(resp.user)
      const pending = localStorage.getItem('pending_invite')
      navigate(pending ? `/join/${pending}` : '/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="brand">
        <div className="wordmark">co<span>parent</span></div>
        <p>Le calendrier de garde partagée</p>
      </div>
      <form className="card" onSubmit={submit}>
        <h2>Connexion</h2>
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Mot de passe</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="error">{error}</div>}
        <p style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </p>
        <p style={{ textAlign: 'center', margin: 0 }}>
          Pas encore de compte ? <Link to="/register">Créer un compte</Link>
        </p>
      </form>
    </div>
  )
}
