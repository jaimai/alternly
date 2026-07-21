import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import NotificationBell from './NotificationBell'

export default function TopBar({ householdName }: { householdName?: string }) {
  const { logout } = useAuth()
  return (
    <div className="topbar">
      <Link to="/" style={{ textDecoration: 'none', fontSize: '1.2rem' }}>
        🗓️
      </Link>
      <span className="title">{householdName ?? 'Coparent'}</span>
      <NotificationBell />
      <Link to="/settings" title="Réglages" style={{ textDecoration: 'none', fontSize: '1.1rem' }}>
        ⚙️
      </Link>
      <button className="secondary" onClick={logout}>
        Déconnexion
      </button>
    </div>
  )
}
