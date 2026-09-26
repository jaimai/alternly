import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import CalendarView from '../components/CalendarView'
import ExceptionDialog from '../components/ExceptionDialog'
import StatusCard from '../components/StatusCard'
import TopBar from '../components/TopBar'
import WelcomeTour from '../components/WelcomeTour'
import { todayIso } from '../dates'
import type { CalendarResponse, Household, ScheduleException } from '../types'

export default function CalendarPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [household, setHousehold] = useState<Household | null>(null)
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    api
      .myHousehold()
      .then((h) => {
        if (!h.custody_rule) navigate('/onboarding')
        else setHousehold(h)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) navigate('/onboarding')
        else setError(err instanceof Error ? err.message : 'Erreur')
      })
  }, [navigate])

  const loadCalendar = useCallback(() => {
    if (!household || !range) return
    api
      .calendar(household.id, range.start, range.end)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
    api.listExceptions(household.id).then(setExceptions).catch(() => {})
  }, [household, range])

  useEffect(loadCalendar, [loadCalendar])

  // Propositions en attente qui expirent demain (date de début = demain).
  const expiringTomorrow = exceptions.filter((e) => e.status === 'pending' && e.date_start === todayIso(1))

  return (
    <>
      {user && !user.onboarding_seen && <WelcomeTour />}
      <TopBar householdName={household?.name} />
      <div className="layout">
        {error && <div className="error">{error}</div>}
        {household && user && (
          <StatusCard
            household={household}
            myId={user.id}
            exceptions={exceptions}
            refreshKey={refreshKey}
            onOpenDay={setSelectedDay}
          />
        )}
        {household?.members.length === 1 && (
          <div className="callout">
            <div>
              <strong>Vous êtes seul·e sur ce calendrier.</strong>
              <p>Invitez l'autre parent : il verra le même planning et pourra proposer des échanges.</p>
            </div>
            <Link className="button" to="/settings#parents">
              Inviter l'autre parent
            </Link>
          </div>
        )}
        {expiringTomorrow.length > 0 && (
          <div className="info-banner">
            {expiringTomorrow.length === 1 ? 'Une proposition expire demain' : `${expiringTomorrow.length} propositions expirent demain`}{' '}
            si elles ne sont pas traitées.
          </div>
        )}
        {data && !data.school_holidays_loaded && (
          <div className="info-banner">
            Les vacances scolaires n'ont pas pu être chargées : le calendrier affiche pour l'instant le rythme de base.
          </div>
        )}
        {data && (
          <div className="legend">
            {data.members.map((m) => (
              <span key={m.id} className="legend-item">
                <span className="dot" style={{ background: m.color }} />
                {m.id === user?.id ? `${m.display_name} (vous)` : m.display_name}
              </span>
            ))}
            <span className="legend-item">
              <span className="dot handover-dot" />
              Jour de passage
            </span>
            <span className="legend-item">
              <span className="dot pending-dot" />
              Échange proposé
            </span>
            <span className="legend-hint">Touchez un jour pour proposer un échange</span>
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
      </div>
      {selectedDay && household && (
        <ExceptionDialog
          householdId={household.id}
          date={selectedDay}
          members={household.members}
          existing={exceptions}
          currentParentId={data?.days.find((d) => d.date === selectedDay)?.parent_id}
          onClose={() => setSelectedDay(null)}
          onChanged={() => {
            loadCalendar()
            setRefreshKey((k) => k + 1)
          }}
        />
      )}
    </>
  )
}
