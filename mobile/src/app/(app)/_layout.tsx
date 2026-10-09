import { Stack } from 'expo-router'
import { ErrorState, Loading } from '@/components/ui'
import { useHousehold } from '@/lib/queries'
import { colors } from '@/lib/theme'

export default function AppLayout() {
  const household = useHousehold()

  if (household.isPending) return <Loading />
  if (household.isError) {
    return <ErrorState message={household.error.message} onRetry={() => household.refetch()} />
  }
  // Pas de foyer, ou foyer sans règle de garde : configuration d'abord (comme le web).
  const ready = household.data !== null && household.data.custody_rule !== null

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Protected guard={!ready}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="exchange/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="exchange/[id]" />
      </Stack.Protected>
    </Stack>
  )
}
