import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { useAuth } from '../auth'
import CalendarView from '../components/CalendarView'
import ChangeRequests from '../components/ChangeRequests'
import ContextTips from '../components/ContextTips'
import ExceptionDialog from '../components/ExceptionDialog'
import Icon from '../components/Icon'
import InviteShare from '../components/InviteShare'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import { cachedCalendar, cachedExceptions, fetchCalendar, fetchExceptions, invalidateCalendar } from '../calendarCache'
import StatusCard from '../components/StatusCard'
import TopBar from '../components/TopBar'
import { todayIso } from '../dates'
import { isSolo } from '../members'
import type { CalendarResponse, ScheduleException } from '../types'

export default function CalendarPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, household, householdLoaded } = useAuth()
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Incrémenté après chaque changement : recharge la carte de statut.
  const [refreshKey, setRefreshKey] = useState(0)
  // Arrivée depuis un lien d'invitation déjà utilisé par ce parent (page /join).
  const location = useLocation()
  const alreadyMember = (location.state as { notice?: string } | null)?.notice === 'alreadyMember'

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
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('calendar.genericError')))
      .finally(() => setLoading(false))
    fetchExceptions(household.id).then(setExceptions).catch(() => {})
  }, [household, range, t])

  useEffect(loadCalendar, [loadCalendar])

  const onChanged = useCallback(() => {
    if (household) invalidateCalendar(household.id)
    loadCalendar()
    setRefreshKey((k) => k + 1)
  }, [household, loadCalendar])

  // Propositions en attente qui expirent demain (date de début = demain).
  const expiringTomorrow = exceptions.filter((e) => e.status === 'pending' && e.date_start === todayIso(1))
  const solo = household ? isSolo(household.members) : false

  return (
    <>
      <TopBar householdName={household?.name} />
      <div className="layout">
        {error && <div className="error">{error}</div>}
        {alreadyMember && <div className="info-banner">{t('calendar.alreadyMember')}</div>}
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
            onDayClick={(date) => setSelectedDay(date)}
            onRangeChange={(start, end) =>
              setRange((prev) => (prev && prev.start === start && prev.end === end ? prev : { start, end }))
            }
          />
        )}
      </div>
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
