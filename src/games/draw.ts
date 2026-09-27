import { SNAKE_SIZE, snakeTickMs, type GameId, type PuzzleState, type SnakeState } from './engine'

export interface GameVisual {
  age: number
  clock: number
  previousSnake?: SnakeState
  impact?: { x: number; y: number; age: number }
  foodBurst?: { x: number; y: number; age: number }
  reducedMotion: boolean
}

export function drawGame(canvas: HTMLCanvasElement, game: GameId, snake: SnakeState, puzzle: PuzzleState,
  visual: GameVisual = { age: 1000, clock: 0, reducedMotion: false }) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = canvas.getBoundingClientRect().width
  if (!size) return
  const pixels = Math.round(size * Math.min(window.devicePixelRatio || 1, 3))
  if (canvas.width !== pixels || canvas.height !== pixels) { canvas.width = pixels; canvas.height = pixels }
  ctx.setTransform(pixels / 600, 0, 0, pixels / 600, 0, 0)
  const style = getComputedStyle(canvas)
  const color = (name: string) => style.getPropertyValue(name).trim()
  const bg = color('--bg'), fg = color('--fg'), line = color('--line'), accent = color('--ui-info')
  const age = visual.reducedMotion ? 1000 : visual.age
  const block = (x: number, y: number, w: number, h: number) => {
    ctx.fillRect(x, y, w, h)
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 600, 600)

  if (game === 'snake') {
    const unit = 600 / SNAKE_SIZE
    ctx.fillStyle = line
    for (let y = 1; y < SNAKE_SIZE; y++) for (let x = 1; x < SNAKE_SIZE; x++) {
      ctx.fillRect(x * unit - 1, y * unit - 1, 2, 2)
    }
    // Corner marks define the playfield without adding another enclosing frame.
    ctx.strokeStyle = color('--muted'); ctx.lineWidth = 1
    for (const [x, y, dx, dy] of [[1, 1, 1, 1], [599, 1, -1, 1], [1, 599, 1, -1], [599, 599, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x + dx * 12, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * 12); ctx.stroke()
    }
    const body = snake.body
    const previous = visual.previousSnake
    const t = Math.min(1, age / (snakeTickMs(snake.score) * .75))
    const points = body.map((cell, i) => {
      const old = previous ? previous.body[Math.min(i, previous.body.length - 1)] : cell
      return { x: (old.x + (cell.x - old.x) * t + .5) * unit, y: (old.y + (cell.y - old.y) * t + .5) * unit }
    })
    ctx.fillStyle = fg
    for (let i = points.length - 1; i > 0; i--) {
      ctx.globalAlpha = .35 + .55 * (1 - i / points.length)
      block(points[i].x - unit * .38, points[i].y - unit * .38, unit * .76, unit * .76)
    }
    ctx.globalAlpha = 1
    const head = points[0]
    ctx.fillStyle = snake.status === 'lost' ? color('--error') : accent
    block(head.x - unit * .4, head.y - unit * .4, unit * .8, unit * .8)
    const direction = snake.direction
    ctx.fillStyle = bg
    const horizontal = direction === 'left' || direction === 'right'
    for (const offset of [-.18, .18]) {
      const x = horizontal ? (direction === 'right' ? .2 : -.2) : offset
      const y = horizontal ? offset : (direction === 'down' ? .2 : -.2)
      ctx.beginPath(); ctx.arc(head.x + x * unit, head.y + y * unit, 2.7, 0, Math.PI * 2); ctx.fill()
    }
    const food = snake.food
    if (food) {
      const x = (food.x + .5) * unit, y = (food.y + .5) * unit
      ctx.fillStyle = accent
      const radius = unit * (visual.reducedMotion || snake.status !== 'running' ? .26 : .26 + Math.sin(visual.clock / 180) * .035)
      block(x - radius, y - 2, radius * 2, 4)
      block(x - 2, y - radius, 4, radius * 2)
    }
    const burst = visual.foodBurst
    if (!visual.reducedMotion && burst && burst.age < 420) {
      const p = burst.age / 420, x = (burst.x + .5) * unit, y = (burst.y + .5) * unit
      ctx.fillStyle = accent; ctx.globalAlpha = 1 - p
      ctx.font = `400 13px ${style.fontFamily}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3
        ctx.fillText(i % 2 ? '.' : '+', x + Math.cos(angle) * (14 + p * 38), y + Math.sin(angle) * (14 + p * 38))
      }
      ctx.font = `700 20px ${style.fontFamily}`; ctx.textAlign = 'center'
      const labelX = horizontal ? x : x + (x > 520 ? -52 : 52)
      const labelY = horizontal ? y + (y < 60 ? 48 : -48) : y
      ctx.fillText('+10', Math.max(25, Math.min(575, labelX)), Math.max(20, labelY - p * 24))
    }
    const impact = visual.impact
    if (impact && impact.age < 450 && !visual.reducedMotion) {
      const p = impact.age / 450
      ctx.globalAlpha = 1 - p; ctx.strokeStyle = color('--error'); ctx.lineWidth = 2
      const x = (impact.x + .5) * unit, y = (impact.y + .5) * unit, radius = unit * (.5 + p * .7)
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath(); ctx.moveTo(x + dx * radius, y + dy * radius * .6); ctx.lineTo(x + dx * radius, y + dy * radius); ctx.lineTo(x + dx * radius * .6, y + dy * radius); ctx.stroke()
      }
    }
  } else {
    const cells = puzzle.cells
    const gap = 14, unit = (600 - gap * 5) / 4
    const position = (index: number) => ({ x: gap + index % 4 * (unit + gap), y: gap + Math.floor(index / 4) * (unit + gap) })
    for (let i = 0; i < 16; i++) {
      const { x, y } = position(i)
      ctx.strokeStyle = line; ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeRect(x, y, unit, unit)
    }
    const tile = (value: number, x: number, y: number, scale = 1) => {
      const ink = value >= 128 ? accent : fg
      ctx.save(); ctx.translate(x + unit / 2, y + unit / 2); ctx.scale(scale, scale)
      ctx.fillStyle = bg; ctx.globalAlpha = 1; block(-unit / 2, -unit / 2, unit, unit)
      ctx.strokeStyle = ink; ctx.lineWidth = value >= 128 ? 2 : 1; ctx.globalAlpha = .6; ctx.strokeRect(-unit / 2, -unit / 2, unit, unit)
      ctx.globalAlpha = 1; ctx.fillStyle = ink
      ctx.font = `700 ${value < 100 ? 52 : value < 1000 ? 44 : value < 10000 ? 36 : 28}px ${style.fontFamily}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(value), 0, 3, unit - 12)
      ctx.restore()
    }
    const moving = puzzle.motion && age < 115
    if (moving) {
      const t = 1 - Math.pow(1 - age / 115, 3)
      for (const motion of puzzle.motion!) {
        const from = position(motion.from), to = position(motion.to)
        tile(motion.value, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
      }
    } else {
      cells.forEach((value, index) => {
        if (!value) return
        const { x, y } = position(index)
        const merged = puzzle.motion?.some(motion => motion.to === index && motion.merged)
        const pop = Math.max(0, Math.min(1, (age - 115) / 150))
        const scale = index === puzzle.spawned ? .7 + .3 * pop : merged ? 1 + Math.sin(pop * Math.PI) * .09 : 1
        tile(value, x, y, scale)
        if (merged && age < 650 && !visual.reducedMotion) {
          const fade = Math.max(0, 1 - (age - 115) / 535)
          ctx.save(); ctx.globalAlpha = fade; ctx.fillStyle = accent
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `400 17px ${style.fontFamily}`
          ctx.fillText(`+${value}`, x + unit / 2, y + 22 - (1 - fade) * 6)
          ctx.strokeStyle = accent; ctx.lineWidth = 2
          const length = 14 * fade
          for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + unit, y, -1, 1], [x, y + unit, 1, -1], [x + unit, y + unit, -1, -1]]) {
            ctx.beginPath(); ctx.moveTo(cx + dx * length, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * length); ctx.stroke()
          }
          ctx.restore()
        }
      })
    }
  }
  ctx.globalAlpha = 1
}


export function drawPreview(canvas: HTMLCanvasElement, game: GameId) {
  const snake: SnakeState = {
    body: [{ x: 11, y: 6 }, { x: 10, y: 6 }, { x: 9, y: 6 }, { x: 8, y: 6 }, { x: 7, y: 6 },
      { x: 7, y: 7 }, { x: 7, y: 8 }, { x: 7, y: 9 }, { x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }],
    food: { x: 13, y: 6 }, direction: 'right', pending: [], score: 0, status: 'ready',
  }
  const puzzle: PuzzleState = {
    cells: [2, 0, 0, 0, 4, 8, 0, 0, 8, 32, 64, 0, 16, 64, 128, 2048],
    score: 0, moves: 0, continued: false, status: 'playing',
  }
  drawGame(canvas, game, snake, puzzle, { age: 1000, clock: 0, reducedMotion: true })
}
