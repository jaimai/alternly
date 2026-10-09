import { useMutation } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, Pressable, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Icon } from '@/components/Icon'
import { SocialSignIn } from '@/components/SocialSignIn'
import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { DEFAULT_PARENT_COLOR, PARENT_COLORS, WEB_URL, colorLabel } from '@/lib/colors'
import { colors, fonts } from '@/lib/theme'

const MIN_PASSWORD = 8

export default function Register() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [color, setColor] = useState(DEFAULT_PARENT_COLOR)
  const [consent, setConsent] = useState(false)

  const register = useMutation({
    mutationFn: () => api.register({ display_name: name.trim(), email: email.trim(), password, color }),
    onSuccess: signIn,
  })

  const passwordError = password.length > 0 && password.length < MIN_PASSWORD ? t('auth.minChars', { min: MIN_PASSWORD }) : null
  const canSubmit = name.trim().length > 0 && email.trim().length > 3 && password.length >= MIN_PASSWORD && consent

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>{t('auth.createAccount')}</Title>
        <Body muted>{t('auth.register.subtitle')}</Body>
      </View>

      <SocialSignIn mode="register" />

      <ErrorBanner message={register.error?.message} />

      <Field label={t('auth.register.firstName')} value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" />
      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label={t('auth.register.password', { min: MIN_PASSWORD })}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={passwordError}
      />

      <View style={{ gap: 8 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>{t('auth.register.colorLabel')}</Text>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
          {PARENT_COLORS.map((c) => {
            const selected = c.value === color
            return (
              <Pressable
                key={c.value}
                accessibilityRole="radio"
                accessibilityLabel={colorLabel(c)}
                accessibilityState={{ selected }}
                onPress={() => setColor(c.value)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: c.value,
                  borderWidth: 3,
                  borderColor: selected ? colors.ink : colors.paper,
                }}
              />
            )
          })}
        </View>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        onPress={() => setConsent((v) => !v)}
        style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: consent ? colors.pine : '#c9bfae',
            backgroundColor: consent ? colors.pine : colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {consent ? <Icon name="check" size={16} color="#fff" strokeWidth={3} /> : null}
        </View>
        <Body style={{ flex: 1, fontSize: 14 }}>
          {t('auth.register.consentPrefix')}{' '}
          <Text style={{ color: colors.pine, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`${WEB_URL}/terms`)}>
            {t('auth.register.terms')}
          </Text>{' '}
          {t('auth.register.and')}{' '}
          <Text style={{ color: colors.pine, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>
            {t('auth.register.privacy')}
          </Text>
          {t('auth.register.consentSuffix')}
        </Body>
      </Pressable>

      <Button title={t('auth.register.submit')} onPress={() => register.mutate()} loading={register.isPending} disabled={!canSubmit} />
      <Body muted style={{ textAlign: 'center' }}>
        {t('auth.register.alreadyRegistered')}{' '}
        <Link href="/login" style={{ fontFamily: fonts.bodySemiBold, color: colors.pine }}>
          {t('auth.register.signIn')}
        </Link>
      </Body>
    </Screen>
  )
}
