import { useTranslation } from 'react-i18next'

/** Écran de chargement de l'app : le logo et une grille de calendrier esquissée,
 *  le temps que les données arrivent (au lieu d'éléments qui apparaissent un à un). */
export default function AppSplash({ overlay = false, leaving = false }: { overlay?: boolean; leaving?: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      className={`app-splash${overlay ? ' is-overlay' : ''}${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="app-splash-inner">
        <div className="wordmark">altern<span>ly</span></div>
        <div className="app-splash-grid" aria-hidden="true">
          {Array.from({ length: 21 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${(i % 7) * 70 + Math.floor(i / 7) * 120}ms` }} />
          ))}
        </div>
        <p>{t('common.loadingCalendar')}</p>
      </div>
    </div>
  )
}
