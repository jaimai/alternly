import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Icon } from '@/components/Icon'
import { Body, Button, Card, ErrorBanner, Field, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { colors, fonts } from '@/lib/theme'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const forgot = useMutation({ mutationFn: () => api.forgotPassword(email.trim()) })

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>Mot de passe oublié</Title>
        <Body muted>Indiquez votre e-mail : nous vous envoyons un lien valable une heure.</Body>
      </View>

      <ErrorBanner message={forgot.error?.message} />

      {forgot.isSuccess ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft, flexDirection: 'row', gap: 14 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.pine, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mail" size={20} color="#fff" strokeWidth={2} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Body style={{ fontFamily: fonts.bodySemiBold }}>Vérifiez votre boîte mail</Body>
            <Body style={{ fontSize: 14 }}>
              Si un compte existe pour {email.trim()}, vous allez recevoir un lien pour choisir un nouveau mot de passe.
            </Body>
          </View>
        </Card>
      ) : (
        <>
          <Field
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Button
            title="Envoyer le lien"
            onPress={() => forgot.mutate()}
            loading={forgot.isPending}
            disabled={email.trim().length < 4}
          />
        </>
      )}
    </Screen>
  )
}
