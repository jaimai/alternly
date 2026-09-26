import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cachedCalendar, fetchCalendar } from '../calendarCache'
import { addDays, daysBetween, todayIso } from '../dates'
import { useFormat } from '../format'
import Icon from './Icon'
import type { IconName } from './Icon'
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

type Upcoming = { key: string; icon: IconName; text: string; when: string; date?: string; urgent?: boolean }

/** « Aujourd'hui, Léo est chez Dominique » + prochain passage + à venir. */
export default function StatusCard({ household, myId, exceptions, refreshKey, onOpenDay }: Props) {
  const { t, i18n } = useTranslation()
  const { day, dayLong, range, relativeDays } = useFormat()
  const [data, setData] = useState<CalendarResponse | null>(() => {
    const today = todayIso()
    return cachedCalendar(household.id, today, addDays(today, HORIZON_DAYS)) ?? null
  })

  useEffect(() => {
    const today = todayIso()
    const end = addDays(today, HORIZON_DAYS)
    const cached = cachedCalendar(household.id, today, end)
    if (cached) setData(cached)
    fetchCalendar(household.id, today, end)
      .then(setData)
      .catch(() => {
        if (!cached) setData(null)
      })
  }, [household.id, refreshKey])

  if (!data || data.days.length === 0) return null

  const today = todayIso()
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date))
  const current = days.find((d) => d.date === today) ?? days[0]
  const next = days.find((d) => d.date > current.date && d.parent_id !== current.parent_id)
  const member = (id: number) => data.members.find((m) => m.id === id)
  const holder = member(current.parent_id)
  const nextHolder = next ? member(next.parent_id) : undefined
  const who = (id: number | undefined, fallback = '?') =>
    id === myId ? t('calendar.statusYou') : (id !== undefined && member(id)?.display_name) || fallback

  const kids = household.children.map((c) => c.first_name)
  const kidsLabel =
    kids.length === 0
      ? t('calendar.statusKidsNone')
      : new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(kids)
  const titleLead = t(kids.length === 1 ? 'calendar.statusTitleOne' : 'calendar.statusTitleMany', { kids: kidsLabel })

  const upcoming: Upcoming[] = []
  for (const e of exceptions) {
    if (e.status === 'pending' && e.created_by !== myId && e.date_start >= today) {
      upcoming.push({
        key: `x-${e.id}`,
        icon: 'clock',
        text: t('calendar.statusExchangeProposed', {
          range: range(e.date_start, e.date_end),
          name: member(e.parent_id)?.display_name ?? '?',
        }),
        when: t('calendar.statusToHandle'),
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
      icon: 'sun',
      text: inProgress ? t('calendar.statusVacationUntil', { label: vacation.label, day: day(vacation.end) }) : vacation.label,
      when: inProgress ? t('calendar.statusInProgress') : relativeDays(daysBetween(today, vacation.start)),
      date: inProgress ? undefined : vacation.start,
    })
  }
  for (const task of data.tasks.filter((x) => x.due_date >= today).slice(0, 2)) {
    upcoming.push({
      key: `t-${task.id}`,
      icon: 'task',
      text: task.body,
      when: relativeDays(daysBetween(today, task.due_date)),
      date: task.due_date,
    })
  }
  const holiday = data.public_holidays.find((h) => h.date >= today)
  if (holiday && upcoming.length < 4) {
    upcoming.push({
      key: 'ph',
      icon: 'flag',
      text: holiday.label,
      when: relativeDays(daysBetween(today, holiday.date)),
      date: holiday.date,
    })
  }

  return (
    <section className="status-card ph-mask ph-sensitive" style={{ ['--holder' as string]: holder?.color ?? 'var(--pine)' }}>
      <div className="status-main">
        <p className="eyebrow">{t('calendar.statusToday', { day: dayLong(today) })}</p>
        <h1 className="status-title">
          {titleLead} <span className="holder">{who(holder?.id)}</span>
        </h1>
        {next && nextHolder ? (
          <p className="status-sub">
            {t('calendar.statusNextLead')} <strong>{who(nextHolder.id)}</strong>{' '}
            {t('calendar.statusNextTail', { day: dayLong(next.date), time: data.handover_time.slice(0, 5) })}{' '}
            <span className="pill">{relativeDays(daysBetween(today, next.date))}</span>
          </p>
        ) : (
          <p className="status-sub">{t('calendar.statusNoHandover')}</p>
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
                <span className="upcoming-icon" aria-hidden="true">
                  <Icon name={u.icon} size={15} />
                </span>
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
