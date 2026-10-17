// Réglages › Notifications : état de la permission du téléphone et catégories de push.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, StyleSheet, Switch, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Body, Button, ErrorBanner, ErrorState, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { enablePush, pushStatus, type PushStatus } from '@/lib/push'
import { usePushPrefs, useSetPushPrefs } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { PushPrefs } from '@/lib/types'

// Libellés : notifications.settings.categories.<clé>.title / .desc
const CATEGORIES: (keyof PushPrefs)[] = ['handover', 'exchanges', 'expenses', 'wall', 'household']

export default function NotificationSettings() {
  const { t } = useTranslation()
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
      <Title>{t('notifications.settings.title')}</Title>

      <View style={s.status}>
        {status === 'granted' ? (
          <Body>{t('notifications.settings.granted')}</Body>
        ) : status === 'denied' ? (
          <>
            <Body>{t('notifications.settings.denied')}</Body>
            <Button title={t('notifications.settings.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
          </>
        ) : status === 'undetermined' ? (
          <>
            <Body>{t('notifications.settings.undetermined')}</Body>
            <Button title={t('notifications.settings.enable')} onPress={enable} loading={busy} />
          </>
        ) : status === 'unavailable' ? (
          <Body muted>{t('notifications.settings.unavailable')}</Body>
        ) : null}
      </View>

      <SectionLabel>{t('notifications.settings.sectionLabel')}</SectionLabel>
      {prefs.isPending ? (
        <Loading />
      ) : prefs.isError ? (
        <ErrorState message={prefs.error.message} onRetry={() => prefs.refetch()} />
      ) : (
        <View style={s.group}>
          {CATEGORIES.map((key) => (
            <View key={key} style={s.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.title}>{t(`notifications.settings.categories.${key}.title`)}</Text>
                <Text style={s.desc}>{t(`notifications.settings.categories.${key}.desc`)}</Text>
              </View>
              <Switch
                accessibilityLabel={t(`notifications.settings.categories.${key}.title`)}
                value={prefs.data[key]}
                onValueChange={(v) => save.mutate({ ...prefs.data, [key]: v })}
                trackColor={{ true: colors.pine, false: '#d6ccbb' }}
                thumbColor="#ffffff"
              />
            </View>
          ))}
        </View>
      )}
      <ErrorBanner message={save.error?.message} />
      <Body muted style={{ fontSize: 13 }}>
        {t('notifications.settings.footer')}
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
