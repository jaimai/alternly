import { router } from 'expo-router'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BackButton } from '@/components/BackButton'
import { Icon, type IconName } from '@/components/Icon'
import { ErrorState, Loading } from '@/components/ui'
import { formatAgo } from '@/lib/dates'
import { notificationArea, notificationMessage, type NotificationArea } from '@/lib/notifications'
import { useMarkRead, useNotifications } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { Notification } from '@/lib/types'

const AREA: Record<NotificationArea, { icon: IconName; bg: string; fg: string; href: '/calendar' | '/expenses' | '/wall' | '/settings' }> = {
  calendar: { icon: 'swap', bg: colors.terraSoft, fg: colors.terraText, href: '/calendar' },
  expenses: { icon: 'wallet', bg: colors.pineSoft, fg: colors.pine, href: '/expenses' },
  wall: { icon: 'wall', bg: '#e6ecf5', fg: '#3d5f8f', href: '/wall' },
  settings: { icon: 'settings', bg: colors.paperDeep, fg: colors.inkSoft, href: '/settings' },
}

export default function Notifications() {
  const notifications = useNotifications()
  const markRead = useMarkRead()
  const unreadIds = notifications.data?.filter((n) => n.read_at === null).map((n) => n.id) ?? []

  const open = (n: Notification) => {
    if (n.read_at === null) markRead.mutate([n.id])
    router.navigate(AREA[notificationArea(n.type)].href)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <View style={s.header}>
        <BackButton />
        <Text accessibilityRole="header" style={s.title}>
          Notifications
        </Text>
      </View>
      {unreadIds.length > 0 ? (
        <View style={s.toolbar}>
          <Text style={s.count}>{unreadIds.length} non lue{unreadIds.length > 1 ? 's' : ''}</Text>
          <Text accessibilityRole="button" onPress={() => markRead.mutate(unreadIds)} style={s.markAll}>
            Tout marquer comme lu
          </Text>
        </View>
      ) : null}

      {notifications.isPending ? (
        <Loading />
      ) : notifications.isError ? (
        <ErrorState message={notifications.error.message} onRetry={() => notifications.refetch()} />
      ) : (
        <FlatList
          data={notifications.data}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={{ padding: 12, gap: 4 }}
          refreshControl={
            <RefreshControl refreshing={notifications.isRefetching} onRefresh={() => notifications.refetch()} tintColor={colors.pine} />
          }
          ListEmptyComponent={<Text style={s.empty}>Aucune notification pour l’instant.</Text>}
          renderItem={({ item }) => {
            const area = AREA[notificationArea(item.type)]
            const unread = item.read_at === null
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${unread ? 'Non lue. ' : ''}${notificationMessage(item)}`}
                onPress={() => open(item)}
                style={({ pressed }) => [s.item, unread && s.itemUnread, pressed && { opacity: 0.8 }]}
              >
                <View style={[s.icon, { backgroundColor: area.bg }]}>
                  <Icon name={area.icon} size={20} color={area.fg} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.message}>{notificationMessage(item)}</Text>
                  <Text style={s.time}>{formatAgo(item.created_at)}</Text>
                </View>
                {unread ? <View style={s.dot} /> : null}
              </Pressable>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  count: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  markAll: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine, paddingVertical: 10 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 16 },
  itemUnread: { backgroundColor: colors.surface },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  message: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger, marginTop: 6 },
  empty: { textAlign: 'center', fontFamily: fonts.body, color: colors.inkSoft, padding: 32 },
})
