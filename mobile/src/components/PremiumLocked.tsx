import { router } from 'expo-router'
import { Text, View } from 'react-native'
import { iapAvailable } from '@/lib/purchases'
import { colors, fonts } from '@/lib/theme'
import { Icon, type IconName } from './Icon'
import { Body, Button } from './ui'

/**
 * Onglet Premium sans abonnement (402) : renvoie vers l'achat intégré. Jamais vers le
 * paiement web (règles Apple).
 */
export function PremiumLocked({ icon, what }: { icon: IconName; what: string }) {
  return (
    <View style={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 16 }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.pineSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={colors.pine} />
      </View>
      <Text style={{ fontFamily: fonts.display, fontSize: 22, color: colors.ink }}>Une fonction Premium</Text>
      <Body muted>
        {what} : c’est inclus dans Alternly Premium. Si votre foyer est abonné, tout apparaît ici automatiquement, pour les
        deux parents.
      </Body>
      {iapAvailable() ? <Button title="Découvrir Premium" onPress={() => router.push('/premium')} /> : null}
    </View>
  )
}
