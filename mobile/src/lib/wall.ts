// Tableau entre parents : filtres et tri (mêmes règles que frontend/src/pages/Wall.tsx).
import type { WallKind, WallPost } from './types'

export type WallSegment = 'todo' | 'questions' | 'infos' | 'all'

export const KIND_LABEL: Record<WallKind, string> = { message: 'Info', task: 'Tâche', question: 'Question' }

const SEGMENT_KIND: Record<Exclude<WallSegment, 'all'>, WallKind> = { todo: 'task', questions: 'question', infos: 'message' }

/** Tâches et questions encore ouvertes (pastilles des segments). */
export function openCounts(posts: WallPost[]): { todo: number; questions: number } {
  const open = (k: WallKind) => posts.filter((p) => p.kind === k && !p.completed_at).length
  return { todo: open('task'), questions: open('question') }
}

/**
 * Posts du segment correspondant à la recherche (texte ou prénom de l'enfant).
 * À faire / Questions : ouverts d'abord (tâches par échéance, datées en premier), puis `done`.
 * Infos / Tout : tout dans `open`, du plus récent au plus ancien.
 */
export function filterWall(
  posts: WallPost[],
  segment: WallSegment,
  query: string,
  childName: (id: number | null) => string | null,
): { open: WallPost[]; done: WallPost[] } {
  const q = query.trim().toLowerCase()
  const pool = posts
    .filter((p) => segment === 'all' || p.kind === SEGMENT_KIND[segment])
    .filter((p) => !q || p.body.toLowerCase().includes(q) || (childName(p.child_id)?.toLowerCase() ?? '').includes(q))
  const recent = (a: WallPost, b: WallPost) => b.created_at.localeCompare(a.created_at)
  if (segment !== 'todo' && segment !== 'questions') return { open: [...pool].sort(recent), done: [] }
  const byDue = (a: WallPost, b: WallPost) => {
    if (segment === 'todo') {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
    }
    return recent(a, b)
  }
  return {
    open: pool.filter((p) => !p.completed_at).sort(byDue),
    done: pool.filter((p) => p.completed_at).sort(recent),
  }
}

export function isOverdue(p: WallPost, today: string): boolean {
  return p.kind === 'task' && !p.completed_at && p.due_date !== null && p.due_date < today
}
