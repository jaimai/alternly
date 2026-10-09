import { filterWall, isOverdue, openCounts } from '../wall'
import type { WallPost } from '../types'

function post(id: number, kind: WallPost['kind'], extra: Partial<WallPost> = {}): WallPost {
  return {
    id, author_id: 1, kind, body: `Post ${id}`, child_id: null, due_date: null, assigned_to: null,
    completed_at: null, completed_by: null, created_at: `2026-10-0${id}T10:00:00`, edited_at: null, replies: [], ...extra,
  }
}

const posts = [
  post(1, 'task', { due_date: '2026-10-20' }),
  post(2, 'task'),
  post(3, 'task', { due_date: '2026-10-10' }),
  post(4, 'task', { completed_at: '2026-10-05T10:00:00' }),
  post(5, 'question', { body: 'Piscine de Léo ?', child_id: 9 }),
  post(6, 'message'),
]
const childName = (id: number | null) => (id === 9 ? 'Léo' : null)

it('compte les tâches et questions ouvertes', () => {
  expect(openCounts(posts)).toEqual({ todo: 3, questions: 1 })
})

it('trie les tâches par échéance, datées d’abord, et met les terminées à part', () => {
  const { open, done } = filterWall(posts, 'todo', '', childName)
  expect(open.map((p) => p.id)).toEqual([3, 1, 2])
  expect(done.map((p) => p.id)).toEqual([4])
})

it('« Tout » liste du plus récent au plus ancien, sans section terminée', () => {
  const { open, done } = filterWall(posts, 'all', '', childName)
  expect(open.map((p) => p.id)).toEqual([6, 5, 4, 3, 2, 1])
  expect(done).toEqual([])
})

it('cherche dans le texte et le prénom de l’enfant', () => {
  expect(filterWall(posts, 'all', 'piscine', childName).open.map((p) => p.id)).toEqual([5])
  expect(filterWall(posts, 'all', 'léo', childName).open.map((p) => p.id)).toEqual([5])
})

it('signale les tâches en retard seulement', () => {
  expect(isOverdue(posts[2], '2026-10-11')).toBe(true)
  expect(isOverdue(posts[0], '2026-10-11')).toBe(false)
  expect(isOverdue(post(7, 'task', { due_date: '2026-10-01', completed_at: 'x' }), '2026-10-11')).toBe(false)
})
