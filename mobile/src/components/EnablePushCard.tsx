// Invitation à activer les push, avant la demande système (qu'on ne peut poser qu'une fois).
// Affichée sur l'accueil tant que la permission n'a été ni accordée, ni refusée, ni écartée.
import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'
import { enablePush, pushStatus } from '@/lib/push'
import { colors, fonts } from '@/lib/theme'
import { Icon } from './Icon'
import { Button, Card } from './ui'

const DISMISSED_KEY = 'alternly_push_card_dismissed'

export function EnablePushCard() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [status, dismissed] = await Promise.all([pushStatus(), SecureStore.getItemAsync(DISMISSED_KEY).catch(() => null)])
      if (!cancelled) setVisible(status === 'undetermined' && dismissed !== '1')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!visible) return null

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      const status = await enablePush()
      if (status !== 'undetermined') setVisible(false)
    } catch {
      setError(t('notifications.pushCard.error'))
    } finally {
      setBusy(false)
    }
  }

  const dismiss = () => {
    setVisible(false)
    void SecureStore.setItemAsync(DISMISSED_KEY, '1').catch(() => {})
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pineSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={20} color={colors.pine} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>{t('notifications.pushCard.title')}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
            {t('notifications.pushCard.body')}
          </Text>
        </View>
      </View>
      {error ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.danger }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t('notifications.pushCard.enable')} onPress={enable} loading={busy} style={{ flex: 1 }} />
        <Button title={t('common.later')} variant="ghost" onPress={dismiss} />
      </View>
    </Card>
  )
}
