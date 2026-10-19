import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { api, isPendingChange } from '../api'
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
import AdjustTools, { type AdjustTool, type PeriodRepeat } from '../components/AdjustTools'
import AppSplash from '../components/AppSplash'
import WhatsNew, { WHATS_NEW_ID, WHATS_NEW_SINCE } from '../components/WhatsNew'
import StatusCard from '../components/StatusCard'
import TopBar from '../components/TopBar'
import { addDays, todayIso } from '../dates'
import { useFormat } from '../format'
import { isSolo } from '../members'
import type { CalendarResponse, RecurringRuleInput, ScheduleException } from '../types'
import { describeRule, ruleInput } from '../recurring'

export default function CalendarPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { user, setUser, household, householdLoaded, refreshHousehold } = useAuth()
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
  // Pinceau : parent à qui va chaque jour touché ; outil jour par jour ou période.
  const [brush, setBrush] = useState<number | null>(null)
  const [tool, setTool] = useState<AdjustTool>('day')
  // Règles qui se répètent ajoutées pendant l'ajustement, enregistrées avec les jours.
  const [pendingRules, setPendingRules] = useState<RecurringRuleInput[]>([])
  // « Quoi de neuf » : une fois par compte, pour les comptes antérieurs à la mise à jour.
  const [whatsNewClosed, setWhatsNewClosed] = useState(false)
  const showWhatsNew =
    !whatsNewClosed &&
    !!user &&
    !!household?.custody_rule &&
    user.whats_new_seen !== WHATS_NEW_ID &&
    (user.created_at ?? '') < WHATS_NEW_SINCE
  const [adjustIsNew, setAdjustIsNew] = useState(() => {
    try {
      return localStorage.getItem('alternly_adjust_tools_seen') !== WHATS_NEW_ID
    } catch {
      return false
    }
  })

  function closeWhatsNew() {
    setWhatsNewClosed(true)
    track(EV.whatsNewClosed, { id: WHATS_NEW_ID })
    api
      .updateMe({ whats_new_seen: WHATS_NEW_ID })
      .then(setUser)
      .catch(() => {})
  }
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

  const otherParentOf = (id: number) => household?.members.find((m) => m.id !== id)?.id ?? id
  const whoLabel = (id: number) => {
    const m = household?.members.find((x) => x.id === id)
    if (id === user?.id) return t('adjust.brushMe').toLowerCase()
    return m && !m.is_placeholder ? t('adjust.recapWho', { name: m.display_name }) : t('adjust.brushOther').toLowerCase()
  }

  function memberName(id: number) {
    if (id === user?.id) return t('adjust.you')
    return household?.members.find((m) => m.id === id)?.display_name ?? ''
  }

  /** Pinceau : le jour va chez le parent choisi ; s'il y est déjà, il n'est plus modifié. */
  function paintDay(date: string) {
    const day = data?.days.find((d) => d.date === date)
    if (!day || brush === null) return
    setAdjustNotice(null)
    setFlips((prev) => {
      const next = { ...prev }
      if (day.parent_id === brush) delete next[date]
      else next[date] = { to: brush, clearId: null }
      return next
    })
  }

  /** Une période d'un coup : seuls les jours qui changent de parent sont retenus. */
  async function applyPeriod(start: string, end: string, repeat: PeriodRepeat): Promise<string | null> {
    if (!household || brush === null) return null
    if (repeat !== 'once') {
      // Chaque année : une règle, pas des jours. En alternance, parent_id = parent des années paires.
      const other = household.members.find((m) => m.id !== brush)?.id ?? brush
      const evenParent = repeat === 'alternate' && Number(start.slice(0, 4)) % 2 === 1 ? other : brush
      setPendingRules((r) => [
        ...r,
        { kind: 'yearly', parent_id: evenParent, start_md: start.slice(5), end_md: end.slice(5), alternate: repeat === 'alternate' },
      ])
      track(EV.adjustRuleAdded, { kind: 'yearly' })
      return null
    }
    try {
      const cal = await fetchCalendar(household.id, start, end)
      setFlips((prev) => {
        const next = { ...prev }
        for (const d of cal.days) {
          if (d.parent_id === brush) delete next[d.date]
          else next[d.date] = { to: brush, clearId: null }
        }
        return next
      })
      track(EV.adjustPeriodApplied, { days: cal.days.length })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : t('calendar.genericError')
    }
  }

  function startAdjust() {
    if (adjustIsNew) {
      setAdjustIsNew(false)
      try {
        localStorage.setItem('alternly_adjust_tools_seen', WHATS_NEW_ID)
      } catch {
        // stockage indisponible : le badge reviendra au prochain chargement
      }
    }
    setAdjusting(true)
    setFlips({})
    setTool('day')
    setPendingRules([])
    setBrush(household?.members.find((m) => m.id !== user?.id)?.id ?? user?.id ?? null)
    setAdjustNotice(null)
    track(EV.adjustModeOpened, {})
  }

  function cancelAdjust() {
    if (flipCount > 0) track(EV.adjustModeCancelled, { days: flipCount })
    setAdjusting(false)
    setFlips({})
    setPendingRules([])
  }

  function addWeekly(rule: { weekdays: number[]; every_other_week: boolean; include_vacations: boolean }) {
    if (brush === null) return
    setPendingRules((r) => [...r, { kind: 'weekly', parent_id: brush, anchor_date: todayIso(), ...rule }])
    track(EV.adjustRuleAdded, { kind: 'weekly' })
  }

  async function saveAdjust() {
    if (!household || (flipCount === 0 && pendingRules.length === 0)) return
    setAdjustBusy(true)
    setError(null)
    const other = household.members.find((m) => m.id !== user?.id)?.display_name ?? ''
    const notices: string[] = []
    if (pendingRules.length > 0) {
      try {
        const existing = (household.recurring_rules ?? []).map(ruleInput)
        const res = await api.setRecurringRules(household.id, [...existing, ...pendingRules.map(ruleInput)])
        notices.push(isPendingChange(res) ? t('adjust.rulesProposed', { name: other }) : t('adjust.rulesApplied', { count: pendingRules.length }))
        setPendingRules([])
        await refreshHousehold()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('calendar.genericError'))
        setAdjustBusy(false)
        return
      }
    }
    if (flipCount === 0) {
      setAdjustNotice(notices.join(' '))
      setAdjusting(false)
      setAdjustBusy(false)
      onChanged()
      return
    }
    const set: { date: string; parent_id: number }[] = []
    const clear: number[] = []
    for (const [date, f] of Object.entries(flips)) {
      if (f.clearId !== null) clear.push(f.clearId)
      else set.push({ date, parent_id: f.to })
    }
    try {
      const res = await api.saveAdjustments(household.id, { set, clear })
      notices.push(
        res.status === 'proposed'
          ? t('adjust.noticeProposed', { count: flipCount, name: other })
          : res.status === 'pending_consent'
            ? t('adjust.noticeConsent', { name: other })
            : t('adjust.noticeApplied', { count: flipCount }),
      )
      setAdjustNotice(notices.join(' '))
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
              {adjustIsNew && <span className="new-pill">{t('whatsNew.badge')}</span>}
            </button>
          </div>
        )}
        {adjusting && (
          <AdjustTools
            members={household?.members ?? []}
            myId={user?.id}
            tool={tool}
            onTool={setTool}
            brush={brush}
            onBrush={setBrush}
            onApplyPeriod={applyPeriod}
            onAddWeekly={addWeekly}
          />
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
            onDayClick={(date) => (adjusting ? paintDay(date) : setSelectedDay(date))}
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
          {(recap.length > 0 || pendingRules.length > 0) && (
            <ul className="adjust-recap" aria-label={t('adjust.recapLabel')}>
              {pendingRules.map((r, i) => {
                const m = household?.members.find((x) => x.id === r.parent_id)
                return (
                  <li key={`rule-${i}`}>
                    <span className="dot" style={{ background: m?.color ?? '#888888' }} />
                    <span className="adjust-recap-text">
                      {describeRule(t, i18n.language, r, whoLabel, otherParentOf)}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('adjust.recapRemoveRule')}
                      onClick={() => setPendingRules((list) => list.filter((_, k) => k !== i))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                )
              })}
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
              {flipCount === 0 && pendingRules.length === 0
                ? t('adjust.countNone')
                : [flipCount > 0 ? t('adjust.count', { count: flipCount }) : '', pendingRules.length > 0 ? t('adjust.countRules', { count: pendingRules.length }) : '']
                    .filter(Boolean)
                    .join(' · ')}
            </span>
            <button className="secondary" onClick={cancelAdjust} disabled={adjustBusy}>
              {t('adjust.cancel')}
            </button>
            <button onClick={saveAdjust} disabled={adjustBusy || (flipCount === 0 && pendingRules.length === 0)}>
              {solo ? t('adjust.save') : t('adjust.propose')}
            </button>
          </div>
        </div>
      )}
      {showWhatsNew && splashGone && (
        <WhatsNew
          onClose={closeWhatsNew}
          onTry={() => {
            closeWhatsNew()
            startAdjust()
          }}
        />
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
