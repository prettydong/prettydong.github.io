import { runCpuBenchmark, benchmarkScore } from './system/benchmark'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { runHttping } from './system/httping'
import { Portal, filterPortal } from './Portal'
import { MarkdownOutput } from './MarkdownOutput'
import { Blog } from './Blog'
import { Games } from './Games'
import { AgentTerminal } from './AgentTerminal'
import { blogPosts, filterBlog } from './blog-content'
import { localSystem, type OutputLine, type Settings, type ThemeName } from './system'

interface TerminalEntry {
  id: number
  command?: string
  path?: string
  promptText?: string
  lines: OutputLine[]
  themeCommand?: boolean
  importPath?: string
  exportFile?: { name: string; content: string }
}

interface CompletionState {
  base: string
  options: string[]
  index: number
}

const THEME_CHOICES: { name: ThemeName; label: string; colors: string[] }[] = [
  { name: 'codex', label: 'Codex (light)', colors: ['#202123', '#ba4d4a', '#287a55', '#ac7838', '#457ca8', '#806a9d', '#4d8f8b', '#d7d9d7', '#70757a', '#d97a70', '#4fa67a', '#c79c59', '#7aa8c8', '#a48fbc', '#82b7ad', '#ffffff'] },
  { name: 'monokai', label: 'Monokai (dark)', colors: ['#272822', '#f92672', '#a6e22e', '#fd971f', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2', '#75715e', '#f92672', '#a6e22e', '#fd971f', '#66d9ef', '#ae81ff', '#a1efe4', '#ffffff'] },
  { name: 'claude', label: 'Claude (light)', colors: ['#262625', '#b45449', '#607d50', '#a47b45', '#587f9f', '#806a91', '#548b82', '#dedbd2', '#85837c', '#d97757', '#84a674', '#c79d61', '#83a5ba', '#aa8bb1', '#80aaa1', '#fffdf8'] },
]

const intro: TerminalEntry[] = [{
  id: 0,
  lines: [],
}]

function shortPath(path: string): string {
  return path === '/workspace' ? '~' : path.startsWith('/workspace/') ? `~${path.slice('/workspace'.length)}` : path
}

function PromptPrefix({ path, text }: { path: string; text?: string }) {
  return <span className="prompt-prefix">{text ?? `guest@local:${shortPath(path)}$`}</span>
}

function backgroundTone(color: string): 'dark' | 'light' {
  const hex = color.slice(1)
  const channels = hex.length === 3 ? [...hex].map((digit) => parseInt(digit + digit, 16))
    : [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16))
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 0.18 ? 'dark' : 'light'
}

function App() {
  const [cpuRunning, setCpuRunning] = useState(false)
  const [httpingTarget, setHttpingTarget] = useState<string | null>(null)
  const taskAbort = useRef<AbortController | null>(null)
  const stopTaskRef = useRef<HTMLButtonElement>(null)
  const [blogOpen, setBlogOpen] = useState(true)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentStatus, setAgentStatus] = useState('未连接模型接口')
  const [agentFooter, setAgentFooter] = useState<HTMLElement | null>(null)
  const [gameOpen, setGameOpen] = useState(false)
  const [gamePlaying, setGamePlaying] = useState(false)
  const [gameFooter, setGameFooter] = useState<HTMLElement | null>(null)
  const [blogWelcome, setBlogWelcome] = useState(true)
  const [blogQuery, setBlogQuery] = useState('')
  const [blogSlug, setBlogSlug] = useState<string | null>(null)
  const currentPost = blogPosts.find(post => post.slug === blogSlug)
  const [portalOpen, setPortalOpen] = useState(false)
  const [portalQuery, setPortalQuery] = useState('')
  const terminalScrollPosition = useRef(0)
  const restoreTerminalScroll = useRef(false)
  const portalCount = filterPortal(portalQuery).reduce((count, group) => count + group.links.length, 0)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState('')
  const [cwd, setCwd] = useState('/workspace')
  const [history, setHistory] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings>({ fontSize: 15, wrapOutput: true, theme: 'claude', font: 'mono', background: null, backgroundImage: true })
  const [entries, setEntries] = useState<TerminalEntry[]>(intro)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [replOpen, setReplOpen] = useState(false)
  const [replMore, setReplMore] = useState(false)
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [previewTheme, setPreviewTheme] = useState<ThemeName | null>(null)
  const [completion, setCompletion] = useState<CompletionState | null>(null)
  const [editorPath, setEditorPath] = useState<string | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [editorNotice, setEditorNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const importTarget = useRef<{ id: number; path: string } | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const themePickerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const nextId = useRef(1)
  const historyIndex = useRef(-1)
  const draftInput = useRef('')
  const replHistory = useRef<string[]>([])
  const replHistoryIndex = useRef(-1)
  const replDraftInput = useRef('')
  const working = useRef(false)
  const restorePromptFocus = useRef(false)
  const displayedTheme = previewTheme ?? settings.theme
  const themePickerIndex = Math.max(0, THEME_CHOICES.findIndex((choice) => choice.name === displayedTheme))

  useEffect(() => {
    let active = true
    async function boot() {
      try {
        const state = await localSystem.initialize()
        if (!active) return
        setCwd(state.cwd)
        setHistory(state.history)
        setSettings(state.settings)
        setReady(true)
      } catch (error) {
        if (active) setStartupError(error instanceof Error ? error.message : '无法打开本地工作区。')
      }
    }
    void boot()
    return () => { active = false }
  }, [])

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (portalOpen || blogOpen || gameOpen || agentOpen) return
    if (container && restoreTerminalScroll.current) {
      container.scrollTop = terminalScrollPosition.current
      restoreTerminalScroll.current = false
      return
    }
    if (container && stickToBottom.current) container.scrollTop = container.scrollHeight
  }, [entries, editorPath, themePickerOpen, portalOpen, blogOpen, gameOpen, agentOpen])

  function onTerminalScroll() {
    const container = scrollRef.current
    if (container && !portalOpen && !blogOpen && !gameOpen && !agentOpen) stickToBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 40
  }

  useEffect(() => { if (editorPath) editorRef.current?.focus() }, [editorPath])
  useEffect(() => { if (themePickerOpen) themePickerRef.current?.focus() }, [themePickerOpen])
  useEffect(() => {
    if (!restorePromptFocus.current || !ready || busy || editorPath || themePickerOpen || portalOpen || blogOpen || gameOpen || agentOpen) return
    restorePromptFocus.current = false
    inputRef.current?.focus({ preventScroll: true })
  })

  useEffect(() => {
    const backgrounds = { codex: '#ffffff', monokai: '#272822', claude: '#faf9f5' }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.background ?? backgrounds[displayedTheme])
  }, [displayedTheme, settings.background])

  useEffect(() => {
    if (!httpingTarget && !cpuRunning) return
    stopTaskRef.current?.focus({ preventScroll: true })
    function onTaskKeyDown(event: globalThis.KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return
      if (event.key === 'Escape' || (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'c')) {
        event.preventDefault()
        taskAbort.current?.abort()
      } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        stopTaskRef.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onTaskKeyDown)
    return () => document.removeEventListener('keydown', onTaskKeyDown)
  }, [httpingTarget, cpuRunning])

  useEffect(() => () => taskAbort.current?.abort(), [])

  function openPortal() {
    terminalScrollPosition.current = scrollRef.current?.scrollTop ?? 0
    setPortalQuery('')
    setPortalOpen(true)
  }

  function onTerminalKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat) return
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyP'
      && ready && !busy && !editorPath && !replOpen && !themePickerOpen && !blogOpen && !gameOpen && !agentOpen) {
      event.preventDefault()
      if (portalOpen) closePortal()
      else openPortal()
    }
  }

  function closePortal() {
    restoreTerminalScroll.current = true
    restorePromptFocus.current = true
    setPortalOpen(false)
  }

  function openBlog(slug: string | null = null) {
    terminalScrollPosition.current = scrollRef.current?.scrollTop ?? 0
    setBlogQuery('')
    setBlogSlug(slug)
    setBlogWelcome(slug === null)
    setBlogOpen(true)
  }

  function showBlogHome() {
    setBlogSlug(null)
    setBlogWelcome(true)
  }

  function closeBlog() {
    restoreTerminalScroll.current = true
    restorePromptFocus.current = true
    setBlogOpen(false)
  }

  function openGames() {
    terminalScrollPosition.current = scrollRef.current?.scrollTop ?? 0
    setGameOpen(true)
  }

  function closeAgent() {
    restoreTerminalScroll.current = true
    restorePromptFocus.current = true
    setAgentOpen(false)
  }

  function closeGames() {
    restoreTerminalScroll.current = true
    restorePromptFocus.current = true
    setGamePlaying(false)
    setGameOpen(false)
  }

  async function openEditor(path: string) {
    try {
      const content = await localSystem.readFile(path)
      setEditorPath(path)
      setEditorContent(content)
      setSavedContent(content)
      setEditorNotice('')
    } catch (error) {
      setEntries((current) => [...current, { id: nextId.current++, lines: [{ text: error instanceof Error ? error.message : '无法打开文件。', tone: 'error' }] }])
    }
  }

  async function runCommand(raw: string, echo = true) {
    const command = raw.trim()
    if (working.current) return
    if (!command) {
      setEntries((current) => [...current, { id: nextId.current++, command: '', path: cwd, lines: [] }])
      setInput('')
      historyIndex.current = -1
      draftInput.current = ''
      setCompletion(null)
      return
    }
    working.current = true
    restorePromptFocus.current = true
    setBusy(true)
    setInput('')
    historyIndex.current = -1
    draftInput.current = ''
    setCompletion(null)
    const pathAtCommand = cwd
    try {
      const result = await localSystem.execute(command)
      if (result.action?.type === 'reboot') {
        window.location.reload()
        return
      }
      setCwd(result.cwd)
      setHistory(result.history)
      setSettings(localSystem.getState().settings)
      const entryId = nextId.current++
      if (result.action?.type === 'clear') setEntries([])
      else setEntries((current) => [...current, { id: entryId, command: echo ? command : undefined, path: pathAtCommand, lines: result.output, themeCommand: result.action?.type === 'theme-picker', importPath: result.action?.type === 'import' ? result.action.path : undefined, exportFile: result.action?.type === 'export' ? result.action : undefined }])
      if (result.action?.type === 'benchmark') {
        const controller = new AbortController()
        taskAbort.current = controller
        setCpuRunning(true)
        try {
          const { score, ratio } = benchmarkScore(await runCpuBenchmark(controller.signal))
          const processors = navigator.hardwareConcurrency
          setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, lines: [
            { text: `逻辑线程 ${Number.isInteger(processors) && processors > 0 ? processors : '—'} · 跑分 ${score}`, tone: 'accent' },
            { text: `≈ Apple M4 × ${ratio.toFixed(2)}`, tone: 'value' },
          ] } : entry))
        } catch (error) {
          const text = controller.signal.aborted ? '跑分已停止。' : error instanceof Error ? error.message : '跑分失败，请重试。'
          setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, lines: [{ text, tone: controller.signal.aborted ? 'muted' : 'error' }] } : entry))
        } finally {
          taskAbort.current = null
          setCpuRunning(false)
        }
      }
      if (result.action?.type === 'httping') {
        const controller = new AbortController()
        taskAbort.current = controller
        setHttpingTarget(result.action.url)
        try {
          await runHttping(result.action, controller.signal, line => {
            setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, lines: [...entry.lines, line] } : entry))
          })
        } finally {
          taskAbort.current = null
          setHttpingTarget(null)
        }
      }
      if (result.action?.type === 'blog') openBlog(result.action.slug ?? null)
      if (result.action?.type === 'agent') {
        terminalScrollPosition.current = scrollRef.current?.scrollTop ?? 0
        setAgentOpen(true)
      }
      if (result.action?.type === 'game') openGames()
      if (result.action?.type === 'portal') {
        openPortal()
      }
      if (result.action?.type === 'edit') await openEditor(result.action.path)
      if (result.action?.type === 'python-repl') {
        replHistory.current = []
        replHistoryIndex.current = -1
        setReplMore(false)
        setReplOpen(true)
      }
      if (result.action?.type === 'theme-picker') {
        setPreviewTheme(localSystem.getState().settings.theme)
        setThemePickerOpen(true)
      }
    } catch (error) {
      setEntries((current) => [...current, { id: nextId.current++, command, path: pathAtCommand, lines: [{ text: error instanceof Error ? error.message : '操作失败。', tone: 'error' }] }])
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  function chooseImport(id: number, path: string) {
    importTarget.current = { id, path }
    if (importInputRef.current) {
      importInputRef.current.value = ''
      importInputRef.current.click()
    }
  }

  async function importSelected(files: FileList | null) {
    const target = importTarget.current
    importTarget.current = null
    if (!target || !files?.length || working.current) return
    working.current = true
    setBusy(true)
    try {
      const count = await localSystem.importFiles(Array.from(files), target.path)
      setEntries((current) => current.map((entry) => entry.id === target.id
        ? { ...entry, importPath: undefined, lines: [{ text: `已导入 ${count} 个文件到 ${target.path}`, tone: 'success' }] }
        : entry))
    } catch (error) {
      setEntries((current) => current.map((entry) => entry.id === target.id
        ? { ...entry, lines: [{ text: error instanceof Error ? error.message : '导入失败。', tone: 'error' }] }
        : entry))
    } finally {
      working.current = false
      setBusy(false)
      restorePromptFocus.current = true
    }
  }

  function exportFile(file: { name: string; content: string }) {
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function cycleCompletion(direction: number) {
    if (!completion) return
    const index = (completion.index + direction + completion.options.length) % completion.options.length
    setCompletion({ ...completion, index })
    setInput(completion.options[index])
  }

  async function completeInput(direction: number) {
    if (completion && input === completion.options[completion.index]) {
      cycleCompletion(direction)
      return
    }
    const base = input
    try {
      const options = await localSystem.complete(base)
      if (inputRef.current?.value !== base || options.length === 0) return
      if (options.length === 1) {
        setInput(options[0])
        setCompletion(null)
      } else {
        const index = direction < 0 ? options.length - 1 : 0
        setInput(options[index])
        setCompletion({ base, options, index })
      }
    } catch {
      setCompletion(null)
    }
  }

  function closeThemePicker() {
    restorePromptFocus.current = true
    setThemePickerOpen(false)
    setPreviewTheme(null)
  }

  function applyTheme(theme: ThemeName) {
    restorePromptFocus.current = true
    setThemePickerOpen(false)
    setPreviewTheme(theme)
    void runCommand(`theme ${theme}`, false).finally(() => setPreviewTheme(null))
  }

  function onThemePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault()
      setPreviewTheme(THEME_CHOICES[(themePickerIndex + THEME_CHOICES.length - 1) % THEME_CHOICES.length].name)
    } else if (event.key === 'ArrowDown' || event.key === 'Tab') {
      event.preventDefault()
      setPreviewTheme(THEME_CHOICES[(themePickerIndex + 1) % THEME_CHOICES.length].name)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      applyTheme(THEME_CHOICES[themePickerIndex].name)
    } else if (event.key === 'Escape' || event.key.toLowerCase() === 'q') {
      event.preventDefault()
      closeThemePicker()
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (replOpen) {
      onReplKeyDown(event)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void runCommand(input)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      void completeInput(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape' && completion) {
      event.preventDefault()
      setInput(completion.base)
      setCompletion(null)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (completion) { cycleCompletion(-1); return }
      if (!history.length) return
      if (historyIndex.current === -1) draftInput.current = input
      historyIndex.current = Math.max(0, historyIndex.current === -1 ? history.length - 1 : historyIndex.current - 1)
      setInput(history[historyIndex.current])
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (completion) { cycleCompletion(1); return }
      if (historyIndex.current === -1) return
      historyIndex.current += 1
      if (historyIndex.current >= history.length) {
        historyIndex.current = -1
        setInput(draftInput.current)
      } else setInput(history[historyIndex.current])
    }
  }

  async function submitReplLine(raw: string) {
    if (working.current) return
    const label = replMore ? '...' : '>>>'
    if (!replMore && /^(exit|quit)\(\)$/.test(raw.trim())) {
      void closeRepl(raw)
      return
    }
    working.current = true
    restorePromptFocus.current = true
    setBusy(true)
    setInput('')
    replHistoryIndex.current = -1
    replDraftInput.current = ''
    if (raw.trim()) replHistory.current.push(raw)
    const id = nextId.current++
    setEntries((current) => [...current, { id, command: raw, promptText: label, lines: [] }])
    try {
      const result = await localSystem.executePythonLine(raw)
      setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, lines: result.output } : entry))
      setReplMore(result.more)
    } catch (error) {
      setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, lines: [{ text: error instanceof Error ? error.message : 'Python 执行失败。', tone: 'error' }] } : entry))
      setReplOpen(false)
      setReplMore(false)
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function closeRepl(command = '') {
    if (working.current) return
    working.current = true
    restorePromptFocus.current = true
    setBusy(true)
    setInput('')
    setReplOpen(false)
    setReplMore(false)
    setEntries((current) => [...current, { id: nextId.current++, command, promptText: replMore ? '...' : '>>>', lines: [{ text: '已退出 Python。', tone: 'muted' }] }])
    try { await localSystem.endPythonRepl() }
    catch (error) {
      setEntries((current) => [...current, { id: nextId.current++, lines: [{ text: error instanceof Error ? error.message : '无法关闭 Python 会话。', tone: 'error' }] }])
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  function onReplKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitReplLine(input)
    } else if (event.key.toLowerCase() === 'd' && event.ctrlKey && !input) {
      event.preventDefault()
      void closeRepl()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const element = event.currentTarget
      const start = element.selectionStart ?? input.length
      const end = element.selectionEnd ?? start
      setInput((value) => `${value.slice(0, start)}    ${value.slice(end)}`)
      requestAnimationFrame(() => { element.selectionStart = element.selectionEnd = start + 4 })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!replHistory.current.length) return
      if (replHistoryIndex.current === -1) replDraftInput.current = input
      replHistoryIndex.current = Math.max(0, replHistoryIndex.current === -1 ? replHistory.current.length - 1 : replHistoryIndex.current - 1)
      setInput(replHistory.current[replHistoryIndex.current])
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (replHistoryIndex.current === -1) return
      replHistoryIndex.current += 1
      if (replHistoryIndex.current >= replHistory.current.length) {
        replHistoryIndex.current = -1
        setInput(replDraftInput.current)
      } else setInput(replHistory.current[replHistoryIndex.current])
    }
  }

  function closeEditor() {
    if (editorContent !== savedContent && !window.confirm('文件有未保存的更改，确定关闭吗？')) return
    restorePromptFocus.current = true
    setEditorPath(null)
    setEditorNotice('')
  }

  async function saveEditor() {
    if (!editorPath || saving) return
    setSaving(true)
    setEditorNotice('')
    try {
      await localSystem.saveFile(editorPath, editorContent)
      setSavedContent(editorContent)
      setEditorNotice('已保存')
    } catch (error) {
      setEditorNotice(error instanceof Error ? error.message : '保存失败。')
    } finally { setSaving(false) }
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void saveEditor()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeEditor()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const element = event.currentTarget
      if (!document.execCommand('insertText', false, '  ')) {
        element.setRangeText('  ', element.selectionStart, element.selectionEnd, 'end')
      }
      setEditorContent(element.value)
      setEditorNotice('')
    }
  }

  const dirty = editorContent !== savedContent
  const mode = cpuRunning ? 'benchmark' : httpingTarget ? 'httping' : gameOpen ? 'game' : agentOpen ? 'agent' : blogOpen ? 'blog' : portalOpen ? 'portal'
    : editorPath ? 'editor' : replOpen ? 'python' : themePickerOpen ? 'theme' : 'terminal'
  const status = startupError ? 'error' : !ready || busy ? 'busy' : 'ready'
  const editorStatus = editorPath ? (editorNotice && editorNotice !== '已保存' ? 'error' : dirty ? 'unsaved' : 'saved') : undefined

  return (
    <main onKeyDownCapture={onTerminalKeyDown} className="terminal" aria-label="终端" data-theme={displayedTheme} data-mode={mode} data-status={status} data-font={settings.font} data-custom-background={settings.background ? backgroundTone(settings.background) : undefined} style={{ fontSize: settings.fontSize, '--bg': settings.background ?? undefined } as CSSProperties}>
      {settings.backgroundImage && !blogOpen && !gameOpen && <div className="terminal-art" aria-hidden="true" />}
      {!gamePlaying && <header className="terminal-bar terminal-topbar">
        <span className="bar-brand"><i className="bar-square" /><span className="bar-title">{cpuRunning ? 'LSCPU / BENCHMARK' : httpingTarget ? `HTTPING / ${httpingTarget}` : blogOpen ? `BLOG / ${blogWelcome ? 'WELCOME' : currentPost?.title ?? 'ZED SYSTEM'}` : portalOpen ? 'ZED SYSTEM / PORTAL' : editorPath ? `EDIT / ${shortPath(editorPath)}` : replOpen ? `PYTHON / ${shortPath(cwd)}` : agentOpen ? `AGENT / ${shortPath(cwd)}` : 'ZED SYSTEM'}</span></span>
        <span className="bar-secondary" data-status={editorStatus} aria-live="polite">{cpuRunning ? '单线程 · 约 2 秒' : httpingTarget ? 'HTTP HEAD · 非 ICMP' : blogOpen ? (currentPost?.date || `${filterBlog(blogQuery).length} / ${blogPosts.length} POSTS`) : portalOpen ? `${portalCount} / 8 ${portalQuery.trim() ? 'MATCHES' : 'SITES'}` : editorPath ? editorNotice || (dirty ? 'UNSAVED' : 'SAVED') : replOpen ? (replMore ? 'CONTINUATION' : 'INTERACTIVE') : agentOpen ? agentStatus : `${themePickerOpen ? 'PREVIEW' : 'THEME'} / ${displayedTheme.toUpperCase()}${settings.font === 'pixel' ? ' · PIXEL' : ''}${settings.background ? ` · BG ${settings.background}` : ''} · ART ${settings.backgroundImage ? 'ON' : 'OFF'}`}</span>
      </header>}
      {blogOpen && <Blog query={blogQuery} slug={blogSlug} welcome={blogWelcome} onQueryChange={setBlogQuery} onOpen={setBlogSlug} onBack={() => setBlogSlug(null)} onBrowse={() => setBlogWelcome(false)} onHome={showBlogHome} onClose={closeBlog} />}
      {portalOpen && <Portal query={portalQuery} onQueryChange={setPortalQuery} onClose={closePortal} />}
      <div hidden={portalOpen || blogOpen} ref={scrollRef} className={`terminal-scroll ${gamePlaying ? 'game-host-playing' : ''} ${settings.wrapOutput ? 'wrap' : 'nowrap'}`} onScroll={onTerminalScroll} onClick={event => {
        if (editorPath || portalOpen || blogOpen || gameOpen || agentOpen || themePickerOpen || httpingTarget || cpuRunning) return
        if (!window.getSelection()?.isCollapsed) return
        if ((event.target as HTMLElement).closest('a, button, input, textarea, [contenteditable="true"]')) return
        inputRef.current?.focus({ preventScroll: true })
      }}>
        {entries.map((entry) => <div key={entry.id} hidden={gamePlaying} inert={gameOpen || agentOpen} className={`terminal-entry ${entry.command === '' ? 'empty-command' : ''} ${entry.themeCommand ? 'theme-command' : ''}`}>
          {entry.id === 0 && <section className="welcome-screen" aria-label="欢迎页面">
            <div className="welcome-artwork" role="img" aria-label="阿拉蕾和皮拉夫大王举着 Zed System 欢迎牌，署名 Designed by Zed Huang" />
          </section>}
          {entry.command !== undefined && <div className="submitted-command"><PromptPrefix path={entry.path || cwd} text={entry.promptText} /><span className="command-text">{entry.command}</span></div>}
          {entry.lines.map((line, index) => line.format === 'markdown'
            ? <MarkdownOutput key={index} content={line.text} />
            : <div key={index} className={`output-line ${line.tone || 'normal'}`}>{line.text || '\u00a0'}</div>)}
          {entry.importPath && <button className="terminal-action" disabled={busy} onClick={(event) => { event.stopPropagation(); chooseImport(entry.id, entry.importPath!) }}>选择文件导入</button>}
          {entry.exportFile && <button className="terminal-action" onClick={(event) => { event.stopPropagation(); exportFile(entry.exportFile!) }}>下载 {entry.exportFile.name}</button>}
        </div>)}

        <input ref={importInputRef} type="file" multiple hidden onChange={(event) => void importSelected(event.currentTarget.files)} />

        {editorPath && <div className="inline-editor" aria-label="文件编辑器">
          <textarea ref={editorRef} aria-label="文件内容" value={editorContent} onChange={(event) => { setEditorContent(event.target.value); setEditorNotice('') }} onKeyDown={onEditorKeyDown} spellCheck={false} />
          <div className="editor-actions">
            <span className="editor-status error">{editorNotice && editorNotice !== '已保存' ? editorNotice : ''}</span>
            <button onClick={() => void saveEditor()} disabled={!dirty || saving}>{saving ? '保存中…' : '保存'}</button>
            <button onClick={closeEditor}>关闭</button>
          </div>
        </div>}

        {themePickerOpen && <div ref={themePickerRef} className="theme-picker" role="listbox" aria-label="选择主题" tabIndex={0} onKeyDown={onThemePickerKeyDown}>
          {THEME_CHOICES.map((choice, index) => <button key={choice.name} role="option" aria-selected={index === themePickerIndex} className={`theme-row ${index === themePickerIndex ? 'selected' : ''}`} onClick={() => applyTheme(choice.name)} onMouseEnter={() => setPreviewTheme(choice.name)}>
            <span className="theme-row-label"><span className="theme-arrow">{index === themePickerIndex ? '›' : ' '}</span><span>{choice.label}</span></span>
            <span className="theme-swatches" aria-hidden="true">{choice.colors.map((color, colorIndex) => <i key={colorIndex} style={{ backgroundColor: color }} />)}</span>
          </button>)}
        </div>}

        {agentOpen && <AgentTerminal cwd={cwd} footerHost={agentFooter} onClose={closeAgent} onStatus={setAgentStatus} />}
        {gameOpen && <Games onClose={closeGames} onPlayingChange={setGamePlaying} footerHost={gameFooter} />}

        {ready && !gameOpen && !agentOpen && !cpuRunning && !httpingTarget && !editorPath && !themePickerOpen && <><div className="live-prompt"><PromptPrefix path={cwd} text={replOpen ? (replMore ? '...' : '>>>') : undefined} /><input ref={inputRef} aria-label={replOpen ? '输入 Python 代码' : '输入命令'} autoComplete="off" autoCapitalize="off" spellCheck={false} value={input} disabled={busy} onChange={(event) => { setInput(event.target.value); setCompletion(null) }} onKeyDown={onInputKeyDown} /></div>
          {completion && <div className="completion-list" aria-label="补全候选">{completion.options.map((option, index) => <button key={option} className={index === completion.index ? 'selected' : ''} onClick={() => { setInput(option); setCompletion(null); inputRef.current?.focus() }}><span>{index === completion.index ? '›' : ' '}</span>{option.trim()}</button>)}</div>}</>}
        {!ready && <div className="loading-state">{startupError || '正在打开本地工作区...'}</div>}
      </div>
      {gameOpen && !gamePlaying && <footer ref={setGameFooter} className="terminal-bar terminal-bottombar game-footer" />}
      {agentOpen && <footer ref={setAgentFooter} className="terminal-bar terminal-bottombar" />}
      {!gameOpen && !agentOpen && <footer className="terminal-bar terminal-bottombar">
        <span className="bar-brand"><i className="bar-square" /> {!ready ? 'LOADING' : busy ? 'RUNNING' : blogOpen ? 'BLOG' : portalOpen ? 'PORTAL' : editorPath ? 'EDIT' : replOpen ? 'PYTHON' : 'READY'}</span>
        {(httpingTarget || cpuRunning) ? <div className="portal-footer"><span className="bar-secondary">CTRL+C / ESC 停止 · TAB 选择停止</span><button ref={stopTaskRef} onClick={() => taskAbort.current?.abort()}>{cpuRunning ? '停止跑分' : '停止探测'}</button></div> : blogOpen ? <div className="portal-footer blog-footer"><span className="bar-secondary">{blogWelcome ? 'TAB / SHIFT TAB 循环 · ENTER 打开 · ESC 退出' : blogSlug ? 'TAB / SHIFT TAB 循环 · ↑↓ 翻页 · H 首页 · ESC 列表' : 'TAB / SHIFT TAB 循环 · / 搜索 · ↑↓ 选择 · ENTER 打开 · ESC 清空/退出'}</span>{blogSlug && <button className="blog-control" onClick={() => setBlogSlug(null)} title="Esc">文章列表</button>}{!blogWelcome && <button className="blog-control" onClick={showBlogHome} title="H">博客首页</button>}<button className="blog-control" onClick={closeBlog}>返回终端</button></div> : portalOpen ? <div className="portal-footer"><span className="bar-secondary">/ 搜索 · TAB 循环 · ↑↓←→ 选择 · 1–8 打开 · CTRL/⌘ ENTER 搜索 · ESC 返回</span><button onClick={closePortal} title="Esc / Alt+Shift+P">返回终端</button></div> : <span className="bar-secondary">{busy ? '正在执行命令…' : editorPath ? 'CTRL/⌘ S SAVE · ESC CLOSE' : replOpen ? (replMore ? '空行执行代码块 · CTRL+D 退出' : 'exit() / CTRL+D 退出 · ↑↓ HISTORY') : themePickerOpen ? '↑↓ SELECT · ENTER APPLY · ESC CLOSE' : completion ? 'TAB NEXT · ENTER RUN · ESC CLOSE' : 'HELP · TAB COMPLETE · ↑↓ HISTORY · ALT SHIFT P PORTAL'}</span>}
      </footer>}
    </main>
  )
}

export default App
