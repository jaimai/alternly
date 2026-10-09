import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { api, isPendingChange } from '../api'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { useAuth, usePremium } from '../auth'
import AccountCard from '../components/AccountCard'
import ChangeRequests from '../components/ChangeRequests'
import ColorPicker from '../components/ColorPicker'
import Icon from '../components/Icon'
import InviteShare from '../components/InviteShare'
import Modal from '../components/Modal'
import RuleForm from '../components/RuleForm'
import Spinner from '../components/Spinner'
import type { RuleFormValue } from '../components/RuleForm'
import { FeedbackDialog } from '../components/FeedbackButton'
import TopBar from '../components/TopBar'
import UpgradeDialog from '../components/UpgradeDialog'
import { useConfirm } from '../components/useConfirm'
import { useFormat } from '../format'
import { isSolo } from '../members'
import type { BillingStatus, Household, SpecialDayRule, SubscriptionInfo } from '../types'

const SPECIAL_LABEL_KEYS: Record<SpecialDayRule['kind'], string> = {
  mothers_day: 'settings.mothersDay',
  fathers_day: 'settings.fathersDay',
  christmas_eve: 'settings.christmasEve',
  christmas_day: 'settings.christmasDay',
  thanksgiving: 'settings.thanksgiving',
  halloween: 'settings.halloween',
  independence_day: 'settings.independenceDay',
  new_years_day: 'settings.newYearsDay',
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { user, setUser, household, householdLoaded, refreshHousehold, refreshBilling, billing } = useAuth()
  const premium = usePremium()
  const navigate = useNavigate()
  const [icalUrl, setIcalUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [childName, setChildName] = useState('')
  const [confirm, confirmNode] = useConfirm()
  // Recharge le panneau des demandes de changement après une modification.
  const [changesKey, setChangesKey] = useState(0)
  // Confirmation affichée sous le formulaire des règles (le bandeau du haut
  // est hors écran sur mobile quand on enregistre).
  const [rulesMessage, setRulesMessage] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const refresh = refreshHousehold

  useEffect(() => {
    if (householdLoaded && !household) navigate('/onboarding', { replace: true })
  }, [householdLoaded, household, navigate])

  // Lien profond /settings#invite (e-mails de relance, notification) : défile jusqu'au partage.
  const location = useLocation()
  useEffect(() => {
    if (location.hash !== '#invite' || !household) return
    const id = window.setTimeout(() => {
      document.getElementById('invite')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => window.clearTimeout(id)
  }, [location.hash, household])

  function flash(msg: string) {
    setMessage(msg)
    setError(null)
    window.setTimeout(() => setMessage(null), 4000)
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : t('settings.errorGeneric'))
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    track(EV.icalLinkCopied)
    flash(t('settings.copied'))
  }

  async function saveRules(value: RuleFormValue) {
    if (!household) return
    setBusy(true)
    try {
      const custody = await api.setCustodyRule(household.id, value.custody)
      const vacation = await api.setVacationRule(household.id, value.vacation)
      // Deux parents réels : le changement attend l'accord de l'autre (202).
      const pending = isPendingChange(custody) || isPendingChange(vacation)
      setRulesMessage(pending ? t('changes.sent') : t('settings.rulesSaved'))
      setError(null)
      track(EV.custodyRuleSaved, { pattern: value.custody.pattern, pending, source: 'settings' })
      setChangesKey((k) => k + 1)
      refresh()
    } catch (err) {
      setRulesMessage(null)
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  async function updateZone(zone: string) {
    if (!household) return
    try {
      await api.updateHousehold(household.id, { school_zone: zone })
      flash(t('settings.zoneUpdated'))
      refresh()
    } catch (err) {
      fail(err)
    }
  }

  async function toggleSpecial(kind: SpecialDayRule['kind'], patch: Partial<SpecialDayRule>) {
    if (!household) return
    const rules = household.special_day_rules.map((r) =>
      r.kind === kind ? { ...r, ...patch } : r,
    )
    try {
      const res = await api.setSpecialDayRules(household.id, rules)
      if (isPendingChange(res)) {
        flash(t('changes.sent'))
        setChangesKey((k) => k + 1)
      }
      refresh()
    } catch (err) {
      fail(err)
    }
  }

  async function addChild() {
    if (!household || !childName.trim()) return
    try {
      await api.addChild(household.id, { first_name: childName.trim() })
      setChildName('')
      refresh()
    } catch (err) {
      fail(err)
    }
  }

  async function removeChild(id: number, name: string) {
    if (!household) return
    const ok = await confirm({
      title: t('settings.removeChildTitle', { name }),
      body: t('settings.removeChildBody'),
      confirmLabel: t('common.remove'),
      danger: true,
    })
    if (!ok) return
    try {
      const res = await api.deleteChild(household.id, id)
      if (isPendingChange(res)) {
        flash(t('changes.sent'))
        setChangesKey((k) => k + 1)
      }
      refresh()
    } catch (err) {
      fail(err)
    }
  }

  async function getIcalUrl() {
    try {
      const { ical_token } = await api.regenerateIcal()
      // URL de marque servie sous le domaine de l'app (alternly.com/ical/…),
      // proxifiée vers le backend par Vercel. Plus lisible et stable qu'un lien
      // vers le domaine Railway, et insensible à un changement d'hébergeur.
      setIcalUrl(`${window.location.origin}/ical/${ical_token}.ics`)
    } catch (err) {
      fail(err)
    }
  }

  async function saveColor(color: string) {
    try {
      const updated = await api.updateMe({ color })
      setUser(updated)
      flash(t('settings.profileUpdated'))
    } catch (err) {
      fail(err)
    }
  }

  async function toggleEmails(next: boolean) {
    try {
      const updated = await api.updateMe({ email_opt_in: next })
      setUser(updated)
      flash(next ? t('settings.emailsOn') : t('settings.emailsOff'))
    } catch (err) {
      fail(err)
    }
  }

  if (!household || !user) return <Spinner />

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout" style={{ maxWidth: 700 }}>
        <h1>{t('settings.title')}</h1>
        {message && <div className="info-banner">{message}</div>}
        {error && <div className="error">{error}</div>}

        {!isSolo(household.members) && (
          <ChangeRequests
            householdId={household.id}
            myId={user.id}
            members={household.members}
            refreshKey={changesKey}
            onResolved={refresh}
          />
        )}

        <div className="card ph-mask ph-sensitive" id="invite">
          <h2>{t('settings.parents')}</h2>
          {household.members.map((m) => (
            <p key={m.id}>
              <span className="dot" style={{ background: m.color, display: 'inline-block', width: 12, height: 12, borderRadius: '50%', marginRight: 8 }} />
              {m.display_name} {m.id === user.id && t('settings.you')}
              {m.is_placeholder && <span className="hint"> · {t('settings.awaitingSignup')}</span>}
            </p>
          ))}
          {isSolo(household.members) && (
            <>
              <p style={{ color: 'var(--ink-soft)' }}>
                {t('settings.inviteOtherParent')}
              </p>
              <InviteShare household={household} source="settings" />
            </>
          )}
        </div>

        <div className="card">
          <h2>{t('settings.children')}</h2>
          <div className="chip-list ph-mask ph-sensitive">
            {household.children.map((c) => (
              <span key={c.id} className="chip">
                {c.first_name}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={t('settings.removeChildAria', { name: c.first_name })}
                  onClick={() => removeChild(c.id, c.first_name)}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="row">
            <input
              placeholder={t('settings.firstNamePlaceholder')}
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChild())}
            />
            <button className="secondary" onClick={addChild}>
              {t('settings.add')}
            </button>
          </div>
        </div>

        {household.country === 'FR' ? (
          <div className="card">
            <h2>{t('settings.schoolZone')}</h2>
            <select value={household.school_zone} onChange={(e) => updateZone(e.target.value)}>
              <option value="A">{t('settings.zoneA')}</option>
              <option value="B">{t('settings.zoneB')}</option>
              <option value="C">{t('settings.zoneC')}</option>
            </select>
          </div>
        ) : (
          <SchoolBreaks household={household} onChanged={refresh} />
        )}

        <div className="card">
          <h2>{t('settings.holidays')}</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            {t('settings.holidaysHint')}
          </p>
          {household.special_day_rules.map((r) => (
            <div key={r.kind} className="row" style={{ alignItems: 'center', margin: '8px 0' }}>
              <label style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={r.enabled}
                  onChange={(e) => toggleSpecial(r.kind, { enabled: e.target.checked })}
                />
                {t(SPECIAL_LABEL_KEYS[r.kind])}
              </label>
              {r.enabled && (
                <select
                  value={
                    r.parent_id && r.parent_mode === 'fixed'
                      ? `fixed:${r.parent_id}`
                      : r.parent_id && r.parent_mode === 'alternate'
                        ? `alt:${r.parent_id}`
                        : 'auto'
                  }
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'auto') toggleSpecial(r.kind, { parent_mode: 'auto', parent_id: null })
                    else if (v.startsWith('fixed:'))
                      toggleSpecial(r.kind, { parent_mode: 'fixed', parent_id: Number(v.slice(6)) })
                    else if (v.startsWith('alt:'))
                      toggleSpecial(r.kind, { parent_mode: 'alternate', parent_id: Number(v.slice(4)) })
                  }}
                >
                  <option value="auto">{t('settings.automatic')}</option>
                  {household.members.map((m) => (
                    <option key={`fixed-${m.id}`} value={`fixed:${m.id}`}>
                      {t('settings.alwaysWith', { name: m.display_name })}
                    </option>
                  ))}
                  {(r.kind === 'christmas_eve' || r.kind === 'christmas_day') &&
                    household.members.map((m) => (
                      <option key={`alt-${m.id}`} value={`alt:${m.id}`}>
                        {t('settings.alternateEvenYears', { name: m.display_name })}
                      </option>
                    ))}
                </select>
              )}
            </div>
          ))}
        </div>

        <div className="card">
          <RuleForm
            members={household.members}
            myId={user.id}
            initialCustody={household.custody_rule}
            initialVacation={household.vacation_rule}
            submitLabel={t('settings.saveRules')}
            busy={busy}
            savedMessage={rulesMessage}
            onSubmit={saveRules}
          />
          <p className="hint" style={{ marginTop: 14 }}>
            {t('settings.restartSetupHint')}{' '}
            <Link to="/onboarding?restart=1">{t('settings.restartSetup')}</Link>
          </p>
        </div>

        <div className="card">
          <h2>{t('settings.calendarSync')} <span className="premium-tag">{t('settings.premium')}</span></h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            {t('settings.icalHint')}
          </p>
          {!premium ? (
            <button
              className="secondary"
              onClick={() => setUpgradeOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="lock" size={15} /> {t('settings.unlockWithPremium')}
            </button>
          ) : icalUrl ? (
            <div className="invite-share">
              <div className="invite-qr ph-no-capture">
                <QRCodeSVG value={icalUrl.replace(/^https?:\/\//, 'webcal://')} size={148} bgColor="#ffffff" fgColor="#1f4d3f" marginSize={2} />
              </div>
              <div className="invite-share-body">
                <p className="hint" style={{ marginTop: 0 }}>{t('settings.icalQrHint')}</p>
                <div className="row">
                  <input readOnly value={icalUrl} onFocus={(e) => e.target.select()} />
                  <button onClick={() => copy(icalUrl)}>{t('settings.copy')}</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={getIcalUrl}>{t('settings.generateIcal')}</button>
          )}
          {!premium && upgradeOpen && (
            <UpgradeDialog user={user} source="settings_ical" onClose={() => setUpgradeOpen(false)} onSubscribed={refreshBilling} />
          )}
        </div>

        {premium && <SubscriptionCard billing={billing} onChanged={refreshBilling} />}

        <div className="card">
          <h2>{t('settings.myProfile')}</h2>
          <label htmlFor="mylocale">{t('settings.languageLabel')}</label>
          <select
            id="mylocale"
            value={user.locale}
            onChange={async (e) => {
              const locale = e.target.value as 'fr' | 'en'
              track(EV.languageChanged, { from: user.locale, to: locale, source: 'settings' })
              i18n.changeLanguage(locale)
              try {
                const updated = await api.updateMe({ locale })
                setUser(updated)
              } catch (err) {
                fail(err)
              }
            }}
            style={{ maxWidth: 220, marginBottom: 16 }}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <label id="mycolor-label">{t('settings.myCalendarColor')}</label>
          <ColorPicker
            value={user.color}
            onChange={saveColor}
            taken={household.members.find((m) => m.id !== user.id)?.color}
            labelledBy="mycolor-label"
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: premium ? 'var(--ink)' : 'var(--ink-soft)', marginTop: 16 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={premium && user.email_opt_in}
              disabled={!premium}
              onChange={(e) => toggleEmails(e.target.checked)}
            />
            {t('settings.emailOptIn')}
            {!premium && <span className="premium-tag">{t('settings.premium')}</span>}
          </label>
        </div>

        <div className="card">
          <div className="settings-list" style={{ margin: 0 }}>
            <Link to="/history" className="settings-row">
              <span>
                <strong>{t('history.link')}</strong>
                <span className="hint">{t('history.linkHint')}</span>
              </span>
              <Icon name="history" size={16} />
            </Link>
          </div>
        </div>

        <AccountCard user={user} onMessage={flash} onError={fail} />

        <HelpCard />

        <DangerZone />
      </div>
      {confirmNode}
    </>
  )
}

const STORE_NAME = { app_store: 'App Store', play_store: 'Google Play' } as const

function SubscriptionCard({ billing, onChanged }: { billing: BillingStatus | null; onChanged: () => void }) {
  const { t } = useTranslation()
  const store = billing?.source === 'app_store' || billing?.source === 'play_store' ? billing.source : null
  const { date } = useFormat()
  const [sub, setSub] = useState<SubscriptionInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirm, confirmNode] = useConfirm()

  const load = () => api.subscription().then(setSub).catch(() => setSub({ manageable: false }))
  useEffect(() => { if (!store) load() }, [store])

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg(done)
      await load()
      onChanged()
    } catch {
      setMsg(t('settings.subActionError'))
    } finally {
      setBusy(false)
    }
  }

  const planLabel = (p?: string | null) =>
    p === 'annual' ? t('settings.planAnnual') : p === 'monthly' ? t('settings.planMonthly') : t('settings.planUnknown')

  return (
    <div className="card">
      <h2>{t('settings.subscriptionTitle')}</h2>
      {store ? (
        // Achat fait dans l'app : il se gère dans le store, jamais un second abonnement ici.
        <>
          <p className="hint">
            {t(billing?.is_payer ? 'settings.subStoreManaged' : 'settings.subStoreManagedOther', { store: STORE_NAME[store] })}
          </p>
          {billing?.is_payer && billing.manage_url && (
            <a className="button secondary" href={billing.manage_url} target="_blank" rel="noreferrer">
              {t('settings.subStoreManage', { store: STORE_NAME[store] })}
            </a>
          )}
        </>
      ) : sub === null ? (
        <p className="hint">…</p>
      ) : !sub.manageable ? (
        <p className="hint">{t('settings.subGrandfathered')}</p>
      ) : (
        <>
          <p style={{ margin: '0 0 6px' }}>
            {t('settings.subCurrentPlan')} : <strong>{planLabel(sub.plan)}</strong>
            {sub.status === 'canceled' && <span className="tag tag-pending" style={{ marginLeft: 8 }}>{t('settings.subCanceled')}</span>}
          </p>
          {sub.next_billed_at && sub.status !== 'canceled' && (
            <p className="hint" style={{ marginTop: 0 }}>{t('settings.subNextBilling', { date: date(sub.next_billed_at.slice(0, 10)) })}</p>
          )}
          {msg && <div className="info-banner">{msg}</div>}
          {sub.status !== 'canceled' && (
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              {sub.plan !== 'annual' && (
                <button className="secondary" disabled={busy} onClick={() => run(() => api.changePlan('annual'), t('settings.subSwitched'))}>
                  {t('settings.subSwitchAnnual')}
                </button>
              )}
              {sub.plan !== 'monthly' && (
                <button className="secondary" disabled={busy} onClick={() => run(() => api.changePlan('monthly'), t('settings.subSwitched'))}>
                  {t('settings.subSwitchMonthly')}
                </button>
              )}
              <button
                className="danger-link"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({ title: t('settings.subCancel'), body: t('settings.subCancelConfirm'), confirmLabel: t('settings.subCancel'), danger: true })
                  if (ok) run(() => api.cancelSubscription(), t('settings.subCanceledDone'))
                }}
              >
                {t('settings.subCancel')}
              </button>
            </div>
          )}
        </>
      )}
      {confirmNode}
    </div>
  )
}

