// Réglages › Notifications : état de la permission du téléphone et catégories de push.
import { useEffect, useState } from 'react'
import { Linking, StyleSheet, Switch, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Body, Button, ErrorBanner, ErrorState, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { enablePush, pushStatus, type PushStatus } from '@/lib/push'
import { usePushPrefs, useSetPushPrefs } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { PushPrefs } from '@/lib/types'

const CATEGORIES: { key: keyof PushPrefs; title: string; desc: string }[] = [
  { key: 'handover', title: 'Rappel de passation', desc: 'La veille de chaque changement de parent' },
  { key: 'exchanges', title: 'Échanges et demandes', desc: 'Proposés, acceptés, refusés, retirés' },
  { key: 'expenses', title: 'Dépenses', desc: 'Ajoutées, contestées, remboursées' },
  { key: 'wall', title: 'Tableau', desc: 'Messages, réponses, tâches assignées' },
  { key: 'household', title: 'Foyer', desc: 'Règles modifiées, parent qui rejoint ou quitte' },
]

export default function NotificationSettings() {
  const prefs = usePushPrefs()
  const save = useSetPushPrefs()
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void pushStatus().then(setStatus)
  }, [])

  const enable = async () => {
    setBusy(true)
    try {
      setStatus(await enablePush())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>Notifications</Title>

      <View style={s.status}>
        {status === 'granted' ? (
          <Body>Activées sur ce téléphone.</Body>
        ) : status === 'denied' ? (
          <>
            <Body>Les notifications sont désactivées dans les réglages du téléphone.</Body>
            <Button title="Ouvrir les réglages du téléphone" variant="secondary" onPress={() => void Linking.openSettings()} />
          </>
        ) : status === 'undetermined' ? (
          <>
            <Body>Recevez un rappel la veille des passations et les demandes de l’autre parent.</Body>
            <Button title="Activer les notifications" onPress={enable} loading={busy} />
          </>
        ) : status === 'unavailable' ? (
          <Body muted>Les notifications push ne sont disponibles que dans l’app installée sur un téléphone.</Body>
        ) : null}
      </View>

      <SectionLabel>Recevoir une notification pour</SectionLabel>
      {prefs.isPending ? (
        <Loading />
      ) : prefs.isError ? (
        <ErrorState message={prefs.error.message} onRetry={() => prefs.refetch()} />
      ) : (
        <View style={s.group}>
          {CATEGORIES.map((c) => (
            <View key={c.key} style={s.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.title}>{c.title}</Text>
                <Text style={s.desc}>{c.desc}</Text>
              </View>
              <Switch
                accessibilityLabel={c.title}
                value={prefs.data[c.key]}
                onValueChange={(v) => save.mutate({ ...prefs.data, [c.key]: v })}
                trackColor={{ true: colors.pine, false: '#d6ccbb' }}
                thumbColor="#ffffff"
              />
            </View>
          ))}
        </View>
      )}
      <ErrorBanner message={save.error?.message} />
      <Body muted style={{ fontSize: 13 }}>
        Ces choix valent pour tous vos téléphones. Tout reste visible dans le centre de notifications de l’app.
      </Body>
    </Screen>
  )
}

const s = StyleSheet.create({
  status: { gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16 },
  group: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  desc: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
})
