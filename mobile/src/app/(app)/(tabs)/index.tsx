import { router } from 'expo-router'
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Icon } from '@/components/Icon'
import { InviteCard } from '@/components/InviteCard'
import { Body, Button, Card, ErrorState, Loading, SectionLabel } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { WEB_URL } from '@/lib/colors'
import { exchangesToAnswer, isSolo, memberById, relativeDays, statusLead, todayStatus, whoName } from '@/lib/custody'
import { addDays, daysBetween, formatLong, formatRange, formatShort, parseIso, todayIso } from '@/lib/dates'
import { useMe, useNotifications, useUpcoming } from '@/lib/queries'
import { colors, fonts, radius, tint } from '@/lib/theme'
import type { CalendarResponse, Household } from '@/lib/types'

export default function Home() {
  const me = useMe()
  const { household, calendar } = useUpcoming()
  const unread = useNotifications().data?.filter((n) => n.read_at === null).length ?? 0
  const today = todayIso()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>{capitalize(formatLong(today))}</Text>
          <Text accessibilityRole="header" style={s.hello}>
            Bonjour {me.data?.display_name ?? ''}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `Notifications, ${unread} non lues` : 'Notifications'}
          onPress={() => router.push('/notifications')}
          style={s.bell}
        >
          <Icon name="bell" />
          {unread > 0 ? (
            <View style={s.badge}>
              <Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {calendar.isPending ? (
        <Loading />
      ) : calendar.isError ? (
        calendar.error instanceof ApiError && calendar.error.status === 409 ? (
          <NoRule />
        ) : (
          <ErrorState message={calendar.error.message} onRetry={() => calendar.refetch()} />
        )
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl refreshing={calendar.isRefetching} onRefresh={() => calendar.refetch()} tintColor={colors.pine} />
          }
        >
          <Content cal={calendar.data} household={household!} meId={me.data?.id} today={today} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Content({ cal, household, meId, today }: { cal: CalendarResponse; household: Household; meId?: number; today: string }) {
  const status = todayStatus(cal, today)
  const holder = memberById(cal.members, status.today?.parent_id)
  const who = (id?: number) => whoName(cal.members, id, meId)
  const kids = household.children.map((c) => c.first_name)
  const toAnswer = exchangesToAnswer(cal, meId)
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const byDate = new Map(cal.days.map((d) => [d.date, d]))
  const vacation = cal.school_holidays.find((p) => p.end >= today)
  const holiday = cal.public_holidays.find((h) => h.date >= today)
  const tasks = cal.tasks.filter((t) => t.due_date >= today && (t.assigned_to === null || t.assigned_to === meId)).slice(0, 2)

  return (
    <>
      <View style={[s.status, { backgroundColor: colors.pine }]}>
        {status.today ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: holder?.color ?? '#9fd0b8' }} />
              <Text style={s.statusEyebrow}>En ce moment</Text>
            </View>
            <Text style={s.statusTitle}>
              {statusLead(kids)} {who(status.today.parent_id)}
            </Text>
            {status.next ? (
              <View style={s.next}>
                <Icon name="swap" color="#fff" />
                <Text style={s.nextText}>
                  Prochain passage chez <Text style={{ fontFamily: fonts.bodyBold }}>{who(status.next.to)}</Text>{' '}
                  {formatLong(status.next.date)}
                  {status.next.time ? ` vers ${status.next.time.slice(0, 5)}` : ''} · {relativeDays(daysBetween(today, status.next.date))}
                </Text>
              </View>
            ) : (
              <Text style={s.nextText}>Pas de changement de foyer prévu dans les prochains mois.</Text>
            )}
          </>
        ) : (
          <Text style={s.statusTitle}>Le calendrier ne couvre pas encore aujourd’hui.</Text>
        )}
      </View>

      {isSolo(household.members) ? (
        <InviteCard householdId={household.id} childNames={household.children.map((c) => c.first_name)} />
      ) : null}

      {toAnswer.map((e) => (
        <Pressable
          key={e.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/exchange/[id]', params: { id: String(e.id) } })}
          style={({ pressed }) => [s.todo, pressed && { opacity: 0.85 }]}
        >
          <View style={s.todoIcon}>
            <Icon name="swap" color="#fff" size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.todoTitle}>Échange à valider</Text>
            <Text style={s.todoText}>
              {formatRange(e.date_start, e.date_end)} chez {who(e.proposed_parent_id)}
            </Text>
          </View>
          <Icon name="chevron" color={colors.inkSoft} size={20} />
        </Pressable>
      ))}

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionLabel>7 prochains jours</SectionLabel>
          <Text accessibilityRole="link" onPress={() => router.navigate('/calendar')} style={s.link}>
            Voir le mois
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {week.map((d) => {
            const day = byDate.get(d)
            const color = memberById(cal.members, day?.parent_id)?.color ?? colors.line
            const isToday = d === today
            return (
              <View
                key={d}
                style={{ alignItems: 'center', gap: 4 }}
                accessible
                accessibilityLabel={`${formatLong(d)} : ${day ? `chez ${who(day.parent_id)}` : 'inconnu'}`}
              >
                <Text style={s.weekLabel}>{parseIso(d).toLocaleDateString('fr-FR', { weekday: 'short' })}</Text>
                <View style={[s.weekCell, { backgroundColor: tint(color, 0.3) }, isToday && s.weekToday]}>
                  <Text style={s.weekNum}>{parseIso(d).getDate()}</Text>
                  <View style={[s.weekStrip, { backgroundColor: color }]} />
                </View>
              </View>
            )
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
          {cal.members.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: m.color }} />
              <Text style={s.legend}>{m.id === meId ? 'Vous' : m.display_name}</Text>
            </View>
          ))}
        </View>
      </Card>

      {vacation || holiday || tasks.length > 0 ? (
        <Card>
          <SectionLabel>À venir</SectionLabel>
          {vacation ? (
            <Upcoming
              title={vacation.label}
              detail={vacation.start <= today ? `En cours, jusqu'au ${formatShort(vacation.end)}` : `${formatShort(vacation.start)} → ${formatShort(vacation.end)}`}
              when={vacation.start <= today ? 'en cours' : relativeDays(daysBetween(today, vacation.start))}
            />
          ) : null}
          {tasks.map((t) => (
            <Upcoming key={t.id} title={t.body} detail="Tâche du tableau" when={relativeDays(daysBetween(today, t.due_date))} />
          ))}
          {holiday ? (
            <Upcoming title={holiday.label} detail="Jour férié" when={relativeDays(daysBetween(today, holiday.date))} />
          ) : null}
        </Card>
      ) : null}
    </>
  )
}

