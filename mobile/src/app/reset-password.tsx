// Lien « choisir un nouveau mot de passe » (alternly.com/reset-password?token=…) ouvert dans l'app.
import { useMutation } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const MIN_PASSWORD = 8

export default function ResetPassword() {
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

  const passwordError = password.length > 0 && password.length < MIN_PASSWORD ? `${MIN_PASSWORD} caractères minimum` : null
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'))

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton onPress={back} />
      <View style={{ gap: 6 }}>
        <Title>Nouveau mot de passe</Title>
        <Body muted>Il remplace l’ancien sur l’app et sur le web. Vos autres appareils seront déconnectés.</Body>
      </View>

      {token ? (
        <>
          <ErrorBanner message={reset.error?.message} />
          <Field
            label={`Nouveau mot de passe (${MIN_PASSWORD} caractères min.)`}
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
            title="Enregistrer"
            onPress={() => reset.mutate()}
            loading={reset.isPending}
            disabled={password.length < MIN_PASSWORD}
          />
        </>
      ) : (
        <ErrorBanner message="Lien incomplet. Rouvrez le lien reçu par e-mail, ou demandez-en un nouveau." />
      )}
    </Screen>
  )
}
