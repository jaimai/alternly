import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import CalendarView from '../components/CalendarView'
import ExceptionDialog from '../components/ExceptionDialog'
import TopBar from '../components/TopBar'
import type { CalendarResponse, Household, ScheduleException } from '../types'

function todayIso(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

export default function CalendarPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [household, setHousehold] = useState<Household | null>(null)
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      <TopBar householdName={household?.name} />
      <div className="layout">
        {error && <div className="error">{error}</div>}
        {pendingForMe.length > 0 && (
          <div className="info-banner">
            ⏳ {pendingForMe.length === 1 ? 'Une proposition d’échange attend' : `${pendingForMe.length} propositions d’échange attendent`}{' '}
            votre réponse — cliquez sur le jour concerné pour accepter ou refuser.
          </div>
        )}
        {expiringTomorrow.length > 0 && (
          <div className="info-banner">
            ⚠️ {expiringTomorrow.length === 1 ? 'Une proposition expire demain' : `${expiringTomorrow.length} propositions expirent demain`}{' '}
            si elles ne sont pas traitées.
          </div>
        )}
        {handoverTomorrow && tomorrowParent && (
          <div className="info-banner">
            🔁 Changement de foyer demain : {household?.children.map((c) => c.first_name).join(', ') || "l'enfant"}{' '}
            sera chez <strong>{tomorrowParent.display_name}</strong>
            {data && ` (passage vers ${data.handover_time})`}.
          </div>
        )}
        {data && !data.school_holidays_loaded && (
          <div className="error">
            Les vacances scolaires n'ont pas pu être chargées — le calendrier affiche uniquement le rythme de base.
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
            <span style={{ color: 'var(--ink-soft)' }}>🏖️ vacances · 📌 férié · ↔️ échange · ⭐ fête · ⏳ proposé</span>
            <span style={{ marginLeft: 'auto', color: 'var(--ink-soft)' }}>
              Cliquez sur un jour pour proposer un échange
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
        {household?.members.length === 1 && (
          <div className="info-banner" style={{ marginTop: 12 }}>
            Vous utilisez Coparent en solo pour l'instant. Invitez l'autre parent depuis les{' '}
            <a href="/app/settings">réglages</a> pour partager ce calendrier.
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
