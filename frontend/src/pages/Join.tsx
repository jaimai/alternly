import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useAuth } from '../auth'
import Spinner from '../components/Spinner'

export default function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [preview, setPreview] = useState<{ household_name: string; invited_by_name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    api
      .previewInvitation(token)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : t('auth.invitationInvalid')))
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
      setError(err instanceof Error ? err.message : t('auth.joinError'))
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
        <h1>{t('auth.invitationTitle')}</h1>
      </div>
      <div className="card">
        {error && <div className="error">{error}</div>}
        {preview && (
          <>
            <p>
              <strong>{preview.invited_by_name}</strong> {t('auth.inviteMiddle')}{' '}
              <strong>{preview.household_name}</strong> {t('auth.inviteTail')}
            </p>
            {user ? (
              <button onClick={accept} disabled={busy} style={{ width: '100%' }}>
                {busy ? t('auth.joinBusy') : t('auth.joinSubmit')}
              </button>
            ) : (
              <>
                <p>{t('auth.signInPrompt')}</p>
                <div className="row">
                  <button onClick={() => saveAndGo('/register')}>{t('auth.createAccountLink')}</button>
                  <button className="secondary" onClick={() => saveAndGo('/login')}>
                    {t('auth.loginLink')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {!preview && !error && <p>{t('auth.verifyingInvitation')}</p>}
        <p style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/">{t('auth.backHome')}</Link>
        </p>
      </div>
    </div>
  )
}
