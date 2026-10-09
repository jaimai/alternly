import { Fraunces_500Medium } from '@expo-google-fonts/fraunces'
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/api'
import { AuthProvider, useAuth } from '@/lib/auth'
import { colors } from '@/lib/theme'

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

export default function RootLayout() {
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
