import { Link, NavLink } from 'react-router-dom'
import NotificationBell from './NotificationBell'

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined)

const ICONS = {
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  expenses: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19M6.5 15h4" />
    </>
  ),
  wall: <path d="M20 15.5a2 2 0 0 1-2 2H8l-4.5 4v-15a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
}

export function Icon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

const TABS = [
  { to: '/', label: 'Calendrier', icon: 'calendar', end: true },
  { to: '/expenses', label: 'Dépenses', icon: 'expenses', end: false },
  { to: '/wall', label: 'Mur', icon: 'wall', end: false },
] as const

export default function TopBar({ householdName }: { householdName?: string }) {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="wordmark small" style={{ textDecoration: 'none' }} title={householdName}>
          altern<span>ly</span>
        </Link>
        <nav className="topnav" aria-label="Navigation principale">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={navClass}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-actions">
          <NotificationBell />
          <NavLink to="/settings" title="Réglages" className={({ isActive }) => `icon-link${isActive ? ' active' : ''}`} aria-label="Réglages">
            <Icon name="settings" />
          </NavLink>
        </div>
      </header>
      {/* Mobile : barre d'onglets en bas, à portée de pouce */}
      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={navClass}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </NavLink>
        ))}
        <NavLink to="/settings" className={navClass}>
          <Icon name="settings" size={22} />
          <span>Réglages</span>
        </NavLink>
      </nav>
    </>
  )
}
