import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import type { EventContentArg, EventInput } from '@fullcalendar/core'
import Icon from './Icon'
import type { IconName } from './Icon'
import type { CalendarResponse, Member } from '../types'
import { addDays, isoLocal } from '../dates'

interface Props {
  data: CalendarResponse
  onDayClick: (date: string) => void
  onRangeChange: (start: string, end: string) => void
}

const SOURCE_ICONS: Record<string, IconName> = {
  exception: 'swap',
  special: 'star',
}

const MOBILE_QUERY = '(max-width: 640px)'

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

function renderEvent(arg: EventContentArg) {
  if (arg.event.display === 'background') return undefined // overlay : rendu par défaut
  const icon = arg.event.extendedProps.icon as IconName | undefined
  return (
    <div className="fc-ic">
      {icon && <Icon name={icon} size={11} />}
      <span className="fc-ic-label">{arg.event.title}</span>
    </div>
  )
}

export default function CalendarView({ data, onDayClick, onRangeChange }: Props) {
  const { t, i18n } = useTranslation()
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
    const safe = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#888888')
    const rules: string[] = []
    for (const m of data.members) {
      rules.push(`.fc .p-${m.id} .fc-daygrid-day-frame{--tile:${safe(m.color)}}`)
      for (const o of data.members) {
        if (o.id === m.id) continue
        rules.push(
          `.fc .p-${m.id}.from-${o.id} .fc-daygrid-day-frame{background:linear-gradient(135deg,color-mix(in srgb,${safe(o.color)} 24%,white) 0 50%,color-mix(in srgb,${safe(m.color)} 24%,white) 50% 100%)}`,
        )
      }
    }
    return rules.join('\n')
  }, [data.members])

  const events = useMemo<EventInput[]>(() => {
    const evts: EventInput[] = []
    const label = (title: string, date: string, className: string, icon?: IconName) =>
      evts.push({
        start: date,
        allDay: true,
        title,
        classNames: ['cal-label', className],
        extendedProps: { clickDate: date, icon },
      })

    // Échanges / fêtes : pictogramme + parent
    for (const d of data.days) {
      const icon = SOURCE_ICONS[d.source]
      if (icon) label(memberById.get(d.parent_id)?.display_name ?? '', d.date, `src-${d.source}`, icon)
    }

    // Jours fériés
    for (const h of data.public_holidays) label(h.label, h.date, 'holiday', 'flag')

    // Vacances scolaires (bandeau)
    for (const p of data.school_holidays) {
      evts.push({
        start: p.start,
        end: addDays(p.end, 1),
        allDay: true,
        title: p.label,
        classNames: ['cal-vacation'],
        extendedProps: { clickDate: p.start, icon: 'sun' },
      })
    }

    // Tâches datées du mur : repère sur le jour d'échéance
    for (const task of data.tasks) label(task.body, task.due_date, 'task', 'task')

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
      label(t('calendar.proposedLabel', { name: member?.display_name ?? '' }), px.date_start, 'pending', 'clock')
    }

    return evts
  }, [data, memberById, t])

  return (
    <div className="calendar-shell">
      <style>{paletteCss}</style>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale={i18n.language.startsWith('fr') ? frLocale : 'en'}
        headerToolbar={
          mobile
            ? { left: 'title', center: '', right: 'today prev,next' }
            : { left: 'title', center: '', right: 'today prevYear,prev,next,nextYear dayGridMonth,dayGridWeek' }
        }
        events={events}
        eventContent={renderEvent}
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
