import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="auth-page" style={{ textAlign: 'center' }}>
      <div className="brand">
        <div className="wordmark">altern<span>ly</span></div>
      </div>
      <div className="card">
        <h2>Page introuvable</h2>
        <p className="hint">Ce lien ne mène nulle part. Il a peut-être expiré, ou l'adresse contient une faute de frappe.</p>
        <Link className="button" to="/">
          Retour au calendrier
        </Link>
      </div>
    </div>
  )
}
