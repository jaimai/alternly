import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { api } from '../api'
import { useAuth } from '../auth'
import CalendarView from '../components/CalendarView'
import ChangeRequests from '../components/ChangeRequests'
import ContextTips from '../components/ContextTips'
import ExceptionDialog from '../components/ExceptionDialog'
import Icon from '../components/Icon'
import InviteShare from '../components/InviteShare'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import {
  cachedCalendar,
  cachedExceptions,
  fetchCalendar,
  fetchExceptions,
  invalidateCalendar,
  monthGridRange,
  prefetchNeighbors,
  statusRange,
} from '../calendarCache'
import AppSplash from '../components/AppSplash'
import StatusCard from '../components/StatusCard'
import TopBar from '../components/TopBar'
import { addDays, todayIso } from '../dates'
import { useFormat } from '../format'
import { isSolo } from '../members'
import type { CalendarResponse, ScheduleException } from '../types'

export default function CalendarPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, household, householdLoaded } = useAuth()
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  // Même plage que la vue mois de FullCalendar : le chargement démarre sans attendre
  // que le calendrier soit monté (il confirme ensuite la même plage).
  const [range, setRange] = useState<{ start: string; end: string } | null>(() => monthGridRange())
  // Écran de chargement tant que le mois et la carte du jour ne sont pas là (6 s au plus) :
  // la page apparaît d'un bloc au lieu d'éléments qui arrivent un par un.
  const [statusReady, setStatusReady] = useState(false)
  const [splashTimedOut, setSplashTimedOut] = useState(false)
  const [splashGone, setSplashGone] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // « Ajuster mon planning » : jours touchés (date → parent visé, ajustement à retirer
  // quand le jour revient au rythme), enregistrés d'un coup.
  const [adjusting, setAdjusting] = useState(false)
  const [flips, setFlips] = useState<Record<string, { to: number; clearId: number | null }>>({})
  const [adjustBusy, setAdjustBusy] = useState(false)
  const [adjustNotice, setAdjustNotice] = useState<string | null>(null)
  const { range: fmtRange } = useFormat()
  // Incrémenté après chaque changement : recharge la carte de statut.
  const [refreshKey, setRefreshKey] = useState(0)
  // Arrivée depuis un lien d'invitation déjà utilisé par ce parent (page /join).
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const alreadyMember = notice === 'alreadyMember'
  const premiumActivated = notice === 'premiumActivated'

  useEffect(() => {
    if (householdLoaded && (!household || !household.custody_rule)) navigate('/onboarding', { replace: true })
  }, [householdLoaded, household, navigate])

  // Lien profond /app?propose=AAAA-MM-JJ (e-mail de rappel de vacances) : ouvre la
  // proposition d'échange sur ce jour, puis retire le paramètre de l'URL.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const day = searchParams.get('propose')
    if (!day || !household) return
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) setSelectedDay(day)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams, household])

  const loadCalendar = useCallback(() => {
    if (!household || !range) return
    // Données déjà vues : affichage immédiat, rafraîchies en arrière-plan.
    const cached = cachedCalendar(household.id, range.start, range.end)
    if (cached) setData(cached)
    const cachedEx = cachedExceptions(household.id)
    if (cachedEx) setExceptions(cachedEx)
    setLoading(!cached)
    fetchCalendar(household.id, range.start, range.end)
      .then((d) => {
        setData(d)
        setError(null)
        prefetchNeighbors(household.id, range.start, range.end)
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('calendar.genericError')))
      .finally(() => setLoading(false))
    fetchExceptions(household.id).then(setExceptions).catch(() => {})
  }, [household, range, t])

  useEffect(loadCalendar, [loadCalendar])

  useEffect(() => {
    if (!household?.custody_rule) return
    const { start, end } = statusRange()
    if (cachedCalendar(household.id, start, end)) {
      setStatusReady(true)
      return
    }
    fetchCalendar(household.id, start, end)
      .catch(() => {})
      .finally(() => setStatusReady(true))
  }, [household?.id, household?.custody_rule])

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashTimedOut(true), 6000)
    return () => window.clearTimeout(timer)
  }, [])

  const pageReady = (data !== null && statusReady) || error !== null || splashTimedOut
  useEffect(() => {
    if (!pageReady || splashGone) return
    const timer = window.setTimeout(() => setSplashGone(true), 250) // fondu de sortie
    return () => window.clearTimeout(timer)
  }, [pageReady, splashGone])

  const onChanged = useCallback(() => {
    if (household) invalidateCalendar(household.id)
    loadCalendar()
    setRefreshKey((k) => k + 1)
  }, [household, loadCalendar])

  // Propositions en attente qui expirent demain (date de début = demain).
  const flipTargets = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [d, f] of Object.entries(flips)) out[d] = f.to
    return out
  }, [flips])
  const flipCount = Object.keys(flips).length
  // Récapitulatif : jours consécutifs envoyés au même parent regroupés en une ligne.
  const recap = useMemo(() => {
    const groups: { start: string; end: string; to: number; dates: string[] }[] = []
    for (const date of Object.keys(flips).sort()) {
      const last = groups[groups.length - 1]
      if (last && last.to === flips[date].to && addDays(last.end, 1) === date) {
        last.end = date
        last.dates.push(date)
      } else {
        groups.push({ start: date, end: date, to: flips[date].to, dates: [date] })
      }
    }
    return groups
  }, [flips])

  function removeFlips(dates: string[]) {
    const next = { ...flips }
    for (const d of dates) delete next[d]
    setFlips(next)
  }

  function memberName(id: number) {
    if (id === user?.id) return t('adjust.you')
    return household?.members.find((m) => m.id === id)?.display_name ?? ''
  }

  function toggleDay(date: string) {
    const day = data?.days.find((d) => d.date === date)
    if (!day || !household) return
    setAdjustNotice(null)
    const next = { ...flips }
    if (next[date]) {
      delete next[date]
      setFlips(next)
      return
    }
    const other = household.members.find((m) => m.id !== day.parent_id)?.id
    if (other === undefined) return
    // Jour déjà personnalisé : le toucher le rend à son rythme habituel.
    const adj = day.source === 'adjustment'
      ? exceptions.find((e) => e.kind === 'adjustment' && e.status === 'accepted' && e.date_start === date)
      : undefined
    next[date] = { to: other, clearId: adj?.id ?? null }
    setFlips(next)
  }

  function startAdjust() {
    setAdjusting(true)
    setFlips({})
    setAdjustNotice(null)
    track(EV.adjustModeOpened, {})
  }

  function cancelAdjust() {
    if (flipCount > 0) track(EV.adjustModeCancelled, { days: flipCount })
    setAdjusting(false)
    setFlips({})
  }

  async function saveAdjust() {
    if (!household || flipCount === 0) return
    setAdjustBusy(true)
    setError(null)
    const set: { date: string; parent_id: number }[] = []
    const clear: number[] = []
    for (const [date, f] of Object.entries(flips)) {
      if (f.clearId !== null) clear.push(f.clearId)
      else set.push({ date, parent_id: f.to })
    }
    try {
      const res = await api.saveAdjustments(household.id, { set, clear })
      const other = household.members.find((m) => m.id !== user?.id)?.display_name ?? ''
      setAdjustNotice(
        res.status === 'proposed'
          ? t('adjust.noticeProposed', { count: flipCount, name: other })
          : res.status === 'pending_consent'
            ? t('adjust.noticeConsent', { name: other })
            : t('adjust.noticeApplied', { count: flipCount }),
      )
      setAdjusting(false)
      setFlips({})
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calendar.genericError'))
    } finally {
      setAdjustBusy(false)
    }
  }

  const expiringTomorrow = exceptions.filter((e) => e.status === 'pending' && e.date_start === todayIso(1))
  const solo = household ? isSolo(household.members) : false

  return (
    <>
      {!splashGone && <AppSplash overlay leaving={pageReady} />}
      <TopBar householdName={household?.name} />
      <div className="layout">
        {error && <div className="error">{error}</div>}
        {alreadyMember && <div className="info-banner">{t('calendar.alreadyMember')}</div>}
        {premiumActivated && <div className="info-banner" role="status">{t('calendar.premiumActivated')}</div>}
        {household && user && (
          <StatusCard
            household={household}
            myId={user.id}
            exceptions={exceptions}
            refreshKey={refreshKey}
            onOpenDay={setSelectedDay}
          />
        )}
        {household && user && !solo && (
          <ChangeRequests
            householdId={household.id}
            myId={user.id}
            members={household.members}
            refreshKey={refreshKey}
            onResolved={onChanged}
          />
        )}
        {solo && (
          <div className="callout callout-invite">
            <div>
              <strong>{t('calendar.soloTitle')}</strong>
              <p>{t('calendar.soloBody')}</p>
            </div>
            <button
              onClick={() => {
                track(EV.invitePromptClicked, { source: 'calendar' })
                setInviteOpen(true)
              }}
            >
              {t('calendar.soloCta')}
            </button>
          </div>
        )}
        {expiringTomorrow.length > 0 && (
          <div className="info-banner banner-ic">
            <Icon name="alert" size={16} />
            <span>
              {expiringTomorrow.length === 1
                ? t('calendar.expiringTomorrowOne')
                : t('calendar.expiringTomorrowMany', { count: expiringTomorrow.length })}{' '}
              {t('calendar.expiringTomorrowTail')}
            </span>
          </div>
        )}
        {data && !data.school_holidays_loaded && <div className="info-banner">{t('calendar.schoolHolidaysError')}</div>}
        {data && (
          <div className="legend ph-mask ph-sensitive">
            {data.members.map((m) => (
              <span key={m.id} className="legend-item">
                <span className="dot" style={{ background: m.color }} />
                {m.id === user?.id ? t('calendar.legendYou', { name: m.display_name }) : m.display_name}
              </span>
            ))}
            <span className="legend-item">
              <span className="dot handover-dot" />
              {t('calendar.legendHandover')}
            </span>
            <span className="legend-item">
              <span className="dot pending-dot" />
              {t('calendar.legendProposedExchange')}
            </span>
            {data.days.some((d) => d.source === 'adjustment') && (
              <span className="legend-item">
                <span className="dot adjusted-dot" />
                {t('calendar.legendAdjusted')}
              </span>
            )}
            <span className="legend-icons">
              <span><Icon name="sun" size={13} /> {t('calendar.legendHolidays')}</span>
              <span><Icon name="flag" size={13} /> {t('calendar.legendPublicHoliday')}</span>
              <span><Icon name="swap" size={13} /> {t('calendar.legendExchange')}</span>
              <span><Icon name="star" size={13} /> {t('calendar.legendSpecial')}</span>
            </span>
            <span className="legend-hint">
              {loading ? <Spinner inline /> : t('calendar.legendClickHint')}
            </span>
          </div>
        )}
        {household && data && !adjusting && (
          <div className="adjust-entry">
            {adjustNotice && <div className="info-banner" role="status">{adjustNotice}</div>}
            <button className="secondary with-icon" onClick={startAdjust}>
              <Icon name="pencil" size={16} /> {t('adjust.open')}
            </button>
          </div>
        )}
        {adjusting && (
          <div className="adjust-hint">
            <Icon name="pencil" size={18} />
            <div>
              <strong>{t('adjust.hintTitle')}</strong>
              <p>{t('adjust.hintBody')}</p>
            </div>
          </div>
        )}
        <ContextTips dayOpened={selectedDay !== null} />
        {household && (
          <CalendarView
            data={
              data ?? {
                days: [],
                public_holidays: [],
                school_holidays: [],
                school_holidays_loaded: true,
                handover_day: 0,
                handover_time: '18:00',
                members: household.members,
                pending_exchanges: [],
                tasks: [],
              }
            }
            onDayClick={(date) => (adjusting ? toggleDay(date) : setSelectedDay(date))}
            flips={adjusting ? flipTargets : undefined}
            adjusting={adjusting}
            onRangeChange={(start, end) =>
              setRange((prev) => (prev && prev.start === start && prev.end === end ? prev : { start, end }))
            }
          />
        )}
      </div>
      {adjusting && (
        <div className="adjust-bar" role="region" aria-label={t('adjust.open')}>
          {recap.length > 0 && (
            <ul className="adjust-recap" aria-label={t('adjust.recapLabel')}>
              {recap.map((g) => {
                const color = household?.members.find((m) => m.id === g.to)?.color ?? '#888888'
                return (
                  <li key={g.start}>
                    <span className="dot" style={{ background: color }} />
                    <span className="adjust-recap-text">
                      {t('adjust.recapLine', { dates: fmtRange(g.start, g.end), name: memberName(g.to) })}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('adjust.recapRemove', { dates: fmtRange(g.start, g.end) })}
                      onClick={() => removeFlips(g.dates)}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="adjust-actions">
            <span className="adjust-count">
              {flipCount === 0 ? t('adjust.countNone') : t('adjust.count', { count: flipCount })}
            </span>
            <button className="secondary" onClick={cancelAdjust} disabled={adjustBusy}>
              {t('adjust.cancel')}
            </button>
            <button onClick={saveAdjust} disabled={adjustBusy || flipCount === 0}>
              {solo ? t('adjust.save') : t('adjust.propose')}
            </button>
          </div>
        </div>
      )}
      {inviteOpen && household && (
        <Modal eyebrow={t('invite.modalEyebrow')} title={t('invite.modalTitle')} onClose={() => setInviteOpen(false)}>
          <InviteShare household={household} source="calendar" />
          <p style={{ marginTop: 12, textAlign: 'right' }}>
            <button className="secondary" onClick={() => setInviteOpen(false)}>{t('invite.close')}</button>
          </p>
        </Modal>
      )}
      {selectedDay && household && (
        <ExceptionDialog
          householdId={household.id}
          date={selectedDay}
          members={household.members}
          existing={exceptions}
          currentParentId={data?.days.find((d) => d.date === selectedDay)?.parent_id}
          onClose={() => setSelectedDay(null)}
          onChanged={onChanged}
        />
      )}
    </>
  )
}
