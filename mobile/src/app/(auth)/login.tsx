import { useMutation } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { useRef, useState } from 'react'
import { Text, View, type TextInput } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { SocialSignIn } from '@/components/SocialSignIn'
import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { colors, fonts } from '@/lib/theme'

export default function Login() {
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
        <Title>Bon retour</Title>
        <Body muted>Le même compte que sur alternly.com : votre foyer et vos échanges sont déjà là.</Body>
      </View>

      <SocialSignIn mode="login" />

      <ErrorBanner message={login.error?.message} />

      <Field
        label="E-mail"
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
        label="Mot de passe"
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
          {showPassword ? 'Masquer' : 'Afficher'} le mot de passe
        </Text>
        <Link href="/forgot-password" style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine, paddingVertical: 8 }}>
          Mot de passe oublié ?
        </Link>
      </View>

      <Button title="Se connecter" onPress={() => login.mutate()} loading={login.isPending} disabled={!canSubmit} />

      <Body muted style={{ textAlign: 'center' }}>
        Pas encore de compte ?{' '}
        <Link href="/register" style={{ fontFamily: fonts.bodySemiBold, color: colors.pine }}>
          Créer un compte
        </Link>
      </Body>
    </Screen>
  )
}
