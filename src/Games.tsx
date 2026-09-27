import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { continuePuzzle, movePuzzle, newPuzzle, newSnake, SNAKE_TICK_MS, snakeTickMs, snakeLevel, tickSnake, turnSnake,
  type Direction, type GameId, type PuzzleState, type SnakeState } from './games/engine'
import { drawGame, drawPreview, type GameVisual } from './games/draw'
import { readRecords, saveRecord } from './games/records'
import { games } from './games/catalog'

const keyDirections: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
}
const statuses = { ready: 'READY', running: 'RUNNING', paused: 'PAUSED', lost: 'GAME OVER', won: 'COMPLETE', playing: 'RUNNING' }
interface GameModel {
  selected: GameId
  active: GameId | null
  snake: SnakeState
  puzzle: PuzzleState
  undo: PuzzleState | null
}
type GameWindow = Window & { render_game_to_text?: () => string; advanceTime?: (ms: number) => void }
type Props = { onClose: () => void; onPlayingChange: (playing: boolean) => void; footerHost: HTMLElement | null }

export function Games({ onClose, onPlayingChange, footerHost }: Props) {
  const [model, setModel] = useState<GameModel>(() => ({ selected: 'snake', active: null, snake: newSnake(), puzzle: newPuzzle(), undo: null }))
  const current = useRef(model)
  const [records, setRecords] = useState(readRecords)
  const recordsRef = useRef(records)
  const initialBest = useRef(0)
  const root = useRef<HTMLElement>(null)
  const footer = useRef<HTMLDivElement>(null)
  const board = useRef<HTMLCanvasElement>(null)
  const pickerScroll = useRef(0)
  const accumulator = useRef(0)
  const manualClock = useRef(false)
  const visual = useRef<GameVisual>({ age: 1000, clock: 0, reducedMotion: false })
  const puzzleQueue = useRef<Direction[]>([])
  const dirty = useRef(true)
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [fullscreenError, setFullscreenError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const game = games.find(item => item.id === (model.active ?? model.selected))!
  const status = model.active === 'snake' ? model.snake.status : model.puzzle.status
  const score = model.active === 'snake' ? model.snake.score : model.puzzle.score
  const best = records[game.id].best

  function paint() {
    const state = current.current
    if (board.current) {
      if (state.active) drawGame(board.current, state.active, state.snake, state.puzzle, visual.current)
      else drawPreview(board.current, state.selected)
    }
    dirty.current = false
  }
  function update(next: GameModel) {
    current.current = next
    if (next.active) {
      const id = next.active
      const value = id === 'snake' ? next.snake.score : next.puzzle.score
      const milestone = id === 'snake' ? next.snake.body.length : Math.max(...next.puzzle.cells)
      if (value > recordsRef.current[id].best || milestone > recordsRef.current[id].milestone) {
        recordsRef.current = saveRecord(recordsRef.current, id, value, milestone)
        setRecords(recordsRef.current)
      }
    }
    dirty.current = true
    setModel(next)
  }
  function clearMotion() {
    touch.current = null
    accumulator.current = 0
    visual.current.age = 1000
    visual.current.previousSnake = undefined
    visual.current.foodBurst = undefined
    visual.current.impact = undefined
    puzzleQueue.current = []
  }
  function start(id = current.current.selected) {
    const state = current.current
    pickerScroll.current = root.current?.parentElement?.scrollTop ?? 0
    clearMotion()
    initialBest.current = recordsRef.current[id].best
    update({ ...state, selected: id, active: id, snake: newSnake(), puzzle: newPuzzle(), undo: null })
  }
  function back() {
    clearMotion()
    if (current.current.active) {
      if (document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => {})
      setFullscreenError('')
      update({ ...current.current, active: null, undo: null })
    } else onClose()
  }
  function focusBoard() { board.current?.focus({ preventScroll: true }) }
  function restart() {
    const state = current.current
    clearMotion()
    initialBest.current = recordsRef.current[state.active ?? state.selected].best
    update({ ...state, snake: newSnake(), puzzle: newPuzzle(), undo: null })
    focusBoard()
  }
  function primary() {
    const state = current.current
    accumulator.current = 0
    if (state.active === 'snake') {
      if (state.snake.status === 'lost' || state.snake.status === 'won') restart()
      else update({ ...state, snake: { ...state.snake, status: state.snake.status === 'running' ? 'paused' : 'running' } })
    } else if (state.puzzle.status === 'won') update({ ...state, puzzle: continuePuzzle(state.puzzle) })
    else if (state.puzzle.status === 'lost') restart()
    focusBoard()
  }
  function undo() {
    const state = current.current
    if (state.active !== '2048' || !state.undo) return
    clearMotion()
    update({ ...state, puzzle: { ...state.undo, motion: undefined, spawned: undefined }, undo: null })
    focusBoard()
  }
  function applyPuzzleMove(direction: Direction) {
    const state = current.current
    const puzzle = movePuzzle(state.puzzle, direction)
    if (puzzle !== state.puzzle) {
      visual.current.age = 0
      update({ ...state, puzzle, undo: puzzle.moves !== state.puzzle.moves ? state.puzzle : state.undo })
      if (puzzle.status !== 'playing') puzzleQueue.current = []
      return true
    }
    return false
  }
  function move(direction: Direction) {
    const state = current.current
    if (state.active === 'snake') {
      if (state.snake.status === 'ready') accumulator.current = 0
      const snake = turnSnake(state.snake, direction)
      if (snake !== state.snake) update({ ...state, snake })
    } else if (state.active === '2048' && state.puzzle.status === 'playing') {
      // Keep quick deliberate key presses in order while the current move settles.
      if (!visual.current.reducedMotion && visual.current.age < 165) {
        if (puzzleQueue.current.length < 3) puzzleQueue.current.push(direction)
      } else applyPuzzleMove(direction)
    }
  }
  function advance(ms: number) {
    const state = current.current
    visual.current.clock += ms
    visual.current.age += ms
    if (visual.current.foodBurst) visual.current.foodBurst.age += ms
    if (visual.current.impact) visual.current.impact.age += ms
    if (state.active === 'snake' && state.snake.status === 'running') {
      accumulator.current += ms
      let snake = state.snake
      while (accumulator.current >= snakeTickMs(snake.score) && snake.status === 'running') {
        accumulator.current -= snakeTickMs(snake.score)
        visual.current.previousSnake = snake
        const previous = snake
        snake = tickSnake(snake)
        if (snake.score > previous.score && previous.food) visual.current.foodBurst = { ...previous.food, age: accumulator.current }
        if (snake.status === 'lost') visual.current.impact = { ...snake.body[0], age: accumulator.current }
        visual.current.age = accumulator.current
      }
      if (snake !== state.snake) update({ ...state, snake })
    } else accumulator.current = 0
    if (state.active === '2048') {
      while (puzzleQueue.current.length && (visual.current.age >= 165 || visual.current.reducedMotion)) {
        const remainder = Math.max(0, visual.current.age - 165)
        if (applyPuzzleMove(puzzleQueue.current.shift()!)) visual.current.age = remainder
      }
    }
    if (dirty.current || (state.active && (visual.current.age < 700 || state.active === 'snake' && state.snake.status === 'running'))) paint()
  }
  async function toggleFullscreen() {
    if (!current.current.active) return
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen()
      else await root.current?.requestFullscreen()
      setFullscreenError('')
    } catch { setFullscreenError('当前浏览器无法进入全屏') }
    focusBoard()
  }

  useLayoutEffect(() => { onPlayingChange(Boolean(model.active)) }, [model.active, onPlayingChange])
  useLayoutEffect(() => {
    if (model.active) focusBoard()
    else {
      const selected = root.current?.querySelector<HTMLButtonElement>(`[data-game="${current.current.selected}"]`)
      selected?.focus({ preventScroll: true })
      if (root.current?.parentElement) root.current.parentElement.scrollTop = pickerScroll.current
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [model.active])
  useLayoutEffect(paint, [model])
  useEffect(() => {
    let mounted = true
    const observer = new ResizeObserver(paint)
    if (board.current) observer.observe(board.current)
    void document.fonts.ready.then(() => { if (mounted) paint() })
    return () => { mounted = false; observer.disconnect() }
  }, [model.active])
  useEffect(() => {
    let frame = 0, previous = performance.now()
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
    function motionChange() { visual.current.reducedMotion = motionPreference.matches; dirty.current = true }
    motionChange()
    motionPreference.addEventListener('change', motionChange)
    function animate(now: number) {
      if (!manualClock.current) advance(Math.min(now - previous, SNAKE_TICK_MS))
      else if (dirty.current) paint()
      previous = now
      frame = requestAnimationFrame(animate)
    }
    function pause() {
      puzzleQueue.current = []
      const state = current.current
      if (state.active === 'snake' && state.snake.status === 'running') {
        accumulator.current = 0
        update({ ...state, snake: { ...state.snake, status: 'paused' } })
      }
    }
    function visibility() { if (document.hidden) pause() }
    function fullscreenChange() { setFullscreen(document.fullscreenElement === root.current); dirty.current = true }
    function syncRecords() {
      const stored = readRecords()
      for (const id of ['snake', '2048'] as const) stored[id] = {
        best: Math.max(stored[id].best, recordsRef.current[id].best),
        milestone: Math.max(stored[id].milestone, recordsRef.current[id].milestone),
      }
      recordsRef.current = stored; setRecords(stored)
    }
    window.addEventListener('blur', pause)
    window.addEventListener('storage', syncRecords)
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('fullscreenchange', fullscreenChange)
    frame = requestAnimationFrame(animate)
    const gameWindow = window as GameWindow
    gameWindow.render_game_to_text = () => {
      const state = current.current
      return JSON.stringify({ mode: state.active ?? 'selection', selected: state.selected, records: recordsRef.current,
        coordinates: 'origin top-left, x right, y down; snake 18x18; 2048 row-major 4x4',
        ...(state.active === 'snake' ? { snake: state.snake, level: snakeLevel(state.snake.score), tickMs: snakeTickMs(state.snake.score) }
          : state.active === '2048' ? { puzzle: state.puzzle, canUndo: Boolean(state.undo), queuedMoves: puzzleQueue.current } : { games: games.map(item => item.id) }) })
    }
    gameWindow.advanceTime = (ms: number) => {
      if (!Number.isFinite(ms) || ms < 0) return
      manualClock.current = true
      advance(Math.min(ms, 60000))
    }
    return () => {
      cancelAnimationFrame(frame)
      motionPreference.removeEventListener('change', motionChange)
      window.removeEventListener('blur', pause)
      window.removeEventListener('storage', syncRecords)
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('fullscreenchange', fullscreenChange)
      delete gameWindow.render_game_to_text
      delete gameWindow.advanceTime
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const state = current.current
    const target = event.target as HTMLElement
    if (event.key === 'Tab') {
      event.preventDefault()
      const controls = [...Array.from(root.current?.querySelectorAll<HTMLElement>('button, canvas[tabindex="0"]') ?? []),
        ...(!state.active ? Array.from(footer.current?.querySelectorAll<HTMLElement>('button') ?? []) : [])]
        .filter(item => !item.matches(':disabled') && !item.closest('[hidden], [inert]') && item.getClientRects().length > 0)
      const index = controls.indexOf(document.activeElement as HTMLElement)
      const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      ;(controls[next] ?? root.current)?.focus({ preventScroll: true })
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (event.repeat) return
      if (document.fullscreenElement === root.current) void toggleFullscreen()
      else back()
      return
    }
    if (target.matches('input, textarea, [contenteditable="true"]')) return
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (!state.active) {
      const digit = /^[1-9]$/.test(key) ? Number(key) - 1 : -1
      const step = ({ ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, PageUp: -10, PageDown: 10 } as Record<string, number>)[key]
      if (step !== undefined || key === 'Home' || key === 'End' || digit >= 0 && digit < games.length) {
        event.preventDefault()
        const index = games.findIndex(item => item.id === state.selected)
        const next = digit >= 0 ? digit : key === 'Home' ? 0 : key === 'End' ? games.length - 1
          : key === 'PageUp' ? Math.max(0, index - 10) : key === 'PageDown' ? Math.min(games.length - 1, index + 10)
          : ((index + step!) % games.length + games.length) % games.length
        const selected = games[next].id
        update({ ...state, selected })
        const item = root.current?.querySelector<HTMLButtonElement>(`[data-game="${selected}"]`)
        item?.focus({ preventScroll: true })
        item?.scrollIntoView({ block: 'nearest' })
      } else if (key === 'Enter' && (target.hasAttribute('data-game') || !target.closest('button'))) {
        event.preventDefault()
        if (!event.repeat) start()
      }
      return
    }
    if (key === 'f' && !event.shiftKey) { event.preventDefault(); if (!event.repeat) void toggleFullscreen(); return }
    if (keyDirections[key]) { event.preventDefault(); if (!event.repeat) move(keyDirections[key]); return }
    if (key === 'r' && !event.shiftKey) { event.preventDefault(); if (!event.repeat) restart(); return }
    if (key === 'u' && !event.shiftKey) { event.preventDefault(); if (!event.repeat) undo(); return }
    if ((key === ' ' || key === 'Enter') && !target.closest('button')) {
      event.preventDefault()
      if (!event.repeat) primary()
    }
  }

  const primaryLabel = model.active === 'snake'
    ? status === 'running' ? '暂停' : status === 'paused' ? '继续' : status === 'ready' ? '开始' : '再来一局'
    : status === 'lost' ? '再来一局' : '继续游戏'
  const canvasLabel = model.active === 'snake'
    ? `贪吃蛇，${statuses[model.snake.status]}，得分 ${score}`
    : model.active === '2048' ? `2048，${statuses[model.puzzle.status]}，得分 ${score}，棋盘：${model.puzzle.cells.join(', ')}` : `${game.title}预览`
  const overlay = model.active && ['ready', 'paused', 'lost', 'won'].includes(status)
  const canvas = <canvas ref={board} width={600} height={600} className="game-canvas" role="img"
    aria-label={canvasLabel} tabIndex={model.active ? 0 : undefined}
    onPointerDown={event => {
      if (!model.active || !event.isPrimary) return
      focusBoard(); touch.current = { x: event.clientX, y: event.clientY, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      const point = touch.current
      if (!point || current.current.active !== 'snake') return
      const dx = event.clientX - point.x, dy = event.clientY - point.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return
      move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up')
      touch.current = { x: event.clientX, y: event.clientY, moved: true }
    }}
    onPointerUp={event => {
      const point = touch.current; touch.current = null
      if (!point) return
      const dx = event.clientX - point.x, dy = event.clientY - point.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
        const state = current.current
        const status = state.active === 'snake' ? state.snake.status : state.puzzle.status
        if (!point.moved && ['ready', 'paused', 'lost', 'won'].includes(status)) primary()
        return
      }
      move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up')
    }} onPointerCancel={() => { touch.current = null }} />
  const actionHint = model.active === 'snake' ? `SPACE ${status === 'ready' ? '开始' : status === 'paused' ? '继续' : status === 'lost' || status === 'won' ? '重开' : '暂停'}` : status === 'won' ? 'ENTER 继续 · U 撤销' : 'U 撤销'
  const footerContent = <div ref={footer} className="game-footer-inner">
    <span className="game-shortcuts">{!model.active ? '↑↓ 选择 · ENTER 开始 · TAB / ⇧TAB 切换 · HOME / END 首尾 · ESC 退出'
      : `方向键 / WASD · ${actionHint} · R 重开 · TAB / ⇧TAB 切换 · F 全屏 · ESC 返回`}</span>
    <span className="game-shortcuts-mobile">{model.active ? `↑↓←→ · ${model.active === 'snake' ? 'SPACE' : 'U'} · TAB/⇧TAB · ESC` : '↑↓ ↵ · TAB/⇧TAB · ESC'}</span>
    <div className="game-footer-actions">{model.active && <button onClick={() => void toggleFullscreen()} title="F">{fullscreen ? '退出全屏' : '全屏'}</button>}
      <button onClick={back}>{model.active ? '游戏列表' : '返回终端'}</button></div>
  </div>

  return <section ref={root} className={`games ${model.active ? 'games-playing' : 'games-inline'}`} aria-label="游戏" tabIndex={-1} onKeyDown={onKeyDown}>
    {model.active && <header className="terminal-bar terminal-topbar">
      <span className="bar-brand"><i className="bar-square" /><span className="bar-title">GAME / {game.id.toUpperCase()}</span></span>
      <span className="game-bar-status" role="status">{statuses[status]}</span>
    </header>}
    <div className="game-content">
      {!model.active ? <div className="game-picker"><nav className="game-list" aria-label="选择游戏">
        {games.map((item, index) => <button key={item.id} className="game-row" data-game={item.id} aria-pressed={model.selected === item.id}
          aria-label={`${index + 1}. ${item.title}，最高分 ${records[item.id].best}`}
          onFocus={event => {
            if (current.current.selected !== item.id) update({ ...current.current, selected: item.id })
            event.currentTarget.scrollIntoView({ block: 'nearest' })
          }}
          onClick={() => update({ ...current.current, selected: item.id })}>
          <span className="game-selection-arrow" aria-hidden="true">›</span>
          <span className="game-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="game-name">{item.title}</span>
          <span className="game-description">{item.description}</span>
          <span className="game-list-record">最高 {records[item.id].best}</span>
        </button>)}
      </nav>
        <div className="game-preview">
          <div className="game-preview-board">{canvas}</div>
          <div className="game-preview-detail">
            <p className="game-preview-title">{game.title}</p>
            <p className="game-preview-description">{game.description}</p>
            <button className="game-start" onClick={() => start()}>开始 ↵</button>
          </div>
        </div>
      </div> : <div className="game-play">
        <div className="game-scoreboard" aria-label="分数">
          <div><span>SCORE / 得分</span><strong>{String(score).padStart(4, '0')}</strong></div>
          <div><span>BEST / 最高</span><strong>{String(best).padStart(4, '0')}</strong></div>
          <div><span>{model.active === 'snake' ? 'LEVEL / 等级' : 'MOVES / 步数'}</span><strong>{String(model.active === 'snake' ? snakeLevel(score) : model.puzzle.moves).padStart(2, '0')}</strong></div>
        </div>
        <div className="game-board">{canvas}
          {overlay && <div className="game-overlay" role="status">
            <strong>{statuses[status]}</strong>
            <span>{status === 'ready' ? '贪吃蛇' : status === 'paused' ? '已暂停' : status === 'won' ? model.active === 'snake' ? '棋盘已填满' : '已达成 2048' : `${score} 分${score > initialBest.current ? ' · 新纪录' : ''}`}</span>
          </div>}
        </div>
        <div className="game-run-info"><span>{model.active === 'snake' ? `LENGTH ${model.snake.body.length} / 324` : `TILE ${Math.max(...model.puzzle.cells)}`}</span>
          <span>{score > initialBest.current ? 'NEW BEST' : model.active === 'snake' ? snakeLevel(score) === 8 ? 'MAX SPEED' : `NEXT ${50 - score % 50}` : `RECORD ${records['2048'].milestone}`}</span></div>
        <div className="game-controls" aria-label="游戏操作">
          <div className="game-direction-pad" aria-label="方向控制">
            {(['up', 'left', 'down', 'right'] as Direction[]).map(direction => <button key={direction} className={`game-direction-${direction}`}
              aria-label={{ up: '向上', down: '向下', left: '向左', right: '向右' }[direction]}
              onClick={() => { move(direction); focusBoard() }}>{({ up: '↑', down: '↓', left: '←', right: '→' })[direction]}</button>)}
          </div>
          <div className="game-round-actions">
            {(model.active === 'snake' || status === 'won' || status === 'lost') && <button onClick={primary}>[ {primaryLabel} ]</button>}
            {model.active === '2048' && <button onClick={undo} disabled={!model.undo}>[ 撤销 U ]</button>}
            <button onClick={restart}>[ 重开 R ]</button>
          </div>
        </div>
      </div>}
      {fullscreenError && <p className="game-notice" role="status">{fullscreenError}</p>}
    </div>
    {model.active ? <footer className="terminal-bar terminal-bottombar game-footer">{footerContent}</footer>
      : footerHost && createPortal(footerContent, footerHost)}
  </section>
}
