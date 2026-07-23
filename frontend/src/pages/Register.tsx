import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
      setError(err instanceof Error ? err.message : "Erreur d'inscription")
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
        <h2>Créer un compte</h2>
        <label htmlFor="name">Votre prénom</label>
        <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
          title="Saisissez une adresse e-mail complète, avec un nom de domaine (ex. prenom@exemple.fr)."
        />
        <label htmlFor="password">Mot de passe (8 caractères minimum)</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={72}
        />
        <label htmlFor="color">Votre couleur sur le calendrier</label>
        <input id="color" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4 }} />
        {error && <div className="error">{error}</div>}
        <p style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Création…' : 'Créer mon compte'}
          </button>
        </p>
        <p style={{ textAlign: 'center', margin: 0 }}>
          Déjà inscrit·e ? <Link to="/login">Se connecter</Link>
        </p>
      </form>
    </div>
  )
}
