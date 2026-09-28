import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { useAuth } from '../auth'
import Icon from './Icon'
import type { IconName } from './Icon'

// Astuces de prise en main, une à la fois, dans la page (jamais en modale) :
// remplace l'ancienne visite guidée de 4 écrans que les parents fermaient sans
// la lire. La progression est gardée localement ; `onboarding_seen` est posé à
// la fin (ou si le parent ferme les astuces).

type TipKey = 'day' | 'tabs' | 'sync'

const TIPS: { key: TipKey; icon: IconName; link?: string }[] = [
  { key: 'day', icon: 'swap' },
  { key: 'tabs', icon: 'wallet' },
  { key: 'sync', icon: 'calendar', link: '/settings' },
]

const STORAGE_KEY = 'alternly_tip_step'

function readStep(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0
  } catch {
    return 0
  }
}

function writeStep(step: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(step))
  } catch {
    // stockage indisponible (navigation privée) : la progression vit en mémoire
  }
}

interface Props {
  /** Le parent vient d'ouvrir un jour : l'astuce « touchez un jour » est acquise. */
  dayOpened: boolean
}

export default function ContextTips({ dayOpened }: Props) {
  const { t } = useTranslation()
  const { user, setUser } = useAuth()
  const [step, setStep] = useState(readStep)

  async function finish(dismissed: boolean) {
    setStep(TIPS.length)
    writeStep(TIPS.length)
    if (dismissed) track(EV.tipsDismissed, { at: TIPS[step]?.key })
    try {
      setUser(await api.updateMe({ onboarding_seen: true }))
    } catch {
      if (user) setUser({ ...user, onboarding_seen: true })
    }
  }

  function next(via: 'button' | 'action') {
    track(EV.tipCompleted, { tip: TIPS[step].key, via })
    const n = step + 1
    if (n >= TIPS.length) return finish(false)
    setStep(n)
    writeStep(n)
  }

  // Apprendre en faisant : ouvrir un jour valide la première astuce.
  useEffect(() => {
    if (dayOpened && TIPS[step]?.key === 'day') next('action')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOpened])

  const tip = TIPS[step]
  if (!user || user.onboarding_seen || !tip) return null

  return (
    <aside className="context-tip" aria-live="polite">
      <span className="context-tip-icon" aria-hidden="true">
        <Icon name={tip.icon} size={18} />
      </span>
      <div className="context-tip-body">
        <p>
          <strong>{t(`tips.${tip.key}Title`)}</strong> {t(`tips.${tip.key}Body`)}
        </p>
        <div className="context-tip-actions">
          <span className="context-tip-count">{t('tips.count', { n: step + 1, total: TIPS.length })}</span>
          {tip.link && (
            <Link to={tip.link} onClick={() => next('action')}>
              {t(`tips.${tip.key}Link`)}
            </Link>
          )}
          <button type="button" className="secondary" onClick={() => next('button')}>
            {t('tips.gotIt')}
          </button>
        </div>
      </div>
      <button type="button" className="context-tip-close" onClick={() => finish(true)} aria-label={t('tips.close')}>
        <Icon name="x" size={16} />
      </button>
    </aside>
  )
}