function Upcoming({ title, detail, when }: { title: string; detail: string; when: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft }}>{detail}</Text>
      </View>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.terraText }}>{when}</Text>
    </View>
  )
}

function NoRule() {
  return (
    <View style={{ padding: 20, gap: 14 }}>
      <Card>
        <Body style={{ fontFamily: fonts.bodySemiBold }}>Aucun rythme de garde défini</Body>
        <Body muted>
          Choisissez votre rythme (semaine/semaine, 2-2-3…) sur alternly.com : le calendrier apparaîtra ici
          automatiquement.
        </Body>
        <Button title="Ouvrir alternly.com" onPress={() => Linking.openURL(`${WEB_URL}/settings`)} />
      </Card>
    </View>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  eyebrow: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  hello: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  bell: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.paper,
  },
  badgeText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 11 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  status: { borderRadius: 22, padding: 18, gap: 12 },
  statusEyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  statusTitle: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: '#fff' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 12 },
  nextText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: '#fff' },
  todo: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg,
    backgroundColor: '#fdf3ee', borderWidth: 1, borderColor: '#e8c4b2',
  },
  todoIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center' },
  todoTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  todoText: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.pine, paddingVertical: 6 },
  weekLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.inkSoft },
  weekCell: { width: 38, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  weekStrip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5 },
  weekToday: { borderWidth: 2, borderColor: colors.ink },
  weekNum: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  legend: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
})
