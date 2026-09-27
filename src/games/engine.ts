export type Direction = 'up' | 'down' | 'left' | 'right'
export type GameId = 'snake' | '2048'
export type Cell = { x: number; y: number }

export const SNAKE_SIZE = 18
export const SNAKE_TICK_MS = 140
export function snakeTickMs(score: number) { return Math.max(70, SNAKE_TICK_MS - Math.floor(score / 50) * 10) }
export function snakeLevel(score: number) { return 1 + Math.floor((SNAKE_TICK_MS - snakeTickMs(score)) / 10) }

const vectors: Record<Direction, Cell> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
}
const opposite: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export interface SnakeState {
  body: Cell[]
  food: Cell | null
  direction: Direction
  pending: Direction[]
  score: number
  status: 'ready' | 'running' | 'paused' | 'lost' | 'won'
}

function snakeFood(body: Cell[], random: () => number): Cell | null {
  const free: Cell[] = []
  for (let y = 0; y < SNAKE_SIZE; y++) for (let x = 0; x < SNAKE_SIZE; x++) {
    if (!body.some(cell => cell.x === x && cell.y === y)) free.push({ x, y })
  }
  return free.length ? free[Math.floor(random() * free.length)] : null
}

export function newSnake(random = Math.random): SnakeState {
  const body = [{ x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }]
  return { body, food: snakeFood(body, random), direction: 'right', pending: [], score: 0, status: 'ready' }
}

export function turnSnake(state: SnakeState, direction: Direction): SnakeState {
  if (state.status !== 'running' && state.status !== 'ready') return state
  const previous = state.pending.at(-1) ?? state.direction
  if (direction === opposite[previous] || state.pending.length >= 2) return state
  return { ...state, status: 'running', pending: direction === previous ? state.pending : [...state.pending, direction] }
}

export function tickSnake(state: SnakeState, random = Math.random): SnakeState {
  if (state.status !== 'running') return state
  const direction = state.pending[0] ?? state.direction
  const delta = vectors[direction]
  const head = { x: state.body[0].x + delta.x, y: state.body[0].y + delta.y }
  const eating = head.x === state.food?.x && head.y === state.food?.y
  // The tail vacates its cell on a non-eating move.
  const solid = eating ? state.body : state.body.slice(0, -1)
  if (head.x < 0 || head.y < 0 || head.x >= SNAKE_SIZE || head.y >= SNAKE_SIZE
    || solid.some(cell => cell.x === head.x && cell.y === head.y)) {
    return { ...state, direction, pending: [], status: 'lost' }
  }
  const body = [head, ...state.body]
  if (!eating) body.pop()
  const food = eating ? snakeFood(body, random) : state.food
  return { ...state, body, food, direction, pending: state.pending.slice(1), score: state.score + (eating ? 10 : 0), status: food ? 'running' : 'won' }
}

export interface TileMotion { from: number; to: number; value: number; merged: boolean }

export interface PuzzleState {
  motion?: TileMotion[]
  spawned?: number
  cells: number[]
  score: number
  moves: number
  continued: boolean
  status: 'playing' | 'won' | 'lost'
}

function spawnTile(cells: number[], random: () => number): number[] {
  const free = cells.flatMap((value, index) => value ? [] : [index])
  if (!free.length) return cells
  const next = [...cells]
  next[free[Math.floor(random() * free.length)]] = random() < .9 ? 2 : 4
  return next
}

export function newPuzzle(random = Math.random): PuzzleState {
  return { cells: spawnTile(spawnTile(Array<number>(16).fill(0), random), random), score: 0, moves: 0, continued: false, status: 'playing' }
}

function hasPuzzleMove(cells: number[]): boolean {
  return cells.some((value, index) => value === 0
    || (index % 4 < 3 && value === cells[index + 1]) || (index < 12 && value === cells[index + 4]))
}

function puzzleStatus(cells: number[], continued: boolean): PuzzleState['status'] {
  if (!continued && cells.some(value => value >= 2048)) return 'won'
  return hasPuzzleMove(cells) ? 'playing' : 'lost'
}

export function movePuzzle(state: PuzzleState, direction: Direction, random = Math.random): PuzzleState {
  if (state.status !== 'playing') return state
  const cells = [...state.cells]
  let gained = 0
  const motion: TileMotion[] = []
  for (let line = 0; line < 4; line++) {
    const indices = Array.from({ length: 4 }, (_, offset) => {
      if (direction === 'left') return line * 4 + offset
      if (direction === 'right') return line * 4 + 3 - offset
      if (direction === 'up') return offset * 4 + line
      return (3 - offset) * 4 + line
    })
    const sources = indices.filter(index => state.cells[index])
    const values = sources.map(index => state.cells[index])
    const merged: number[] = []
    for (let i = 0; i < values.length; i++) {
      if (values[i] === values[i + 1]) {
        const value = values[i] * 2
        motion.push({ from: sources[i], to: indices[merged.length], value: values[i], merged: true },
          { from: sources[i + 1], to: indices[merged.length], value: values[i + 1], merged: true })
        merged.push(value)
        gained += value
        i++
      } else {
        motion.push({ from: sources[i], to: indices[merged.length], value: values[i], merged: false })
        merged.push(values[i])
      }
    }
    indices.forEach((index, offset) => { cells[index] = merged[offset] ?? 0 })
  }
  if (cells.every((value, index) => value === state.cells[index])) {
    return hasPuzzleMove(cells) ? state : { ...state, status: 'lost' }
  }
  const next = spawnTile(cells, random)
  return { ...state, cells: next, motion, spawned: next.findIndex((value, index) => value !== cells[index]), score: state.score + gained, moves: state.moves + 1, status: puzzleStatus(next, state.continued) }
}

export function continuePuzzle(state: PuzzleState): PuzzleState {
  return { ...state, continued: true, status: puzzleStatus(state.cells, true) }
}
