import { useEffect, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import type { EventInput } from '@fullcalendar/core'
import type { CalendarResponse, Member } from '../types'
import { addDays, isoLocal } from '../dates'

interface Props {
  data: CalendarResponse
  onDayClick: (date: string) => void
  onRangeChange: (start: string, end: string) => void
}

const SOURCE_ICONS: Record<string, string> = {
  exception: '↔',
  special: '★',
}

function useIsMobile(): boolean {
  const query = '(max-width: 640px)'
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

export default function CalendarView({ data, onDayClick, onRangeChange }: Props) {
  const mobile = useIsMobile()
  const memberById = useMemo(() => {
    const map = new Map<number, Member>()
    data.members.forEach((m) => map.set(m.id, m))
    return map
  }, [data.members])

  // Garde jour par jour + jour de passage (le parent change par rapport à la veille).
  const custody = useMemo(() => {
    const byDate = new Map<string, { parent: number; from: number | null }>()
    const sorted = [...data.days].sort((a, b) => a.date.localeCompare(b.date))
    let prev: { date: string; parent: number } | null = null
    for (const d of sorted) {
      const from =
        prev && prev.parent !== d.parent_id && addDays(prev.date, 1) === d.date ? prev.parent : null
      byDate.set(d.date, { parent: d.parent_id, from })
      prev = { date: d.date, parent: d.parent_id }
    }
    return byDate
  }, [data.days])

  // Couleurs des parents injectées en CSS : une tuile teintée par jour, et un
  // dégradé diagonal les jours de passage (ancien parent → nouveau parent).
  const paletteCss = useMemo(() => {
    const rules: string[] = []
    for (const m of data.members) {
      rules.push(`.fc .p-${m.id} .fc-daygrid-day-frame{--tile:${m.color}}`)
      for (const o of data.members) {
        if (o.id === m.id) continue
        rules.push(
          `.fc .p-${m.id}.from-${o.id} .fc-daygrid-day-frame{background:linear-gradient(135deg,color-mix(in srgb,${o.color} 24%,white) 0 50%,color-mix(in srgb,${m.color} 24%,white) 50% 100%)}`,
        )
      }
    }
    return rules.join('\n')
  }, [data.members])

  const events = useMemo<EventInput[]>(() => {
    const evts: EventInput[] = []
    const label = (title: string, date: string, className: string) =>
      evts.push({ start: date, allDay: true, title, classNames: ['cal-label', className], extendedProps: { clickDate: date } })

    for (const d of data.days) {
      const icon = SOURCE_ICONS[d.source]
      if (icon) label(`${icon} ${memberById.get(d.parent_id)?.display_name ?? ''}`, d.date, `src-${d.source}`)
    }

    for (const h of data.public_holidays) label(h.label, h.date, 'holiday')

    for (const p of data.school_holidays) {
      evts.push({
        start: p.start,
        end: addDays(p.end, 1),
        allDay: true,
        title: p.label,
        classNames: ['cal-vacation'],
      })
    }

    for (const t of data.tasks) label(`✓ ${t.body}`, t.due_date, 'task')

    // Propositions d'échange en attente : hachures par-dessus la garde réelle, sans la changer.
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
      label(`Proposé · ${member?.display_name ?? ''}`, px.date_start, 'pending')
    }

    return evts
  }, [data, memberById])

  return (
    <div className="calendar-shell">
      <style>{paletteCss}</style>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale={frLocale}
        headerToolbar={
          mobile
            ? { left: 'title', center: '', right: 'today prev,next' }
            : { left: 'title', center: '', right: 'today prev,next dayGridMonth,dayGridWeek' }
        }
        buttonText={{ today: "Aujourd'hui", month: 'Mois', week: 'Semaine' }}
        events={events}
        dayCellClassNames={(arg) => {
          const c = custody.get(isoLocal(arg.date))
          if (!c) return []
          return c.from !== null ? [`p-${c.parent}`, `from-${c.from}`, 'handover'] : [`p-${c.parent}`]
        }}
        dateClick={(info) => onDayClick(info.dateStr)}
        eventClick={(info) => {
          const d = info.event.extendedProps.clickDate as string | undefined
          onDayClick(d ?? info.event.startStr.slice(0, 10))
        }}
        datesSet={(info) => {
          const endInclusive = new Date(info.end)
          endInclusive.setDate(endInclusive.getDate() - 1)
          onRangeChange(isoLocal(info.start), isoLocal(endInclusive))
        }}
        height="auto"
        firstDay={1}
        fixedWeekCount={false}
        dayMaxEvents={mobile ? 1 : 3}
        moreLinkText={(n) => `+${n}`}
      />
    </div>
  )
}
