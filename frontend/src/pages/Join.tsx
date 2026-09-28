import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import GoogleButton from '../components/GoogleButton'
import { useTranslation } from 'react-i18next'
import { api, ApiError } from '../api'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { useAuth } from '../auth'
import Icon from '../components/Icon'
import Spinner from '../components/Spinner'
import { parseIso, todayIso } from '../dates'
import { useFormat } from '../format'
import type { InvitationSchedulePreview } from '../types'

type InvalidState = { code: 'expired' | 'used' | 'unknown'; inviter: string }

const MAX_PERIODS = 4

export default function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { range } = useFormat()
  const [preview, setPreview] = useState<{ household_name: string; invited_by_name: string } | null>(null)
  const [schedule, setSchedule] = useState<InvitationSchedulePreview | null>(null)
  const [invalid, setInvalid] = useState<InvalidState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    api
      .previewInvitation(token)
      .then((p) => {
        setPreview(p)
        track(EV.inviteOpened, { valid: true })
        // Aperçu du planning : secondaire, jamais bloquant.
        api.previewInvitationSchedule(token).then(setSchedule).catch(() => {})
      })
      .catch((err) => {
        track(EV.inviteOpened, { valid: false })
        if (err instanceof ApiError && err.status === 410 && err.data) {
          const code = err.data.code === 'used' ? 'used' : 'expired'
          setInvalid({ code, inviter: String(err.data.inviter_first_name ?? '') })
        } else if (err instanceof ApiError && err.status === 404) {
          setInvalid({ code: 'unknown', inviter: '' })
        } else {
          setError(err instanceof Error ? err.message : t('auth.invitationInvalid'))
        }
      })
  }, [token, t])

  async function accept() {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await api.acceptInvitation(token)
      localStorage.removeItem('pending_invite')
      navigate('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.joinError'))
    } finally {
      setBusy(false)
    }
  }

  // Invitation mémorisée tant qu'on n'est pas connecté : après « Continuer avec
  // Google » (ou inscription), on revient ici pour rejoindre le foyer.
  useEffect(() => {
    if (!user && token && !invalid) localStorage.setItem('pending_invite', token)
    if (invalid) localStorage.removeItem('pending_invite')
  }, [user, token, invalid])

  function saveAndGo(path: string) {
    if (token) localStorage.setItem('pending_invite', token)
    navigate(path)
  }

  if (loading) return <Spinner />

  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR'
  const weekday = (iso: string) => parseIso(iso).toLocaleDateString(locale, { weekday: 'narrow' })
  const today = todayIso()
  const kids = schedule?.children ?? []
  const kidsLabel = kids.length
    ? new Intl.ListFormat(i18n.language.startsWith('en') ? 'en' : 'fr', { type: 'conjunction' }).format(kids)
    : ''

  return (
    <div className="auth-page" style={{ maxWidth: 520 }}>
      <div className="brand">
        <div className="wordmark small">altern<span>ly</span></div>
        <h1>{invalid ? t('join.invalidTitle') : t('auth.invitationTitle')}</h1>
      </div>

      {invalid && (
        <div className="card">
          <p>
            {invalid.code === 'expired'
              ? invalid.inviter
                ? t('join.expired', { name: invalid.inviter })
                : t('join.expiredAnon')
              : invalid.code === 'used'
                ? t('join.used')
                : t('join.unknown')}
          </p>
          {invalid.code !== 'used' && <p className="hint">{t('join.askNewLink')}</p>}
          {invalid.code === 'used' && (
            <p>
              <Link className="button" to="/login">{t('auth.loginLink')}</Link>
            </p>
          )}
          <p style={{ marginTop: 16, textAlign: 'center' }}>
            <Link to="/">{t('auth.backHome')}</Link>
          </p>
        </div>
      )}

      {!invalid && (
        <div className="card">
          {error && <div className="error">{error}</div>}
          {preview && (
            <>
              <p className="ph-mask ph-sensitive">
                <strong>{preview.invited_by_name}</strong> {t('auth.inviteMiddle')}{' '}
                <strong>{preview.household_name}</strong> {t('auth.inviteTail')}
              </p>
              {user ? (
                <button onClick={accept} disabled={busy} style={{ width: '100%' }}>
                  {busy ? t('auth.joinBusy') : t('auth.joinSubmit')}
                </button>
              ) : (
                <>
                  <p>{t('auth.signInPrompt')}</p>
                  <GoogleButton consent />
                  <div className="row">
                    <button onClick={() => saveAndGo('/register')}>{t('auth.createAccountLink')}</button>
                    <button className="secondary" onClick={() => saveAndGo('/login')}>
                      {t('auth.loginLink')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {!preview && !error && <p>{t('auth.verifyingInvitation')}</p>}
        </div>
      )}

      {!invalid && schedule?.has_schedule && schedule.days.length > 0 && (
        <div className="card join-preview ph-mask ph-sensitive">
          <h2>{t('join.previewTitle')}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {kidsLabel
              ? t('join.previewSubtitle', { children: kidsLabel, name: schedule.inviter_first_name })
              : t('join.previewSubtitleNoChildren', { name: schedule.inviter_first_name })}
          </p>
          <div className="join-strip" role="img" aria-label={t('join.stripAria')}>
            {schedule.days.slice(0, 7).map((d) => (
              <span key={`wd-${d.date}`} className="wd">{weekday(d.date)}</span>
            ))}
            {schedule.days.map((d) => (
              <span
                key={d.date}
                className={`join-day ${d.who === 'you' ? 'you' : ''} ${d.date === today ? 'today' : ''}`}
                title={d.who === 'you' ? t('join.legendYou') : schedule.inviter_first_name}
              >
                {parseIso(d.date).getDate()}
              </span>
            ))}
          </div>
          <div className="join-legend">
            <span><span className="sw" style={{ background: 'var(--terra)' }} />{t('join.legendYou')}</span>
            <span><span className="sw" style={{ background: 'var(--pine-soft)' }} />{schedule.inviter_first_name}</span>
          </div>
          {schedule.your_periods.length > 0 && (
            <>
              <p style={{ margin: '14px 0 0', fontWeight: 600 }}>{t('join.yourPeriods')}</p>
              <ul className="join-periods">
                {schedule.your_periods.slice(0, MAX_PERIODS).map((p) => (
                  <li key={p.start}>{range(p.start, p.end)}</li>
                ))}
              </ul>
            </>
          )}
          {schedule.handover_time && (
            <p className="hint">{t('join.handover', { time: schedule.handover_time })}</p>
          )}
        </div>
      )}

      {!invalid && preview && (
        <div className="card">
          <ul className="join-trust">
            {(['free', 'same', 'swaps', 'leave', 'eu'] as const).map((k) => (
              <li key={k}>
                <Icon name={k === 'eu' ? 'shield' : 'check'} size={16} />
                <span>{t(`join.trust.${k}`)}</span>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 16, textAlign: 'center' }}>
            <Link to="/">{t('auth.backHome')}</Link>
          </p>
        </div>
      )}
    </div>
  )
}
