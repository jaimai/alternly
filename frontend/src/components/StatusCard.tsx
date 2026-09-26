import { useEffect, useState } from 'react'
import { api } from '../api'
import { addDays, daysBetween, fmtDay, fmtDayLong, fmtRange, relativeDays, todayIso } from '../dates'
import type { CalendarResponse, Household, ScheduleException } from '../types'

// Horizon de la carte : assez loin pour trouver le prochain passage même en
// vacances d'été (2 × 4 semaines) et la prochaine période de vacances.
const HORIZON_DAYS = 75

interface Props {
  household: Household
  myId: number
  exceptions: ScheduleException[]
  refreshKey: number
  onOpenDay: (date: string) => void
}

type Upcoming = { key: string; icon: string; text: string; when: string; date?: string; urgent?: boolean }

export default function StatusCard({ household, myId, exceptions, refreshKey, onOpenDay }: Props) {
  const [data, setData] = useState<CalendarResponse | null>(null)

  useEffect(() => {
    const today = todayIso()
    api
      .calendar(household.id, today, addDays(today, HORIZON_DAYS))
      .then(setData)
      .catch(() => setData(null))
  }, [household.id, refreshKey])

  if (!data || data.days.length === 0) return null

  const today = todayIso()
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date))
  const current = days.find((d) => d.date === today) ?? days[0]
  const next = days.find((d) => d.date > current.date && d.parent_id !== current.parent_id)
  const member = (id: number) => data.members.find((m) => m.id === id)
  const holder = member(current.parent_id)
  const nextHolder = next ? member(next.parent_id) : undefined

  const kids = household.children.map((c) => c.first_name)
  const kidsLabel =
    kids.length === 0 ? 'Les enfants' : kids.length === 1 ? kids[0] : `${kids.slice(0, -1).join(', ')} et ${kids.at(-1)}`
  const verb = kids.length === 1 ? 'est' : 'sont'
  const holderName = holder ? (holder.id === myId ? 'vous' : holder.display_name) : '?'

  const upcoming: Upcoming[] = []
  for (const e of exceptions) {
    if (e.status === 'pending' && e.created_by !== myId && e.date_start >= today) {
      upcoming.push({
        key: `x-${e.id}`,
        icon: '⏳',
        text: `Échange proposé : ${fmtRange(e.date_start, e.date_end)} chez ${member(e.parent_id)?.display_name ?? '?'}`,
        when: 'À traiter',
        date: e.date_start,
        urgent: true,
      })
    }
  }
  const vacation = data.school_holidays.find((p) => p.end >= today)
  if (vacation) {
    const inProgress = vacation.start <= today
    upcoming.push({
      key: 'vac',
      icon: '🏖️',
      text: inProgress ? `${vacation.label} jusqu'au ${fmtDay(vacation.end)}` : vacation.label,
      when: inProgress ? 'En cours' : relativeDays(daysBetween(today, vacation.start)),
      date: inProgress ? undefined : vacation.start,
    })
  }
  for (const t of data.tasks.slice(0, 2)) {
    upcoming.push({ key: `t-${t.id}`, icon: '✓', text: t.body, when: relativeDays(daysBetween(today, t.due_date)), date: t.due_date })
  }
  const holiday = data.public_holidays.find((h) => h.date >= today)
  if (holiday && upcoming.length < 4) {
    upcoming.push({ key: 'ph', icon: '📌', text: holiday.label, when: relativeDays(daysBetween(today, holiday.date)), date: holiday.date })
  }

  return (
    <section className="status-card" style={{ ['--holder' as string]: holder?.color ?? 'var(--pine)' }}>
      <div className="status-main">
        <p className="eyebrow">Aujourd'hui · {fmtDayLong(today)}</p>
        <h1 className="status-title">
          {kidsLabel} {verb} chez <span className="holder">{holderName}</span>
        </h1>
        {next && nextHolder ? (
          <p className="status-sub">
            Prochain passage chez <strong>{nextHolder.id === myId ? 'vous' : nextHolder.display_name}</strong>{' '}
            {fmtDayLong(next.date)} vers {data.handover_time.slice(0, 5)}{' '}
            <span className="pill">{relativeDays(daysBetween(today, next.date))}</span>
          </p>
        ) : (
          <p className="status-sub">Pas de changement de foyer prévu dans les prochaines semaines.</p>
        )}
      </div>
      {upcoming.length > 0 && (
        <ul className="upcoming">
          {upcoming.slice(0, 4).map((u) => (
            <li key={u.key}>
              <button
                type="button"
                className={`upcoming-item${u.urgent ? ' urgent' : ''}`}
                onClick={() => u.date && onOpenDay(u.date)}
                disabled={!u.date}
              >
                <span className="upcoming-icon" aria-hidden="true">{u.icon}</span>
                <span className="upcoming-text">{u.text}</span>
                <span className="upcoming-when">{u.when}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
