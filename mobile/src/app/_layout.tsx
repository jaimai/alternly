import { Fraunces_500Medium } from '@expo-google-fonts/fraunces'
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack, type ErrorBoundaryProps } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { ApiError } from '@/lib/api'
import { AuthProvider, useAuth } from '@/lib/auth'
import { reportError, wrapRoot } from '@/lib/sentry'
import { colors, fonts } from '@/lib/theme'

void SplashScreen.preventAutoHideAsync()

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Pas de nouvel essai sur une erreur « métier » (4xx) : seulement réseau / 5xx.
        retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  })
}

function RootNavigator() {
  const { status } = useAuth()
  const signedIn = status === 'signedIn'
  if (status === 'loading') return null // le splash reste affiché
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Liens profonds : ouverts connecté ou non. */}
      <Stack.Screen name="join/[token]" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="apple-callback" />
    </Stack>
  )
}

function SplashGate({ ready }: { ready: boolean }) {
  const { status } = useAuth()
  useEffect(() => {
    if (ready && status !== 'loading') void SplashScreen.hideAsync()
  }, [ready, status])
  return null
}

/** Écran de secours si un écran plante : l'erreur part à Sentry, l'utilisateur peut réessayer. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => reportError(error), [error])
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={{ fontFamily: fonts.display, fontSize: 24, color: colors.ink, textAlign: 'center' }}>Oups, un souci d’affichage</Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 15, color: colors.inkSoft, textAlign: 'center' }}>
        L’équipe est prévenue. Vos données ne sont pas touchées.
      </Text>
      <Text accessibilityRole="button" onPress={retry} style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.pine, padding: 12 }}>
        Réessayer
      </Text>
    </View>
  )
}

function RootLayout() {
  const [queryClient] = useState(makeQueryClient)
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_500Medium,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  })
  const ready = fontsLoaded || !!fontError // sans polices, l'app reste utilisable (police système)

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <SplashGate ready={ready} />
        {ready ? <RootNavigator /> : null}
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default wrapRoot(RootLayout)
