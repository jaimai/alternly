import { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '@/components/Icon'
import { colors, fonts } from '@/lib/theme'

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Accueil', icon: 'home' },
  { name: 'calendar', title: 'Calendrier', icon: 'calendar' },
  { name: 'wall', title: 'Tableau', icon: 'wall' },
  { name: 'expenses', title: 'Dépenses', icon: 'wallet' },
  { name: 'settings', title: 'Réglages', icon: 'settings' },
]

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.pine,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarLabelStyle: { fontFamily: fonts.bodySemiBold, fontSize: 11, lineHeight: 14 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          // Hauteur explicite : avec la police de la charte, la barre par défaut rognait les libellés.
          height: 64 + insets.bottom,
          paddingTop: 4,
          paddingBottom: insets.bottom + 4,
        },
        sceneStyle: { backgroundColor: colors.paper },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, size }) => <Icon name={t.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  )
}
