import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../api'
import { useAuth, usePremium } from '../auth'
import { openCheckout } from '../billing'
import Icon from '../components/Icon'
import RuleForm from '../components/RuleForm'
import Spinner from '../components/Spinner'
import type { RuleFormValue } from '../components/RuleForm'
import TopBar from '../components/TopBar'
import { isSolo } from '../members'
import type { SpecialDayRule } from '../types'

const SPECIAL_LABEL_KEYS: Record<SpecialDayRule['kind'], string> = {
  mothers_day: 'settings.mothersDay',
  fathers_day: 'settings.fathersDay',
  christmas_eve: 'settings.christmasEve',
  christmas_day: 'settings.christmasDay',
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { user, setUser, household, householdLoaded, refreshHousehold, refreshBilling } = useAuth()
  const premium = usePremium()
  const navigate = useNavigate()
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [icalUrl, setIcalUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [color, setColor] = useState(user?.color ?? '#3b6ea5')
  const [childName, setChildName] = useState('')

  const refresh = refreshHousehold

  useEffect(() => {
    if (householdLoaded && !household) navigate('/onboarding')
  }, [householdLoaded, household, navigate])

  function flash(msg: string) {
    setMessage(msg)
    setError(null)
    window.setTimeout(() => setMessage(null), 4000)
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : t('settings.errorGeneric'))
  }

  async function createInvite() {
    if (!household) return
    try {
      const inv = await api.createInvitation(household.id)
      setInviteUrl(`${window.location.origin}/join/${inv.token}`)
    } catch (err) {
      fail(err)
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    flash(t('settings.copied'))
  }

  async function saveRules(value: RuleFormValue) {
    if (!household) return
    setBusy(true)
    try {
      await api.setCustodyRule(household.id, value.custody)
      await api.setVacationRule(household.id, value.vacation)
      flash(t('settings.rulesSaved'))
      refresh()
    } catch (err) {
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
      await api.setSpecialDayRules(household.id, rules)
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

  async function saveColor() {
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

        <div className="card">
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
              {inviteUrl ? (
                <div className="invite-share">
                  <div className="invite-qr">
                    <QRCodeSVG value={inviteUrl} size={148} bgColor="#ffffff" fgColor="#1f4d3f" marginSize={2} />
                  </div>
                  <div className="invite-share-body">
                    <p className="hint" style={{ marginTop: 0 }}>
                      {t('settings.scanQr')}
                    </p>
                    <div className="row">
                      <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
                      <button onClick={() => copy(inviteUrl)}>{t('settings.copyLink')}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button onClick={createInvite}>{t('settings.createInviteLink')}</button>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2>{t('settings.children')}</h2>
          <div className="chip-list">
            {household.children.map((c) => (
              <span key={c.id} className="chip">
                {c.first_name}{' '}
                <a
                  href="#"
                  onClick={async (e) => {
                    e.preventDefault()
                    await api.deleteChild(household.id, c.id)
                    refresh()
                  }}
                >
                  ✕
                </a>
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

        <div className="card">
          <h2>{t('settings.schoolZone')}</h2>
          <select value={household.school_zone} onChange={(e) => updateZone(e.target.value)}>
            <option value="A">{t('settings.zoneA')}</option>
            <option value="B">{t('settings.zoneB')}</option>
            <option value="C">{t('settings.zoneC')}</option>
          </select>
        </div>

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
            onSubmit={saveRules}
          />
        </div>

        <div className="card">
          <h2>{t('settings.calendarSync')} <span className="premium-tag">{t('settings.premium')}</span></h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            {t('settings.icalHint')}
          </p>
          {!premium ? (
            <button
              className="secondary"
              onClick={() => user && openCheckout(user, refreshBilling)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="lock" size={15} /> {t('settings.unlockWithPremium')}
            </button>
          ) : icalUrl ? (
            <div className="row">
              <input readOnly value={icalUrl} onFocus={(e) => e.target.select()} />
              <button onClick={() => copy(icalUrl)}>{t('settings.copy')}</button>
            </div>
          ) : (
            <button onClick={getIcalUrl}>{t('settings.generateIcal')}</button>
          )}
        </div>

        <div className="card">
          <h2>{t('settings.myProfile')}</h2>
          <label htmlFor="mylocale">{t('settings.languageLabel')}</label>
          <select
            id="mylocale"
            value={user.locale}
            onChange={async (e) => {
              const locale = e.target.value as 'fr' | 'en'
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
          <label htmlFor="mycolor">{t('settings.myCalendarColor')}</label>
          <div className="row">
            <input id="mycolor" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4 }} />
            <button onClick={saveColor}>{t('settings.save')}</button>
          </div>
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
      </div>
    </>
  )
}
