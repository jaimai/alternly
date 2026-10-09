// Un post du tableau, ses réponses, et la réponse de l'autre parent.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Paywall } from '@/components/Paywall'
import { WallPostCard } from '@/components/WallPostCard'
import { Body, Button, ErrorBanner, ErrorState, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { formatAgo } from '@/lib/dates'
import { useHousehold, useMe, useWall, useWallAction } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'

export default function WallPostScreen() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const { wall, locked } = useWall(household?.id)
  const [reply, setReply] = useState('')

  const hid = household?.id ?? 0
  const pid = Number(id)
  const send = useWallAction(() => api.replyToPost(hid, pid, reply.trim()), () => setReply(''))
  const removePost = useWallAction(() => api.deletePost(hid, pid), () => router.back())
  const removeReply = useWallAction((rid: number) => api.deleteReply(hid, rid))
  const error = [send, removePost, removeReply].find((m) => m.error)?.error?.message

  if (!household || wall.isPending) return <Loading />
  if (wall.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        {locked ? (
          <Paywall title={t('wall.tab.paywallTitle')} />
        ) : (
          <ErrorState message={wall.error.message} onRetry={() => wall.refetch()} />
        )}
      </Screen>
    )
  }
  const post = wall.data.find((p) => p.id === pid)
  // Ouvert depuis une notification : le post peut être plus récent que la liste en cache.
  if (!post && wall.isFetching) return <Loading />
  if (!post) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Title>{t('wall.detail.notFoundTitle')}</Title>
        <Body muted>{t('wall.detail.notFoundBody')}</Body>
      </Screen>
    )
  }
  const name = (uid: number) => household.members.find((m) => m.id === uid)?.display_name ?? '?'

  function confirmDeletePost() {
    Alert.alert(t('wall.detail.deletePostTitle'), t('wall.detail.deletePostBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => removePost.mutate() },
    ])
  }

  function confirmDeleteReply(rid: number) {
    Alert.alert(t('wall.detail.deleteReplyTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => removeReply.mutate(rid) },
    ])
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <ErrorBanner message={error} />
        <WallPostCard post={post} household={household} detail />

        {post.replies.length > 0 ? <SectionLabel>{t('wall.detail.replies')}</SectionLabel> : null}
        {post.replies.map((r) => {
          const mine = r.author_id === meId
          return (
            <Pressable
              key={r.id}
              accessibilityHint={mine ? t('wall.detail.longPressHint') : undefined}
              onLongPress={mine ? () => confirmDeleteReply(r.id) : undefined}
              style={[s.reply, mine && s.replyMine]}
            >
              <Text style={s.replyAuthor}>{`${mine ? t('common.youTitle') : name(r.author_id)} · ${formatAgo(r.created_at)}`}</Text>
              <Text style={s.replyBody}>{r.body}</Text>
            </Pressable>
          )
        })}

        <View style={{ gap: 8 }}>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={t('wall.detail.replyPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={2000}
            accessibilityLabel={t('wall.detail.replyLabel')}
            style={s.input}
          />
          <Button title={t('common.send')} onPress={() => send.mutate()} loading={send.isPending} disabled={!reply.trim()} />
        </View>

        {post.author_id === meId ? (
          <Button title={t('wall.detail.deletePost')} variant="danger" onPress={confirmDeletePost} loading={removePost.isPending} />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  reply: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 4, marginRight: 32 },
  replyMine: { backgroundColor: colors.pineSoft, borderColor: colors.pineSoft, marginRight: 0, marginLeft: 32 },
  replyAuthor: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSoft },
  replyBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  input: {
    minHeight: 72, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12,
    fontFamily: fonts.body, fontSize: 15, color: colors.ink, backgroundColor: colors.surface, textAlignVertical: 'top',
  },
})
