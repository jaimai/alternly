import { useEffect, useState } from 'react'
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

const SPECIAL_LABELS: Record<SpecialDayRule['kind'], string> = {
  mothers_day: 'Fête des mères',
  fathers_day: 'Fête des pères',
  christmas_eve: 'Réveillon de Noël (24 déc.)',
  christmas_day: 'Jour de Noël (25 déc.)',
}

export default function SettingsPage() {
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
    setError(err instanceof Error ? err.message : 'Erreur')
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
    flash('Copié dans le presse-papier ✓')
  }

  async function saveRules(value: RuleFormValue) {
    if (!household) return
    setBusy(true)
    try {
      await api.setCustodyRule(household.id, value.custody)
      await api.setVacationRule(household.id, value.vacation)
      flash('Règles enregistrées ✓')
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
      flash('Zone mise à jour ✓')
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
      flash('Profil mis à jour ✓')
    } catch (err) {
      fail(err)
    }
  }

  async function toggleEmails(next: boolean) {
    try {
      const updated = await api.updateMe({ email_opt_in: next })
      setUser(updated)
      flash(next ? 'E-mails activés ✓' : 'E-mails coupés ✓')
    } catch (err) {
      fail(err)
    }
  }

  if (!household || !user) return <Spinner />

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout" style={{ maxWidth: 700 }}>
        <h1>Réglages</h1>
        {message && <div className="info-banner">{message}</div>}
        {error && <div className="error">{error}</div>}

        <div className="card">
          <h2>Parents</h2>
          {household.members.map((m) => (
            <p key={m.id}>
              <span className="dot" style={{ background: m.color, display: 'inline-block', width: 12, height: 12, borderRadius: '50%', marginRight: 8 }} />
              {m.display_name} {m.id === user.id && '(vous)'}
              {m.is_placeholder && <span className="hint"> · en attente d'inscription</span>}
            </p>
          ))}
          {isSolo(household.members) && (
            <>
              <p style={{ color: 'var(--ink-soft)' }}>
                Invitez l'autre parent : il verra le même calendrier, sans pouvoir modifier votre profil.
              </p>
              {inviteUrl ? (
                <div className="invite-share">
                  <div className="invite-qr">
                    <QRCodeSVG value={inviteUrl} size={148} bgColor="#ffffff" fgColor="#1f4d3f" marginSize={2} />
                  </div>
                  <div className="invite-share-body">
                    <p className="hint" style={{ marginTop: 0 }}>
                      Faites scanner ce QR code avec le téléphone de l'autre parent, ou envoyez-lui le lien.
                    </p>
                    <div className="row">
                      <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
                      <button onClick={() => copy(inviteUrl)}>Copier le lien</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button onClick={createInvite}>Créer un lien d'invitation</button>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2>Enfants</h2>
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
              placeholder="Prénom"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChild())}
            />
            <button className="secondary" onClick={addChild}>
              Ajouter
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Zone scolaire</h2>
          <select value={household.school_zone} onChange={(e) => updateZone(e.target.value)}>
            <option value="A">Zone A</option>
            <option value="B">Zone B</option>
            <option value="C">Zone C</option>
          </select>
        </div>

        <div className="card">
          <h2>Jours de fête</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            Ces jours passent outre le rythme habituel et le partage des vacances.
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
                {SPECIAL_LABELS[r.kind]}
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
                  <option value="auto">Automatique</option>
                  {household.members.map((m) => (
                    <option key={`fixed-${m.id}`} value={`fixed:${m.id}`}>
                      Toujours chez {m.display_name}
                    </option>
                  ))}
                  {(r.kind === 'christmas_eve' || r.kind === 'christmas_day') &&
                    household.members.map((m) => (
                      <option key={`alt-${m.id}`} value={`alt:${m.id}`}>
                        Alterner — années paires chez {m.display_name}
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
            submitLabel="Enregistrer les règles"
            busy={busy}
            onSubmit={saveRules}
          />
        </div>

        <div className="card">
          <h2>Synchronisation Google / Apple Calendar <span className="premium-tag">Premium</span></h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            Abonnez-vous à ce lien privé depuis votre application de calendrier. Régénérer le lien invalide
            l'ancien.
          </p>
          {!premium ? (
            <button
              className="secondary"
              onClick={() => user && openCheckout(user, refreshBilling)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="lock" size={15} /> Débloquer avec Premium
            </button>
          ) : icalUrl ? (
            <div className="row">
              <input readOnly value={icalUrl} onFocus={(e) => e.target.select()} />
              <button onClick={() => copy(icalUrl)}>Copier</button>
            </div>
          ) : (
            <button onClick={getIcalUrl}>Générer mon lien iCal</button>
          )}
        </div>

        <div className="card">
          <h2>Mon profil</h2>
          <label htmlFor="mycolor">Ma couleur sur le calendrier</label>
          <div className="row">
            <input id="mycolor" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4 }} />
            <button onClick={saveColor}>Enregistrer</button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: premium ? 'var(--ink)' : 'var(--ink-soft)', marginTop: 16 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={premium && user.email_opt_in}
              disabled={!premium}
              onChange={(e) => toggleEmails(e.target.checked)}
            />
            Recevoir un e-mail pour les propositions d'échange et leurs rappels
            {!premium && <span className="premium-tag">Premium</span>}
          </label>
        </div>
      </div>
    </>
  )
}
