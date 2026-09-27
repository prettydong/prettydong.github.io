import type { GameId } from './engine'

export type Records = Record<GameId, { best: number; milestone: number }>
const KEY = 'zed-arcade-records-v1'
export function readRecords(): Records {
  const empty: Records = { snake: { best: 0, milestone: 3 }, '2048': { best: 0, milestone: 0 } }
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    for (const id of ['snake', '2048'] as const) {
      for (const field of ['best', 'milestone'] as const) {
        const value = data?.[id]?.[field]
        if (Number.isSafeInteger(value) && value >= 0) empty[id][field] = Math.max(empty[id][field], value)
      }
    }
  } catch { /* Storage may be unavailable; this session remains playable. */ }
  return empty
}
export function saveRecord(records: Records, id: GameId, score: number, milestone: number): Records {
  const stored = readRecords()
  const next = { ...records }
  for (const game of ['snake', '2048'] as const) next[game] = {
    best: Math.max(records[game].best, stored[game].best, game === id ? score : 0),
    milestone: Math.max(records[game].milestone, stored[game].milestone, game === id ? milestone : 0),
  }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* Keep in-memory records. */ }
  return next
}
