import { useMutation } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View, type TextInput } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { SocialSignIn } from '@/components/SocialSignIn'
import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { googleAvailable } from '@/lib/socialAuth'
import { colors, fonts } from '@/lib/theme'

export default function Login() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const passwordRef = useRef<TextInput>(null)

  const login = useMutation({
    mutationFn: () => api.login(email.trim(), password),
    onSuccess: signIn,
  })

  const canSubmit = email.trim().length > 3 && password.length > 0

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>{t('auth.login.title')}</Title>
        <Body muted>{t('auth.login.subtitle')}</Body>
      </View>

      <SocialSignIn mode="login" />

      <ErrorBanner message={login.error?.message} />

      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <Field
        ref={passwordRef}
        label={t('auth.login.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPassword}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => canSubmit && login.mutate()}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text
          accessibilityRole="button"
          onPress={() => setShowPassword((v) => !v)}
          style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine, paddingVertical: 8 }}
        >
          {showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
        </Text>
        <Link href="/forgot-password" style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine, paddingVertical: 8 }}>
          {t('auth.login.forgot')}
        </Link>
      </View>

      <Button title={t('auth.login.submit')} onPress={() => login.mutate()} loading={login.isPending} disabled={!canSubmit} />

      {googleAvailable() ? null : (
        <Body muted style={{ textAlign: 'center', fontSize: 14 }}>
          {t('auth.login.googleHint')}
        </Body>
      )}
      <Body muted style={{ textAlign: 'center' }}>
        {t('auth.login.noAccount')}{' '}
        <Link href="/register" style={{ fontFamily: fonts.bodySemiBold, color: colors.pine }}>
          {t('auth.createAccount')}
        </Link>
      </Body>
    </Screen>
  )
}
