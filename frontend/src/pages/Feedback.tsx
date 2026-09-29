import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import FeedbackForm from '../components/FeedbackForm'

/** Page publique /feedback (lien du pied de page du site) : sans compte possible. */
export default function FeedbackPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  return (
    <div className="auth-page">
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
        <p>{t('feedback.pageIntro')}</p>
      </div>
      <div className="card">
        <h2>{t('feedback.title')}</h2>
        <FeedbackForm source="footer" />
      </div>
      <p style={{ textAlign: 'center' }}>
        {user ? <Link to="/app">{t('feedback.backToApp')}</Link> : <a href="/">{t('auth.backHome')}</a>}
      </p>
    </div>
  )
}
