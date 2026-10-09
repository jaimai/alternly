// Un post du tableau, ses réponses, et la réponse de l'autre parent.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { WallPostCard } from '@/components/WallPostCard'
import { Body, Button, ErrorBanner, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { formatAgo } from '@/lib/dates'
import { useHousehold, useMe, useWall, useWallAction } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'

export default function WallPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const { wall } = useWall(household?.id)
  const [reply, setReply] = useState('')

  const hid = household?.id ?? 0
  const pid = Number(id)
  const send = useWallAction(() => api.replyToPost(hid, pid, reply.trim()), () => setReply(''))
  const removePost = useWallAction(() => api.deletePost(hid, pid), () => router.back())
  const removeReply = useWallAction((rid: number) => api.deleteReply(hid, rid))
  const error = [send, removePost, removeReply].find((m) => m.error)?.error?.message

  if (!household || wall.isPending) return <Loading />
  const post = wall.data?.find((p) => p.id === pid)
  if (!post) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Title>Post introuvable</Title>
        <Body muted>Il a peut-être été supprimé par son auteur.</Body>
      </Screen>
    )
  }
  const name = (uid: number) => household.members.find((m) => m.id === uid)?.display_name ?? '?'

  function confirmDeletePost() {
    Alert.alert('Supprimer ce post ?', 'Il disparaîtra du tableau pour les deux parents, avec ses réponses.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => removePost.mutate() },
    ])
  }

  function confirmDeleteReply(rid: number) {
    Alert.alert('Supprimer cette réponse ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => removeReply.mutate(rid) },
    ])
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <ErrorBanner message={error} />
        <WallPostCard post={post} household={household} detail />

        {post.replies.length > 0 ? <SectionLabel>Réponses</SectionLabel> : null}
        {post.replies.map((r) => {
          const mine = r.author_id === meId
          return (
            <Pressable
              key={r.id}
              accessibilityHint={mine ? 'Appui long pour supprimer' : undefined}
              onLongPress={mine ? () => confirmDeleteReply(r.id) : undefined}
              style={[s.reply, mine && s.replyMine]}
            >
              <Text style={s.replyAuthor}>{`${mine ? 'Vous' : name(r.author_id)} · ${formatAgo(r.created_at)}`}</Text>
              <Text style={s.replyBody}>{r.body}</Text>
            </Pressable>
          )
        })}

        <View style={{ gap: 8 }}>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder="Répondre…"
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={2000}
            accessibilityLabel="Votre réponse"
            style={s.input}
          />
          <Button title="Envoyer" onPress={() => send.mutate()} loading={send.isPending} disabled={!reply.trim()} />
        </View>

        {post.author_id === meId ? (
          <Button title="Supprimer le post" variant="danger" onPress={confirmDeletePost} loading={removePost.isPending} />
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
