import { Stack } from 'expo-router'
import { Linking } from 'react-native'
import { LogoMark } from '@/components/Icon'
import { Body, Button, ErrorState, Loading, Screen, Title } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { WEB_URL } from '@/lib/colors'
import { useHousehold } from '@/lib/queries'
import { colors } from '@/lib/theme'

export default function AppLayout() {
  const household = useHousehold()

  if (household.isPending) return <Loading />
  if (household.isError) {
    return <ErrorState message={household.error.message} onRetry={() => household.refetch()} />
  }
  if (household.data === null) return <NoHousehold onRetry={() => household.refetch()} />

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="exchange/[id]" />
    </Stack>
  )
}

/** Compte sans foyer : la configuration initiale se fait encore sur le web. */
function NoHousehold({ onRetry }: { onRetry: () => void }) {
  const { signOut } = useAuth()
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
      <LogoMark size={64} />
      <Title>Configurons votre calendrier</Title>
      <Body muted>
        La configuration du foyer (enfants, rythme de garde, vacances) arrive bientôt dans l’app. Pour l’instant,
        faites-la sur alternly.com avec ce même compte, puis revenez ici.
      </Body>
      <Button title="Ouvrir alternly.com" onPress={() => Linking.openURL(`${WEB_URL}/onboarding`)} />
      <Button title="C'est fait, actualiser" variant="secondary" onPress={onRetry} />
      <Button title="Se déconnecter" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  )
}
