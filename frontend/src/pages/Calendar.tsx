import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useAuth } from '../auth'
import CalendarView from '../components/CalendarView'
import ExceptionDialog from '../components/ExceptionDialog'
import Icon from '../components/Icon'
import TopBar from '../components/TopBar'
import WelcomeTour from '../components/WelcomeTour'
import { isSolo } from '../members'
import type { CalendarResponse, ScheduleException } from '../types'

function todayIso(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

export default function CalendarPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, household, householdLoaded } = useAuth()
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (householdLoaded && (!household || !household.custody_rule)) navigate('/onboarding')
  }, [householdLoaded, household, navigate])

  const loadCalendar = useCallback(() => {
    if (!household || !range) return
    api
      .calendar(household.id, range.start, range.end)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : t('calendar.genericError')))
    api.listExceptions(household.id).then(setExceptions).catch(() => {})
  }, [household, range])

  useEffect(loadCalendar, [loadCalendar])

  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]))
  const today = byDate.get(todayIso())
  const tomorrow = byDate.get(todayIso(1))
  const handoverTomorrow = today && tomorrow && today.parent_id !== tomorrow.parent_id
  const tomorrowParent = tomorrow && data?.members.find((m) => m.id === tomorrow.parent_id)

  // Propositions en attente non expirées, à traiter par moi (destinataire).
  const pendingForMe = exceptions.filter(
    (e) => e.status === 'pending' && e.created_by !== user?.id && e.date_start >= todayIso(),
  )
  // Propositions en attente qui expirent demain (date de début = demain).
  const expiringTomorrow = exceptions.filter((e) => e.status === 'pending' && e.date_start === todayIso(1))

  return (
    <>
      {user && !user.onboarding_seen && <WelcomeTour />}
      <TopBar householdName={household?.name} />
      <div className="layout">
        {error && <div className="error">{error}</div>}
        {pendingForMe.length > 0 && (
          <div className="info-banner banner-ic">
            <Icon name="clock" size={16} />
            <span>
              {pendingForMe.length === 1
                ? t('calendar.pendingForMeOne')
                : t('calendar.pendingForMeMany', { count: pendingForMe.length })}{' '}
              {t('calendar.pendingForMeTail')}
            </span>
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
        {handoverTomorrow && tomorrowParent && (
          <div className="info-banner banner-ic">
            <Icon name="swap" size={16} />
            <span>
              {t('calendar.handoverLead', {
                children: household?.children.map((c) => c.first_name).join(', ') || t('calendar.theChild'),
              })}{' '}
              <strong>{tomorrowParent.display_name}</strong>
              {data && t('calendar.handoverTime', { time: data.handover_time })}.
            </span>
          </div>
        )}
        {data && !data.school_holidays_loaded && (
          <div className="error">
            {t('calendar.schoolHolidaysError')}
          </div>
        )}
        {data && (
          <div className="legend">
            {data.members.map((m) => (
              <span key={m.id}>
                <span className="dot" style={{ background: m.color }} />
                {m.display_name}
              </span>
            ))}
            <span className="legend-icons">
              <span><Icon name="sun" size={13} /> {t('calendar.legendHolidays')}</span>
              <span><Icon name="flag" size={13} /> {t('calendar.legendPublicHoliday')}</span>
              <span><Icon name="swap" size={13} /> {t('calendar.legendExchange')}</span>
              <span><Icon name="star" size={13} /> {t('calendar.legendSpecial')}</span>
              <span><Icon name="clock" size={13} /> {t('calendar.legendProposed')}</span>
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--ink-soft)' }}>
              {t('calendar.legendClickHint')}
            </span>
          </div>
        )}
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
        {household && isSolo(household.members) && (
          <div className="info-banner" style={{ marginTop: 12 }}>
            {t('calendar.soloLead')}{' '}
            <a href="/settings">{t('calendar.soloSettingsLink')}</a> {t('calendar.soloTail')}
          </div>
        )}
      </div>
      {selectedDay && household && (
        <ExceptionDialog
          householdId={household.id}
          date={selectedDay}
          members={household.members}
          existing={exceptions}
          onClose={() => setSelectedDay(null)}
          onChanged={loadCalendar}
        />
      )}
    </>
  )
}
