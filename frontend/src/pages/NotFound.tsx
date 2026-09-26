import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="auth-page" style={{ textAlign: 'center' }}>
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
      </div>
      <div className="card">
        <h2>{t('common.notFoundTitle')}</h2>
        <p className="hint">{t('common.notFoundBody')}</p>
        <Link className="button" to="/app">
          {t('common.notFoundBack')}
        </Link>
      </div>
    </div>
  )
}
