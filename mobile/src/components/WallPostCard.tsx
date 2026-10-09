// Carte d'un post du tableau : type, échéance, enfant, auteur ; case à cocher pour les
// tâches et questions. Toucher la carte ouvre le post et ses réponses.
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '@/lib/api'
import { formatShort, isoLocal, parseTimestamp, todayIso } from '@/lib/dates'
import { useWallAction } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { Household, WallKind, WallPost } from '@/lib/types'
import { KIND_LABEL, isOverdue } from '@/lib/wall'
import { Icon } from './Icon'
import { Tag } from './Tag'

export const KIND_TAG: Record<WallKind, { bg: string; fg: string }> = {
  message: { bg: colors.paperDeep, fg: colors.inkSoft },
  task: { bg: colors.pineSoft, fg: colors.pine },
  question: { bg: colors.terraSoft, fg: colors.terraText },
}

export function WallPostCard({ post: p, household, detail = false }: { post: WallPost; household: Household; detail?: boolean }) {
  const name = (id: number | null) => household.members.find((m) => m.id === id)?.display_name ?? '?'
  const child = household.children.find((c) => c.id === p.child_id)?.first_name
  const done = p.completed_at !== null
  const actionable = p.kind === 'task' || p.kind === 'question'
  const toggle = useWallAction(() => (done ? api.reopenPost(household.id, p.id) : api.completePost(household.id, p.id)))

  const meta = [
    child,
    p.due_date ? `pour le ${formatShort(p.due_date)}` : null,
    p.assigned_to ? `pour ${name(p.assigned_to)}` : null,
  ].filter(Boolean).join(' · ')

  const checkLabel = done ? 'Rouvrir' : p.kind === 'task' ? 'Marquer fait' : 'Marquer résolu'

  return (
    <Pressable
      accessibilityRole={detail ? undefined : 'button'}
      disabled={detail}
      onPress={() => router.push({ pathname: '/wall/[id]', params: { id: String(p.id) } })}
      style={({ pressed }) => [s.card, done && { opacity: 0.65 }, pressed && !detail && { backgroundColor: colors.paperDeep }]}
    >
      <View style={s.head}>
        {actionable ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={checkLabel}
            accessibilityState={{ checked: done, busy: toggle.isPending }}
            hitSlop={8}
            onPress={() => !toggle.isPending && toggle.mutate()}
            style={[s.check, done && s.checkOn]}
          >
            {done ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
          </Pressable>
        ) : null}
        <Tag label={KIND_LABEL[p.kind]} {...KIND_TAG[p.kind]} />
        {isOverdue(p, todayIso()) ? <Tag label="En retard" bg={colors.dangerSoft} fg={colors.danger} /> : null}
        <Text style={s.author} numberOfLines={1}>
          {`${name(p.author_id)} · ${formatShort(isoLocal(parseTimestamp(p.created_at)))}`}
        </Text>
      </View>
      <Text style={[s.body, done && { textDecorationLine: p.kind === 'task' ? 'line-through' : 'none' }]} numberOfLines={detail ? undefined : 4}>
        {p.body}
      </Text>
      {meta ? <Text style={s.meta}>{meta}</Text> : null}
      {!detail && p.replies.length > 0 ? (
        <Text style={s.meta}>{`${p.replies.length} réponse${p.replies.length > 1 ? 's' : ''}`}</Text>
      ) : null}
    </Pressable>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  check: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#c9bfae',
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  checkOn: { backgroundColor: colors.pine, borderColor: colors.pine },
  author: { flex: 1, textAlign: 'right', fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.ink },
  meta: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
})
