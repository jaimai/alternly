import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Spinner from '../components/Spinner'

export default function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<{ household_name: string; invited_by_name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    api
      .previewInvitation(token)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Invitation invalide'))
  }, [token])

  async function accept() {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await api.acceptInvitation(token)
      localStorage.removeItem('pending_invite')
      navigate('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de rejoindre le foyer')
    } finally {
      setBusy(false)
    }
  }

  function saveAndGo(path: string) {
    if (token) localStorage.setItem('pending_invite', token)
    navigate(path)
  }

  if (loading) return <Spinner />

  return (
    <div className="auth-page">
      <div className="brand">
        <div className="wordmark small">altern<span>ly</span></div>
        <h1>Invitation</h1>
      </div>
      <div className="card">
        {error && <div className="error">{error}</div>}
        {preview && (
          <>
            <p>
              <strong>{preview.invited_by_name}</strong> vous invite à rejoindre le foyer{' '}
              <strong>{preview.household_name}</strong> pour organiser ensemble la garde de vos enfants.
            </p>
            {user ? (
              <button onClick={accept} disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Un instant…' : 'Rejoindre le foyer'}
              </button>
            ) : (
              <>
                <p>Connectez-vous ou créez un compte pour accepter l'invitation.</p>
                <div className="row">
                  <button onClick={() => saveAndGo('/register')}>Créer un compte</button>
                  <button className="secondary" onClick={() => saveAndGo('/login')}>
                    Se connecter
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {!preview && !error && <p>Vérification de l'invitation…</p>}
        <p style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/">Retour à l'accueil</Link>
        </p>
      </div>
    </div>
  )
}
