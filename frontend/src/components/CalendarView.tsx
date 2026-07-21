import { useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import type { EventInput } from '@fullcalendar/core'
import type { CalendarResponse, Member } from '../types'

interface Props {
  data: CalendarResponse
  onDayClick: (date: string) => void
  onRangeChange: (start: string, end: string) => void
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const SOURCE_ICONS: Record<string, string> = {
  exception: '↔️',
  special: '⭐',
}

export default function CalendarView({ data, onDayClick, onRangeChange }: Props) {
  const memberById = useMemo(() => {
    const map = new Map<number, Member>()
    data.members.forEach((m) => map.set(m.id, m))
    return map
  }, [data.members])

  const events = useMemo<EventInput[]>(() => {
    const evts: EventInput[] = []

    // Blocs de garde fusionnés → événements de fond colorés
    const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date))
    let blockStart: string | null = null
    let blockEnd: string | null = null
    let blockParent: number | null = null
    const flush = () => {
      if (blockStart && blockEnd && blockParent !== null) {
        const member = memberById.get(blockParent)
        evts.push({
          start: blockStart,
          end: addDays(blockEnd, 1),
          display: 'background',
          color: member?.color ?? '#888888',
        })
      }
    }
    for (const d of days) {
      if (blockParent === d.parent_id && blockEnd && addDays(blockEnd, 1) === d.date) {
        blockEnd = d.date
      } else {
        flush()
        blockStart = d.date
        blockEnd = d.date
        blockParent = d.parent_id
      }
    }
    flush()

    // Pictos échanges / fêtes
    for (const d of days) {
      const icon = SOURCE_ICONS[d.source]
      if (icon) {
        const member = memberById.get(d.parent_id)
        evts.push({
          start: d.date,
          allDay: true,
          title: `${icon} ${member?.display_name ?? ''}`,
          color: 'transparent',
          textColor: 'var(--text)',
        })
      }
    }

    // Jours fériés
    for (const h of data.public_holidays) {
      evts.push({
        start: h.date,
        allDay: true,
        title: `📌 ${h.label}`,
        color: 'transparent',
        textColor: 'var(--text-soft)',
      })
    }

    // Vacances scolaires (bandeau)
    for (const p of data.school_holidays) {
      evts.push({
        start: p.start,
        end: addDays(p.end, 1),
        allDay: true,
        title: `🏖️ ${p.label}`,
        color: '#f3e8d2',
        textColor: '#7a5c1e',
      })
    }

    return evts
  }, [data, memberById])

  return (
    <FullCalendar
      plugins={[dayGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      locale={frLocale}
      headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' }}
      events={events}
      dateClick={(info) => onDayClick(info.dateStr)}
      datesSet={(info) => {
        const start = info.start.toISOString().slice(0, 10)
        const endExclusive = new Date(info.end)
        endExclusive.setDate(endExclusive.getDate() - 1)
        onRangeChange(start, endExclusive.toISOString().slice(0, 10))
      }}
      height="auto"
      firstDay={1}
      fixedWeekCount={false}
    />
  )
}
