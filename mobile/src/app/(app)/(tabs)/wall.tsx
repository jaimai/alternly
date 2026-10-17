// Tableau entre parents : infos, tâches et questions. Mêmes règles que frontend/src/pages/Wall.tsx ;
// fonction Premium (402 sinon).
import { router } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Chips } from '@/components/form'
import { Icon } from '@/components/Icon'
import { Paywall } from '@/components/Paywall'
import { WallPostCard } from '@/components/WallPostCard'
import { Body, ErrorState, Loading } from '@/components/ui'
import { useHousehold, useWall } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { Household, WallPost } from '@/lib/types'
import { filterWall, openCounts, type WallSegment } from '@/lib/wall'

export default function Wall() {
  const { t } = useTranslation()
  const household = useHousehold().data ?? undefined
  const { wall, locked } = useWall(household?.id)

  let body
  if (locked) {
    body = (
      <ScrollView contentContainerStyle={s.content}>
        <Paywall
          title={t('wall.tab.paywallTitle')}
          intro={t('wall.tab.paywallIntro')}
        />
      </ScrollView>
    )
  }
  else if (wall.isError) body = <ErrorState message={wall.error.message} onRetry={() => wall.refetch()} />
  else if (!household || !wall.data) body = <Loading />
  else {
    body = (
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={wall.isRefetching} onRefresh={() => wall.refetch()} tintColor={colors.pine} />}
      >
        <Content household={household} posts={wall.data} />
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>{t('wall.tab.title')}</Text>
        {!locked && household ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('wall.tab.newPost')} onPress={() => router.push('/wall/new')} style={s.add}>
            <Icon name="plus" color="#fff" strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
      {body}
    </SafeAreaView>
  )
}

function Content({ household, posts }: { household: Household; posts: WallPost[] }) {
  const { t } = useTranslation()
  const [segment, setSegment] = useState<WallSegment>('todo')
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)
  const childName = (id: number | null) => household.children.find((c) => c.id === id)?.first_name ?? null
  const counts = openCounts(posts)
  const { open, done } = filterWall(posts, segment, query, childName)
  const withCount = (label: string, n: number) => (n > 0 ? `${label} · ${n}` : label)

  return (
    <>
      <Chips
        options={[
          { value: 'todo' as const, label: withCount(t('wall.tab.segments.todo'), counts.todo) },
          { value: 'questions' as const, label: withCount(t('wall.tab.segments.questions'), counts.questions) },
          { value: 'infos' as const, label: t('wall.tab.segments.infos') },
          { value: 'all' as const, label: t('wall.tab.segments.all') },
        ]}
        value={segment}
        onChange={(v) => {
          setSegment(v)
          setShowDone(false)
        }}
      />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('wall.tab.searchPlaceholder')}
        placeholderTextColor={colors.inkSoft}
        accessibilityLabel={t('wall.tab.searchLabel')}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={s.search}
      />

      {open.length === 0 && done.length === 0 ? (
        <Body muted>{query.trim() ? t('wall.tab.noResults') : t(`wall.tab.empty.${segment}`)}</Body>
      ) : null}
      {open.map((p) => <WallPostCard key={p.id} post={p} household={household} />)}

      {done.length > 0 ? (
        <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDone }} onPress={() => setShowDone((v) => !v)} style={s.doneToggle}>
            <Text style={s.doneText}>
              {`${showDone ? '▾' : '▸'} ${t(segment === 'todo' ? 'wall.tab.doneCount' : 'wall.tab.resolvedCount', { count: done.length })}`}
            </Text>
          </Pressable>
          {showDone ? done.map((p) => <WallPostCard key={p.id} post={p} household={household} />) : null}
        </>
      ) : null}
    </>
  )
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  add: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pine, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 4, gap: 12 },
  search: {
    minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    paddingHorizontal: 16, fontFamily: fonts.body, fontSize: 15, color: colors.ink,
  },
  doneToggle: { paddingVertical: 8 },
  doneText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.inkSoft },
})
