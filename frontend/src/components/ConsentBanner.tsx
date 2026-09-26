import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { isConsentBannerOpen, setConsent, subscribeConsent } from '../analytics'

/**
 * Bannière de consentement (CNIL) : non bloquante, « Refuser » aussi visible et
 * accessible qu'« Accepter ». Sans réponse, seule la mesure anonyme sans cookie
 * est active. Réouverte depuis Réglages → « Gérer les cookies ».
 */
export default function ConsentBanner() {
  const { t, i18n } = useTranslation()
  const open = useSyncExternalStore(subscribeConsent, isConsentBannerOpen, () => false)
  if (!open) return null
  const privacy = i18n.language.startsWith('en') ? '/en/privacy' : '/privacy'
  return (
    <section className="consent-banner" role="dialog" aria-live="polite" aria-labelledby="consent-title">
      <div className="consent-text">
        <strong id="consent-title">{t('cookies.title')}</strong>
        <p>
          {t('cookies.body')}{' '}
          <a href={privacy}>{t('cookies.learnMore')}</a>
        </p>
      </div>
      <div className="consent-actions">
        <button type="button" className="consent-btn" onClick={() => setConsent('denied')}>
          {t('cookies.refuse')}
        </button>
        <button type="button" className="consent-btn" onClick={() => setConsent('granted')}>
          {t('cookies.accept')}
        </button>
      </div>
    </section>
  )
}
