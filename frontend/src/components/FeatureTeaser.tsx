import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { loadPlans } from '../billing'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { useAuth } from '../auth'
import Icon from './Icon'
import type { IconName } from './Icon'
import TopBar from './TopBar'
import UpgradeDialog from './UpgradeDialog'

type Teaser = { points: number; preview: () => ReactNode }

/** Écran « découverte » d'une fonctionnalité premium, montré aux comptes gratuits
 *  avant le paywall : ce que fait la fonctionnalité (aperçu sur un exemple, bénéfices),
 *  puis l'offre seulement si le parent le demande. Reste dans l'app (barre, onglets). */
export default function FeatureTeaser({ featureKey }: { featureKey: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, household, refreshBilling } = useAuth()
  const [open, setOpen] = useState(false)
  const [trialDays, setTrialDays] = useState(0)
  const solo = Boolean(household?.members.some((m) => m.is_placeholder))
  const teaser = TEASERS[featureKey] ?? TEASERS.expenses
  const key = TEASERS[featureKey] ? featureKey : 'expenses'

  useEffect(() => {
    track(EV.featureTeaserViewed, { feature: key, solo })
    loadPlans().then((p) => setTrialDays(p.annual.trial_days ?? 0)).catch(() => {})
  }, [key, solo])

  function openOffer() {
    track(EV.featureTeaserCta, { feature: key, solo })
    setOpen(true)
  }

  return (
    <>
      <TopBar householdName={household?.name} />
      <div className="layout narrow teaser">
        <p className="teaser-eyebrow">
          <Icon name="star" size={13} /> {t('teaser.premium')}
        </p>
        <h1>{t(`teaser.${key}.title`)}</h1>
        <p className="teaser-lede">{t(`teaser.${key}.lede`)}</p>

        <div className="teaser-preview" aria-hidden="true">
          <span className="teaser-badge">{t('teaser.example')}</span>
          {teaser.preview()}
        </div>

        <ul className="teaser-points">
          {Array.from({ length: teaser.points }, (_, i) => (
            <li key={i}>
              <Icon name="check" size={16} />
              <span>{t(`teaser.${key}.p${i + 1}`)}</span>
            </li>
          ))}
        </ul>

        <div className="teaser-cta">
          <button onClick={openOffer}>
            {trialDays > 0 ? t('teaser.tryFree', { count: trialDays }) : t('teaser.seeOffer')}
          </button>
          <p className="hint">{t('teaser.oneParentPays')}</p>
          <button className="link" type="button" onClick={() => navigate('/app')}>
            {t('teaser.back')}
          </button>
        </div>
      </div>
      {open && user && (
        <UpgradeDialog
          user={user}
          source={`teaser_${key}`}
          onClose={() => setOpen(false)}
          onSubscribed={() => {
            refreshBilling()
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

// Aperçus statiques sur un exemple (prénoms et montants fictifs), dans le style de l'app.
function Row({ icon, title, sub, right }: { icon: IconName; title: string; sub: string; right?: string }) {
  return (
    <div className="teaser-row">
      <span className="teaser-row-icon"><Icon name={icon} size={15} /></span>
      <span className="teaser-row-main">
        <strong>{title}</strong>
        <span>{sub}</span>
      </span>
      {right && <span className="teaser-row-right">{right}</span>}
    </div>
  )
}

function ExpensesPreview() {
  const { t } = useTranslation()
  return (
    <>
      <div className="teaser-balance">
        <span>{t('teaser.expenses.demoBalance')}</span>
        <strong>103,20 €</strong>
      </div>
      <Row icon="utensils" title={t('teaser.expenses.demo1')} sub={t('teaser.expenses.demo1Sub')} right="86,40 €" />
      <Row icon="health" title={t('teaser.expenses.demo2')} sub={t('teaser.expenses.demo2Sub')} right="120,00 €" />
    </>
  )
}

function WallPreview() {
  const { t } = useTranslation()
  return (
    <>
      <Row icon="task" title={t('teaser.wall.demo1')} sub={t('teaser.wall.demo1Sub')} />
      <Row icon="question" title={t('teaser.wall.demo2')} sub={t('teaser.wall.demo2Sub')} />
      <Row icon="message" title={t('teaser.wall.demo3')} sub={t('teaser.wall.demo3Sub')} />
    </>
  )
}

function JournalPreview() {
  const { t } = useTranslation()
  return (
    <>
      <Row icon="clock" title={t('teaser.journal.demo1')} sub={t('teaser.journal.demo1Sub')} />
      <Row icon="health" title={t('teaser.journal.demo2')} sub={t('teaser.journal.demo2Sub')} />
    </>
  )
}

function PensionPreview() {
  const { t } = useTranslation()
  const months: [string, string, string][] = [
    [t('teaser.pension.m1'), 'missing', '0 / 211,59 €'],
    [t('teaser.pension.m2'), 'paid', '211,59 / 211,59 €'],
    [t('teaser.pension.m3'), 'partial', '100,00 / 200,00 €'],
  ]
  return (
    <>
      <div className="teaser-balance">
        <span>{t('teaser.pension.demoArrears')}</span>
        <strong>311,59 €</strong>
      </div>
      {months.map(([label, status, amount]) => (
        <div key={label} className="teaser-row">
          <span className="teaser-row-main"><strong>{label}</strong></span>
          <span className={`tag teaser-status ${status}`}>{t(`teaser.pension.${status}`)}</span>
          <span className="teaser-row-right">{amount}</span>
        </div>
      ))}
    </>
  )
}

const TEASERS: Record<string, Teaser> = {
  expenses: { points: 4, preview: () => <ExpensesPreview /> },
  wall: { points: 3, preview: () => <WallPreview /> },
  journal: { points: 4, preview: () => <JournalPreview /> },
  pension: { points: 3, preview: () => <PensionPreview /> },
}
