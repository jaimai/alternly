import { Linking, View } from 'react-native'
import { WEB_URL } from '@/lib/colors'
import { colors } from '@/lib/theme'
import { Icon, type IconName } from './Icon'
import { Body, Button, Screen, Title } from './ui'

/** Onglet dont l'écran natif n'est pas encore livré : renvoie vers la même page du web. */
export function ComingSoon({ icon, title, text, webPath }: { icon: IconName; title: string; text: string; webPath: string }) {
  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.pineSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={30} color={colors.pine} />
      </View>
      <Title>{title}</Title>
      <Body muted>{text}</Body>
      <Body muted>En attendant, retrouvez-le sur alternly.com avec ce même compte.</Body>
      <Button title="Ouvrir sur le web" variant="secondary" onPress={() => Linking.openURL(`${WEB_URL}${webPath}`)} />
    </Screen>
  )
}
