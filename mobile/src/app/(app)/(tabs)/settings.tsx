// Réglages : profil, demandes de changement, foyer (enfants, zone, garde, jours de fête),
// notifications, compte. Chaque rubrique s'ouvre dans son écran (app/(app)/settings/…).
import Constants from 'expo-constants'
import { router, type Href } from 'expo-router'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChangeRequests } from '@/components/ChangeRequests'
import { Icon } from '@/components/Icon'
import { InviteCard } from '@/components/InviteCard'
import { Avatar, Screen, SectionLabel, Title } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { isSolo } from '@/lib/custody'
import { useBilling, useHousehold, useMe } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'

const PATTERN_LABEL: Record<string, string> = {
  alternate_weeks: 'Semaine / semaine',
  every_other_weekend: 'Un week-end sur deux',
  two_two_three: '2-2-3',
  custom: 'Organisation personnalisée',
}

export default function Settings() {
  const { signOut } = useAuth()
  const me = useMe().data
  const household = useHousehold().data
  const billing = useBilling().data

  const confirmSignOut = () =>
    Alert.alert('Se déconnecter ?', 'Vous pourrez vous reconnecter avec le même compte.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => void signOut() },
    ])

  const solo = household ? isSolo(household.members) : true
  const enabledDays = household?.special_day_rules.filter((r) => r.enabled).length ?? 0

  return (
    <Screen>
      <Title>Réglages</Title>

      {me ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings/profile')} style={[s.group, s.row, { borderBottomWidth: 0 }]}>
          <Avatar name={me.display_name} color={me.color} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>{me.display_name}</Text>
            <Text style={s.muted}>{me.email}</Text>
          </View>
          <Icon name="chevron" size={18} color={colors.inkSoft} />
        </Pressable>
      ) : null}

      {household && !solo ? <ChangeRequests household={household} meId={me?.id} /> : null}

      {household ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>Foyer</SectionLabel>
          <View style={s.group}>
            {household.members.map((m) => (
              <View key={m.id} style={s.row}>
                <Avatar name={m.display_name} color={m.color} size={32} />
                <Text style={[s.strong, { flex: 1 }]}>{m.id === me?.id ? `${m.display_name} (vous)` : m.display_name}</Text>
                {m.is_placeholder ? <Text style={s.muted}>pas encore inscrit·e</Text> : null}
              </View>
            ))}
            <NavRow
              label="Enfants, zone, autre parent"
              value={household.children.map((c) => c.first_name).join(', ') || '—'}
              href="/settings/household"
            />
            <NavRow
              label="Garde et vacances"
              value={household.custody_rule ? PATTERN_LABEL[household.custody_rule.pattern] : '—'}
              href="/settings/rules"
            />
            <NavRow label="Jours de fête" value={enabledDays ? `${enabledDays} actif${enabledDays > 1 ? 's' : ''}` : 'Aucun'} href="/settings/special-days" />
          </View>
        </View>
      ) : null}

      {household && solo ? (
        <InviteCard householdId={household.id} childNames={household.children.map((c) => c.first_name)} />
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionLabel>Application</SectionLabel>
        <View style={s.group}>
          <NavRow label="Alternly Premium" value={billing ? (billing.access ? 'Actif' : 'Découvrir') : undefined} href="/premium" />
          <NavRow label="Notifications" icon="bell" href="/notification-settings" />
          <NavRow label="Compte et mot de passe" icon="settings" href="/settings/account" />
          <NavRow label="Synchroniser mon agenda" icon="calendar" href="/settings/calendar-sync" />
          <NavRow label="Historique du foyer" href="/settings/history" />
        </View>
      </View>

      <View style={s.group}>
        <Pressable accessibilityRole="button" onPress={confirmSignOut} style={[s.row, { borderBottomWidth: 0 }]}>
          <Icon name="logout" color={colors.danger} />
          <Text style={[s.strong, { color: colors.danger }]}>Se déconnecter</Text>
        </Pressable>
      </View>

      <Text style={[s.muted, { textAlign: 'center' }]}>Alternly {Constants.expoConfig?.version ?? ''}</Text>
    </Screen>
  )
}

function NavRow({ label, value, icon, href }: { label: string; value?: string; icon?: 'bell' | 'settings' | 'calendar'; href: Href }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.paperDeep }]}>
      {icon ? <Icon name={icon} color={colors.ink} /> : null}
      <Text style={[s.strong, { flex: 1 }]}>{label}</Text>
      {value ? <Text style={[s.muted, { maxWidth: 150 }]} numberOfLines={1}>{value}</Text> : null}
      <Icon name="chevron" size={18} color={colors.inkSoft} />
    </Pressable>
  )
}

const s = StyleSheet.create({
  group: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  strong: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
})