function HelpCard() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <h2>{t('feedback.settingsTitle')}</h2>
      <p className="hint" style={{ marginTop: 0 }}>{t('feedback.settingsBody')}</p>
      <button
        className="secondary"
        onClick={() => {
          track(EV.feedbackOpened, { source: 'settings' })
          setOpen(true)
        }}
      >
        {t('feedback.settingsCta')}
      </button>
      {open && <FeedbackDialog source="settings" onClose={() => setOpen(false)} />}
    </div>
  )
}

const DEPARTURE_REASONS = ['not_my_situation', 'start_over', 'other_parent', 'price', 'just_testing', 'other'] as const
type DepartureReason = (typeof DEPARTURE_REASONS)[number]

function DangerZone() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="card danger-card">
      <h2>{t('settings.dangerTitle')}</h2>
      <p className="hint">{t('settings.deleteHint')}</p>
      <button className="danger" onClick={() => setOpen(true)}>{t('settings.deleteAccount')}</button>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Suppression du compte : on demande (sans l'imposer) pourquoi le parent part,
 *  et on propose de recommencer la configuration quand c'est ce qu'il cherche. */
function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [reason, setReason] = useState<DepartureReason | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api.deleteAccount({ reason, comment: comment.trim() })
      logout()
    } catch {
      setBusy(false)
      setError(t('settings.deleteError'))
    }
  }

  return (
    <Modal title={t('settings.deleteAccount')} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>{t('settings.deleteConfirm')}</p>
      <fieldset className="departure">
        <legend>{t('settings.departureQuestion')}</legend>
        <div className="choice-list">
          {DEPARTURE_REASONS.map((r) => (
            <label key={r} className={`choice ${reason === r ? 'selected' : ''}`}>
              <input type="radio" name="departure" checked={reason === r} onChange={() => setReason(r)} />
              <span>{t(`settings.departure_${r}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {reason === 'start_over' ? (
        <div className="info-banner">
          <p style={{ margin: 0 }}>{t('settings.departureStartOverHint')}</p>
          <button type="button" style={{ marginTop: 10 }} onClick={() => navigate('/onboarding?restart=1')}>
            {t('settings.restartSetup')}
          </button>
        </div>
      ) : (
        <>
          <label htmlFor="departure-comment">{t('settings.departureCommentLabel')}</label>
          <textarea
            id="departure-comment"
            rows={3}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('settings.departureCommentPlaceholder')}
          />
        </>
      )}
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button className="secondary" type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="danger" type="button" onClick={remove} disabled={busy}>
          {busy ? t('settings.deleting') : t('settings.deleteAccount')}
        </button>
      </div>
    </Modal>
  )
}

function SchoolBreaks({ household, onChanged }: { household: Household; onChanged: () => void }) {
  const { t } = useTranslation()
  const { date } = useFormat()
  const [label, setLabel] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!label.trim() || !start || !end) return
    setBusy(true)
    setError(null)
    try {
      await api.addSchoolVacation(household.id, { label: label.trim(), start, end })
      setLabel('')
      setStart('')
      setEnd('')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const [confirm, confirmNode] = useConfirm()

  async function remove(id: number, name: string) {
    const ok = await confirm({ title: t('settings.removeBreakTitle', { name }), confirmLabel: t('common.delete'), danger: true })
    if (!ok) return
    try {
      await api.deleteSchoolVacation(household.id, id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.errorGeneric'))
    }
  }

  return (
    <div className="card">
      <h2>{t('settings.schoolBreaksTitle')}</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>{t('settings.schoolBreaksHint')}</p>
      {household.school_vacations.length === 0 && (
        <p className="hint">{t('settings.schoolBreaksEmpty')}</p>
      )}
      {household.school_vacations.map((v) => (
        <div key={v.id} className="row" style={{ alignItems: 'center', margin: '6px 0' }}>
          <span style={{ marginRight: 'auto' }}>
            <strong>{v.label}</strong> <span className="hint">{date(v.start)} – {date(v.end)}</span>
          </span>
          <button className="danger-link" onClick={() => remove(v.id, v.label)}>{t('settings.delete')}</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <div style={{ flex: 2 }}>
          <label htmlFor="brk-label">{t('settings.breakNameLabel')}</label>
          <input id="brk-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('settings.breakNamePlaceholder')} />
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="brk-start">{t('settings.breakStartLabel')}</label>
          <input id="brk-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label htmlFor="brk-end">{t('settings.breakEndLabel')}</label>
          <input id="brk-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div style={{ marginTop: 12 }}>
        <button onClick={add} disabled={busy || !label.trim() || !start || !end}>{t('settings.addBreak')}</button>
      </div>
      {confirmNode}
    </div>
  )
}
