import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from './Icon'
import type { IconName } from './Icon'

interface Slide {
  icon: IconName
  title: string
  body: string
}

export default function WelcomeTour() {
  const { t } = useTranslation()
  const { user, setUser } = useAuth()
  const [i, setI] = useState(0)
  const [closing, setClosing] = useState(false)

  const SLIDES: Slide[] = [
    {
      icon: 'calendar',
      title: t('calendar.tour1Title'),
      body: t('calendar.tour1Body'),
    },
    {
      icon: 'swap',
      title: t('calendar.tour2Title'),
      body: t('calendar.tour2Body'),
    },
    {
      icon: 'wallet',
      title: t('calendar.tour3Title'),
      body: t('calendar.tour3Body'),
    },
    {
      icon: 'message',
      title: t('calendar.tour4Title'),
      body: t('calendar.tour4Body'),
    },
  ]

  async function finish() {
    setClosing(true)
    try {
      const updated = await api.updateMe({ onboarding_seen: true })
      setUser(updated)
    } catch {
      // même si l'appel échoue, on masque le tour pour cette session
      if (user) setUser({ ...user, onboarding_seen: true })
    }
  }

  if (closing) return null
  const slide = SLIDES[i]
  const last = i === SLIDES.length - 1

  return (
    <div className="modal-backdrop">
      <div className="modal tour">
        <div className="tour-icon"><Icon name={slide.icon} size={30} /></div>
        <h2>{slide.title}</h2>
        <p>{slide.body}</p>
        <div className="tour-dots">
          {SLIDES.map((_, j) => (
            <span key={j} className={j === i ? 'active' : ''} />
          ))}
        </div>
        <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
          <button className="danger-link" onClick={finish} style={{ marginRight: 'auto' }}>
            {t('calendar.tourSkip')}
          </button>
          {i > 0 && (
            <button className="secondary" onClick={() => setI(i - 1)}>
              {t('calendar.tourPrevious')}
            </button>
          )}
          {last ? (
            <button onClick={finish}>{t('calendar.tourStart')}</button>
          ) : (
            <button onClick={() => setI(i + 1)}>{t('calendar.tourNext')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
