import { Tabs } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '@/components/Icon'
import { colors, fonts } from '@/lib/theme'

// Titres traduits au rendu : clés calendar.tabs.*
const TABS: { name: string; titleKey: string; icon: IconName }[] = [
  { name: 'index', titleKey: 'home', icon: 'home' },
  { name: 'calendar', titleKey: 'calendar', icon: 'calendar' },
  { name: 'wall', titleKey: 'board', icon: 'wall' },
  { name: 'expenses', titleKey: 'expenses', icon: 'wallet' },
  { name: 'settings', titleKey: 'settings', icon: 'settings' },
]

export default function TabsLayout() {
  const { t } = useTranslation()
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
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(`calendar.tabs.${tab.titleKey}`),
            tabBarIcon: ({ color, size }) => <Icon name={tab.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  )
}
