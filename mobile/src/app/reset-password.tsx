// Lien « choisir un nouveau mot de passe » (alternly.com/reset-password?token=…) ouvert dans l'app.
import { useMutation } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const MIN_PASSWORD = 8

export default function ResetPassword() {
  const { t } = useTranslation()
  const { token = '' } = useLocalSearchParams<{ token?: string }>()
  const { signIn } = useAuth()
  const [password, setPassword] = useState('')

  const reset = useMutation({
    mutationFn: () => api.resetPassword(token, password),
    onSuccess: async (resp) => {
      await signIn(resp)
      router.replace('/')
    },
  })

  const passwordError = password.length > 0 && password.length < MIN_PASSWORD ? t('auth.minChars', { min: MIN_PASSWORD }) : null
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'))

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton onPress={back} />
      <View style={{ gap: 6 }}>
        <Title>{t('auth.reset.title')}</Title>
        <Body muted>{t('auth.reset.subtitle')}</Body>
      </View>

      {token ? (
        <>
          <ErrorBanner message={reset.error?.message} />
          <Field
            label={t('auth.reset.password', { min: MIN_PASSWORD })}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={passwordError}
            returnKeyType="go"
            onSubmitEditing={() => password.length >= MIN_PASSWORD && reset.mutate()}
          />
          <Button
            title={t('common.save')}
            onPress={() => reset.mutate()}
            loading={reset.isPending}
            disabled={password.length < MIN_PASSWORD}
          />
        </>
      ) : (
        <ErrorBanner message={t('auth.reset.incompleteLink')} />
      )}
    </Screen>
  )
}
