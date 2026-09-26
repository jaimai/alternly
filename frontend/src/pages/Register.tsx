import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken, SITE_URL } from '../api'
import { useAuth } from '../auth'
import ColorPicker, { DEFAULT_PARENT_COLOR } from '../components/ColorPicker'
import PasswordField, { passwordProblem } from '../components/PasswordField'

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

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    if (!accepted) {
      setError("Merci d'accepter les conditions d'utilisation pour créer votre compte")
      return
    }
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
        <div className="wordmark">altern<span>ly</span></div>
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
        <PasswordField
          id="password"
          label="Mot de passe (8 caractères minimum)"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <label>Votre couleur sur le calendrier</label>
        <ColorPicker value={color} onChange={setColor} />
        <label className="consent">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>
            J'accepte les{' '}
            <a href={`${SITE_URL}/cgu`} target="_blank" rel="noreferrer">
              conditions générales
            </a>{' '}
            et la{' '}
            <a href={`${SITE_URL}/confidentialite`} target="_blank" rel="noreferrer">
              politique de confidentialité
            </a>
            .
          </span>
        </label>
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
