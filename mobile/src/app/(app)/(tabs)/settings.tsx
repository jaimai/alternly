import Constants from 'expo-constants'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon } from '@/components/Icon'
import { InviteCard } from '@/components/InviteCard'
import { Avatar, Card, Screen, SectionLabel, Title } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { isSolo } from '@/lib/custody'
import { WEB_URL } from '@/lib/colors'
import { useHousehold, useMe } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'

export default function Settings() {
  const { signOut } = useAuth()
  const me = useMe().data
  const household = useHousehold().data

  const confirmSignOut = () =>
    Alert.alert('Se déconnecter ?', 'Vous pourrez vous reconnecter avec le même compte.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => void signOut() },
    ])

  return (
    <Screen>
      <Title>Réglages</Title>

      {me ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={me.display_name} color={me.color} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>{me.display_name}</Text>
            <Text style={s.muted}>{me.email}</Text>
          </View>
        </Card>
      ) : null}

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
            <View style={s.row}>
              <Text style={[s.strong, { flex: 1 }]}>Enfants</Text>
              <Text style={s.muted}>{household.children.map((c) => c.first_name).join(', ') || '—'}</Text>
            </View>
            {household.country === 'FR' ? (
              <View style={s.row}>
                <Text style={[s.strong, { flex: 1 }]}>Zone scolaire</Text>
                <Text style={s.muted}>Zone {household.school_zone}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {household && isSolo(household.members) ? (
        <InviteCard householdId={household.id} childNames={household.children.map((c) => c.first_name)} />
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionLabel>Sur le web</SectionLabel>
        <View style={s.group}>
          <LinkRow label="Règles de garde et vacances" path="/settings" />
          <LinkRow label="Abonnement" path="/settings" />
          <LinkRow label="Historique des changements" path="/history" />
        </View>
        <Text style={s.muted}>Ces réglages arrivent dans l’app au fil des prochaines versions.</Text>
      </View>

      <View style={s.group}>
        <Pressable accessibilityRole="button" onPress={confirmSignOut} style={s.row}>
          <Icon name="logout" color={colors.danger} />
          <Text style={[s.strong, { color: colors.danger }]}>Se déconnecter</Text>
        </Pressable>
      </View>

      <Text style={[s.muted, { textAlign: 'center' }]}>Alternly {Constants.expoConfig?.version ?? ''}</Text>
    </Screen>
  )
}

function LinkRow({ label, path }: { label: string; path: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${WEB_URL}${path}`)} style={s.row}>
      <Text style={[s.strong, { flex: 1 }]}>{label}</Text>
      <Icon name="chevron" size={18} color={colors.inkSoft} />
    </Pressable>
  )
}

const s = StyleSheet.create({
  group: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  strong: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
})
