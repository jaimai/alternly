// Boutons « Continuer avec Apple » et « Continuer avec Google » des écrans de connexion
// et d'inscription, sur tous les téléphones. Crée le compte s'il n'existe pas, le relie s'il
// existe. Apple : bouton natif sur iPhone, page web d'Apple ailleurs (cf. socialAuth.ts).
import { useMutation } from '@tanstack/react-query'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useAuth } from '@/lib/auth'
import { WEB_URL } from '@/lib/colors'
import { SignInCancelled, appleNative, signInWithApple, signInWithGoogle } from '@/lib/socialAuth'
import { colors, fonts } from '@/lib/theme'
import type { TokenResponse } from '@/lib/types'
import { Body, Button, ErrorBanner } from './ui'

export function SocialSignIn({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [nativeApple, setNativeApple] = useState(false)

  useEffect(() => {
    let cancelled = false
    appleNative().then((ok) => !cancelled && setNativeApple(ok), () => {})
    return () => {
      cancelled = true
    }
  }, [])

  const login = useMutation({
    mutationFn: (provider: 'apple' | 'google') => (provider === 'apple' ? signInWithApple() : signInWithGoogle()),
    onSuccess: (resp: TokenResponse) => signIn(resp),
  })
  const error = login.error instanceof SignInCancelled ? null : login.error?.message

  return (
    <View style={{ gap: 10 }}>
      <ErrorBanner message={error} />
      {nativeApple ? (
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
      ) : (
        // Hors iPhone : même apparence que le bouton officiel (noir, logo blanc).
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: login.isPending, busy: login.isPending && login.variables === 'apple' }}
          onPress={() => !login.isPending && login.mutate('apple')}
          style={({ pressed }) => [s.apple, (pressed || login.isPending) && { opacity: 0.8 }]}
        >
          {login.isPending && login.variables === 'apple' ? <ActivityIndicator color="#fff" /> : <AppleLogo />}
          <Text style={s.appleText}>{t('auth.social.continueApple')}</Text>
        </Pressable>
      )}
      <Button
        title={t('auth.social.continueGoogle')}
        variant="secondary"
        icon={<GoogleLogo />}
        loading={login.isPending && login.variables === 'google'}
        disabled={login.isPending}
        onPress={() => login.mutate('google')}
      />
      {mode === 'register' ? (
        <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
          {t('auth.social.consentPrefix')}{' '}
          <Text style={{ color: colors.pine, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`${WEB_URL}/terms`)}>
            {t('auth.register.terms')}
          </Text>{' '}
          {t('auth.register.and')}{' '}
          <Text style={{ color: colors.pine, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>
            {t('auth.register.privacy')}
          </Text>
          {t('auth.register.consentSuffix')}
        </Body>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>{t('auth.social.orEmail')}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      </View>
    </View>
  )
}

function AppleLogo() {
  return (
    <Svg width={17} height={20} viewBox="0 0 17 20" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        fill="#fff"
        d="M14.2 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.5 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM11.7 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.5-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.4z"
      />
    </Svg>
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

const s = StyleSheet.create({
  apple: {
    minHeight: 52, borderRadius: 26, backgroundColor: '#000', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20,
  },
  appleText: { fontFamily: fonts.bodySemiBold, fontSize: 17, color: '#fff' },
})
