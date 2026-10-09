// Boutons « Se connecter avec Apple » (iPhone) et « Continuer avec Google » des écrans
// de connexion et d'inscription. Crée le compte s'il n'existe pas, le relie s'il existe.
import { useMutation } from '@tanstack/react-query'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useEffect, useState } from 'react'
import { Linking, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useAuth } from '@/lib/auth'
import { WEB_URL } from '@/lib/colors'
import { SignInCancelled, appleAvailable, googleAvailable, signInWithApple, signInWithGoogle } from '@/lib/socialAuth'
import { colors, fonts } from '@/lib/theme'
import type { TokenResponse } from '@/lib/types'
import { Body, Button, ErrorBanner } from './ui'

export function SocialSignIn({ mode }: { mode: 'login' | 'register' }) {
  const { signIn } = useAuth()
  const [apple, setApple] = useState(false)
  const google = googleAvailable()

  useEffect(() => {
    let cancelled = false
    appleAvailable().then((ok) => !cancelled && setApple(ok), () => {})
    return () => {
      cancelled = true
    }
  }, [])

  const login = useMutation({
    mutationFn: (provider: 'apple' | 'google') => (provider === 'apple' ? signInWithApple() : signInWithGoogle()),
    onSuccess: (resp: TokenResponse) => signIn(resp),
  })
  const error = login.error instanceof SignInCancelled ? null : login.error?.message

  if (!apple && !google) return null

  return (
    <View style={{ gap: 10 }}>
      <ErrorBanner message={error} />
      {apple ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={
            mode === 'register'
              ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
              : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
          }
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={26}
          style={{ height: 52, opacity: login.isPending ? 0.55 : 1 }}
          onPress={() => !login.isPending && login.mutate('apple')}
        />
      ) : null}
      {google ? (
        <Button
          title="Continuer avec Google"
          variant="secondary"
          icon={<GoogleLogo />}
          loading={login.isPending && login.variables === 'google'}
          disabled={login.isPending}
          onPress={() => login.mutate('google')}
        />
      ) : null}
      {mode === 'register' ? (
        <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
          En continuant avec Apple ou Google, vous acceptez les{' '}
          <Text style={{ color: colors.pine, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`${WEB_URL}/terms`)}>
            conditions d’utilisation
          </Text>{' '}
          et la{' '}
          <Text style={{ color: colors.pine, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>
            politique de confidentialité
          </Text>
          .
        </Body>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>ou par e-mail</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      </View>
    </View>
  )
}

// Logo « G » officiel (couleurs imposées par la charte Google).
function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  )
}
