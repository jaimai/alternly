import { Redirect, Stack } from 'expo-router'
import { PushManager } from '@/components/PushManager'
import { ErrorState, Loading } from '@/components/ui'
import { usePendingInvite } from '@/lib/pendingInvite'
import { useHousehold } from '@/lib/queries'
import { colors } from '@/lib/theme'

export default function AppLayout() {
  const household = useHousehold()
  const pendingInvite = usePendingInvite()

  if (household.isPending || !pendingInvite.loaded) return <Loading />
  // Compte créé (ou connecté) depuis un lien d'invitation : rejoindre ce foyer avant tout,
  // sinon l'onboarding créerait un second foyer.
  if (pendingInvite.token) return <Redirect href={{ pathname: '/join/[token]', params: { token: pendingInvite.token } }} />
  if (household.isError) {
    return <ErrorState message={household.error.message} onRetry={() => household.refetch()} />
  }
  // Pas de foyer, ou foyer sans règle de garde : configuration d'abord (comme le web).
  const ready = household.data !== null && household.data.custody_rule !== null

  return (
    <>
      <PushManager />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
        <Stack.Protected guard={!ready}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={ready}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="notification-settings" />
          <Stack.Screen name="exchange/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="exchange/[id]" />
        </Stack.Protected>
      </Stack>
    </>
  )
}
