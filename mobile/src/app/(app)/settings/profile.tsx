// Mon profil : prénom et couleur sur le calendrier (visibles par l'autre parent), et
// langue de l'app (enregistrée sur le compte : elle décide aussi des push et e-mails).
import { router } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Chips } from '@/components/form'
import { Body, Button, ErrorBanner, Field, Loading, Screen, Title } from '@/components/ui'
import { PARENT_COLORS, colorLabel } from '@/lib/colors'
import { appLanguage, setAppLanguage } from '@/lib/i18n'
import { useHousehold, useMe, useUpdateMe } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { Locale } from '@/lib/types'

// Noms des langues, toujours dans leur propre langue.
const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
]

export default function Profile() {
  const me = useMe().data
  const household = useHousehold().data
  if (!me) return <Loading />
  const taken = household?.members.find((m) => m.id !== me.id)?.color
  return <Form initialName={me.display_name} initialColor={me.color} taken={taken} />
}

function Form({ initialName, initialColor, taken }: { initialName: string; initialColor: string; taken?: string }) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const save = useUpdateMe(() => router.back())
  // Langue : enregistrée sur le compte, puis appliquée tout de suite (l'app se redessine).
  const language = useUpdateMe()
  const changed = name.trim() !== initialName || color !== initialColor

  function changeLanguage(locale: Locale) {
    if (locale === appLanguage() || language.isPending) return
    language.mutate({ locale }, { onSuccess: () => void setAppLanguage(locale) })
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{t('settings.profile.title')}</Title>
      <ErrorBanner message={save.error?.message ?? language.error?.message} />

      <Field label={t('settings.profile.firstName')} value={name} onChangeText={setName} maxLength={50} autoComplete="given-name" textContentType="givenName" />

      <View style={{ gap: 8 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>{t('settings.profile.color')}</Text>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
          {PARENT_COLORS.map((c) => {
            const selected = c.value === color
            const isTaken = c.value === taken
            const label = colorLabel(c)
            return (
              <Pressable
                key={c.value}
                accessibilityRole="radio"
                accessibilityLabel={isTaken ? t('settings.profile.colorTaken', { color: label }) : label}
                accessibilityState={{ selected, disabled: isTaken }}
                disabled={isTaken}
                onPress={() => setColor(c.value)}
                style={{
                  width: 44, height: 44, borderRadius: 22, backgroundColor: c.value, opacity: isTaken ? 0.25 : 1,
                  borderWidth: 3, borderColor: selected ? colors.ink : colors.paper,
                }}
              />
            )
          })}
        </View>
        {taken ? <Body muted style={{ fontSize: 13 }}>{t('settings.profile.colorTakenHint')}</Body> : null}
      </View>

      <Button
        title={t('common.save')}
        onPress={() => save.mutate({ display_name: name.trim(), color })}
        loading={save.isPending}
        disabled={!changed || !name.trim()}
      />

      <Chips label={t('settings.profile.language')} options={LANGUAGES} value={appLanguage()} onChange={changeLanguage} />
    </Screen>
  )
}
