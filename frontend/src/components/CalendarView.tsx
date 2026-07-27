import { useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import type { EventContentArg, EventInput } from '@fullcalendar/core'
import Icon from './Icon'
import type { IconName } from './Icon'
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

const SOURCE_ICONS: Record<string, IconName> = {
  exception: 'swap',
  special: 'star',
}

function renderEvent(arg: EventContentArg) {
  if (arg.event.display === 'background') return undefined // garde / overlay : rendu par défaut
  const icon = arg.event.extendedProps.icon as IconName | undefined
  return (
    <div className="fc-ic">
      {icon && <Icon name={icon} size={12} />}
      <span className="fc-ic-label">{arg.event.title}</span>
    </div>
  )
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
          title: member?.display_name ?? '',
          extendedProps: { icon },
          color: 'transparent',
          textColor: 'var(--ink)',
        })
      }
    }

    // Jours fériés
    for (const h of data.public_holidays) {
      evts.push({
        start: h.date,
        allDay: true,
        title: h.label,
        extendedProps: { icon: 'flag' },
        color: 'transparent',
        textColor: 'var(--ink-soft)',
      })
    }

    // Vacances scolaires (bandeau)
    for (const p of data.school_holidays) {
      evts.push({
        start: p.start,
        end: addDays(p.end, 1),
        allDay: true,
        title: p.label,
        extendedProps: { icon: 'sun' },
        color: '#f3e8d2',
        textColor: '#7a5c1e',
      })
    }

    // Tâches datées du mur : repère sur le jour d'échéance
    for (const t of data.tasks) {
      evts.push({
        start: t.due_date,
        allDay: true,
        title: t.body,
        extendedProps: { icon: 'note' },
        color: 'transparent',
        textColor: 'var(--ink-soft)',
      })
    }

    // Propositions d'échange en attente : overlay provisoire (hachures), sans changer la garde
    for (const px of data.pending_exchanges) {
      const member = memberById.get(px.proposed_parent_id)
      evts.push({
        start: px.date_start,
        end: addDays(px.date_end, 1),
        allDay: true,
        display: 'background',
        classNames: ['pending-overlay'],
        color: member?.color ?? '#888888',
      })
      evts.push({
        start: px.date_start,
        allDay: true,
        title: `proposé — ${member?.display_name ?? ''}`,
        extendedProps: { icon: 'clock' },
        color: 'transparent',
        textColor: 'var(--ink-soft)',
      })
    }

    return evts
  }, [data, memberById])

  return (
    <FullCalendar
      plugins={[dayGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      locale={frLocale}
      headerToolbar={{
        left: 'prevYear,prev,next,nextYear today',
        center: 'title',
        right: 'dayGridMonth,dayGridWeek',
      }}
      events={events}
      eventContent={renderEvent}
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
