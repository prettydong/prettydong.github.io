import { blogPosts } from '../blog-content'
import { diskUsage } from './storage'
import { parseHttping, type HttpingOptions } from './httping'
import { pythonRunner, type PythonNode, type PythonRunResult } from './python'

export type NodeKind = 'file' | 'directory'
export type ThemeName = 'codex' | 'monokai' | 'claude'
export type FontName = 'mono' | 'pixel'

export interface FileNode {
  path: string
  parent: string | null
  name: string
  kind: NodeKind
  content?: string
  modifiedAt: number
}

export interface Settings {
  fontSize: number
  wrapOutput: boolean
  theme: ThemeName
  font: FontName
  background: string | null
  backgroundImage: boolean
}

export interface SystemState {
  cwd: string
  history: string[]
  settings: Settings
}

export interface OutputLine {
  text: string
  tone?: 'normal' | 'muted' | 'error' | 'success' | 'accent' | 'info' | 'value' | 'label'
  format?: 'markdown'
}

export interface CommandResult {
  cwd: string
  history: string[]
  output: OutputLine[]
  action?: { type: 'benchmark' } | ({ type: 'httping' } & HttpingOptions) | { type: 'edit'; path: string } | { type: 'portal' } | { type: 'game' } | { type: 'agent' } | { type: 'blog'; slug?: string } | { type: 'clear' } | { type: 'reboot' } | { type: 'theme-picker' } | { type: 'python-repl' }
    | { type: 'import'; path: string } | { type: 'export'; name: string; content: string }
}

const DB_NAME = 'terminal-workbench-v1'
const DB_VERSION = 1
const HOME = '/workspace'
const LEGACY_WELCOME = '# 欢迎来到 Terminal\n\n这是一个保存在浏览器中的本地工作台。\n输入 help 查看可用命令，试试 cd projects 或 edit README.md。\n'
const WELCOME_MARKDOWN = `# Zed System / 工作区指南

> 一切从一行命令开始。**文件留在浏览器里**，页面刷新后继续工作。

这里是一个带颜色的 Markdown 展示页：试试 **粗体**、*斜体*、~~删除线~~、\`行内代码\`，以及 [Markdown 语法说明](https://www.markdownguide.org/basic-syntax/)。

## 01 · 快速开始

1. 输入 \`ls\` 查看工作区。
2. 输入 \`edit README.md\` 修改这份文件，按 \`Ctrl/⌘ S\` 保存。
3. 输入 \`cat README.md\` 查看渲染结果。

### 今天的小目标

- [x] 打开终端
- [ ] 创建第一份笔记：\`touch notes/today.md\`
- [ ] 切换主题：\`theme\`，再输入 \`font pixel\` 看像素字体

## 02 · 命令速览

| 命令 | 用途 | 例子 |
| :--- | :--- | :--- |
| \`cat\` | 阅读文件；Markdown 自动渲染 | \`cat README.md\` |
| \`edit\` | 打开内置编辑器 | \`edit notes/today.md\` |
| \`python\` | 进入交互式 Python | \`python\` |
| \`font\` | 切换终端字体 | \`font pixel\` |
| \`background\` | 切换右下角剪纸 | \`background off\` |

## 03 · 代码也有颜色

\`\`\`python
def greet(name: str) -> str:
    message = f"你好，{name}!"
    return message

print(greet("Zed"))
\`\`\`

\`\`\`typescript
type Theme = 'codex' | 'monokai' | 'claude'
const palette: Record<Theme, string> = {
  codex: '#438d73',
  monokai: '#a6e22e',
  claude: '#d97757',
}
\`\`\`

---

> **提示**：输入 \`help\` 查看简短命令索引；输入 \`theme\` 预览主题。编辑后的内容只保存在这台浏览器中。
`
const DEFAULT_SETTINGS: Settings = { fontSize: 15, wrapOutput: true, theme: 'claude', font: 'mono', background: null, backgroundImage: true }
const THEMES: ThemeName[] = ['codex', 'monokai', 'claude']
const FONTS: FontName[] = ['mono', 'pixel']
const THEME_ALIASES: Record<string, ThemeName> = { monaka: 'monokai' }
const THEME_INPUTS = [...THEMES, ...Object.keys(THEME_ALIASES)]
const COMMANDS = ['reboot', 'blog', 'game', 'agent', 'df', 'lscpu', 'httping', 'ping', 'portal', 'nav', 'help', 'pwd', 'ls', 'tree', 'cd', 'cat', 'head', 'tail', 'wc', 'stat', 'mkdir', 'touch', 'edit', 'cp', 'mv', 'rm', 'grep', 'find', 'import', 'export', 'echo', 'date', 'history', 'python', 'python3', 'py', 'set', 'theme', 'font', 'background', 'clear']
const PYTHON_COMMANDS = ['python', 'python3', 'py']
const MAX_SEARCH_RESULTS = 200
const MAX_IMPORT_BYTES = 2 * 1024 * 1024

function fileTone(entry: FileNode): OutputLine['tone'] {
  return entry.kind === 'directory' ? 'info' : 'normal'
}

class FileSystemError extends Error {}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('nodes')) {
        const nodes = database.createObjectStore('nodes', { keyPath: 'path' })
        nodes.createIndex('parent', 'parent', { unique: false })
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('本地数据库被其他页面占用，请关闭其他标签后重试。'))
  })
}

function normalizePath(input: string, cwd: string): string {
  const source = input === '~' ? HOME : input.startsWith('~/') ? `${HOME}/${input.slice(2)}` : input
  const parts = (source.startsWith('/') ? source : `${cwd}/${source}`).split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return `/${normalized.join('/')}`
}

function basename(path: string): string {
  return path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1)
}

function parentPath(path: string): string | null {
  if (path === '/') return null
  const index = path.lastIndexOf('/')
  return index === 0 ? '/' : path.slice(0, index)
}

function inWorkspace(path: string): boolean {
  return path === HOME || path.startsWith(`${HOME}/`)
}

function normalizeTheme(value: unknown): ThemeName | null {
  if (typeof value !== 'string') return null
  if (THEMES.includes(value as ThemeName)) return value as ThemeName
  return THEME_ALIASES[value] ?? null
}

function normalizeBackground(value: unknown): string | null {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value.toLowerCase() : null
}

function tokenize(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (let i = 0; i < input.length; i += 1) {
    const character = input[i]
    if (character === '\\' && i + 1 < input.length && quote !== "'") {
      const next = input[i + 1]
      if (quote !== '"' || next === '"' || next === '\\') {
        current += next
        i += 1
      } else current += character
      started = true
    } else if (character === '"' || character === "'") {
      if (quote === character) quote = null
      else if (!quote) { quote = character; started = true }
      else current += character
    } else if (/\s/.test(character) && !quote) {
      if (started) { args.push(current); current = ''; started = false }
    } else {
      current += character
      started = true
    }
  }
  if (quote) throw new FileSystemError('引号没有闭合。')
  if (started) args.push(current)
  return args
}

function node(path: string, kind: NodeKind, content?: string): FileNode {
  return { path, parent: parentPath(path), name: basename(path), kind, content, modifiedAt: Date.now() }
}

function textLines(content: string): string[] {
  if (!content) return []
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function lineCount(value: string, usage: string, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new FileSystemError(`用法：${usage}（数量为 0 到 ${maximum}）`)
  const count = Number(value)
  if (count > maximum) throw new FileSystemError(`数量不能超过 ${maximum}。`)
  return count
}

export class LocalSystem {
  private database: IDBDatabase | null = null
  private cwd = HOME
  private history: string[] = []
  private settings: Settings = { ...DEFAULT_SETTINGS }
  private pythonReplActive = false

  async initialize(): Promise<SystemState> {
    if (this.database) return this.getState()
    this.database = await openDatabase()
    const transaction = this.database.transaction(['nodes', 'meta'], 'readwrite')
    const nodes = transaction.objectStore('nodes')
    const meta = transaction.objectStore('meta')
    const initialized = await requestResult<boolean | undefined>(meta.get('initialized'))
    if (!initialized) {
      for (const entry of [
        node('/', 'directory'),
        node(HOME, 'directory'),
        node(`${HOME}/projects`, 'directory'),
        node(`${HOME}/notes`, 'directory'),
        node(`${HOME}/README.md`, 'file', WELCOME_MARKDOWN),
        node(`${HOME}/notes/ideas.txt`, 'file', '从这里开始记录想法。\n'),
      ]) nodes.put(entry)
      meta.put(HOME, 'cwd')
      meta.put([], 'history')
      meta.put(DEFAULT_SETTINGS, 'settings')
      meta.put(true, 'initialized')
    }
    await transactionDone(transaction)

    // Replace only the untouched first-version example; preserve user edits.
    if (initialized) {
      const welcome = await this.getNode(`${HOME}/README.md`)
      if (welcome?.kind === 'file' && welcome.content === LEGACY_WELCOME) {
        const update = this.db().transaction('nodes', 'readwrite')
        update.objectStore('nodes').put({ ...welcome, content: WELCOME_MARKDOWN, modifiedAt: Date.now() })
        await transactionDone(update)
      }
    }

    const saved = this.database.transaction('meta', 'readonly').objectStore('meta')
    const [cwd, history, settings] = await Promise.all([
      requestResult<string | undefined>(saved.get('cwd')),
      requestResult<string[] | undefined>(saved.get('history')),
      requestResult<Settings | undefined>(saved.get('settings')),
    ])
    this.cwd = cwd || HOME
    this.history = Array.isArray(history) ? history : []
    const theme = normalizeTheme(settings?.theme) ?? DEFAULT_SETTINGS.theme
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      theme,
      font: settings?.font === 'pixel' ? 'pixel' : 'mono',
      background: normalizeBackground(settings?.background),
      backgroundImage: typeof settings?.backgroundImage === 'boolean' ? settings.backgroundImage : DEFAULT_SETTINGS.backgroundImage,
    }
    if (!(await this.getNode(this.cwd)) || (await this.getNode(this.cwd))?.kind !== 'directory') {
      this.cwd = HOME
      await this.setMeta('cwd', HOME)
    }
    return this.getState()
  }

  getState(): SystemState {
    return { cwd: this.cwd, history: [...this.history], settings: { ...this.settings } }
  }

  private db(): IDBDatabase {
    if (!this.database) throw new Error('系统尚未初始化。')
    return this.database
  }

  private async setMeta(key: string, value: unknown): Promise<void> {
    const transaction = this.db().transaction('meta', 'readwrite')
    transaction.objectStore('meta').put(value, key)
    await transactionDone(transaction)
  }

  private async getNode(path: string): Promise<FileNode | undefined> {
    const transaction = this.db().transaction('nodes', 'readonly')
    return requestResult<FileNode | undefined>(transaction.objectStore('nodes').get(path))
  }

  private async requireNode(path: string): Promise<FileNode> {
    const entry = await this.getNode(path)
    if (!entry) throw new FileSystemError(`路径不存在：${path}`)
    return entry
  }

  private async requireDirectory(path: string): Promise<FileNode> {
    const entry = await this.requireNode(path)
    if (entry.kind !== 'directory') throw new FileSystemError(`不是目录：${path}`)
    return entry
  }

  async listNodes(): Promise<FileNode[]> {
    const transaction = this.db().transaction('nodes', 'readonly')
    return requestResult<FileNode[]>(transaction.objectStore('nodes').getAll())
  }

  async readFile(path: string): Promise<string> {
    const normalized = normalizePath(path, this.cwd)
    const entry = await this.requireNode(normalized)
    if (entry.kind !== 'file') throw new FileSystemError(`不是文件：${normalized}`)
    return entry.content || ''
  }

  async saveFile(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path, this.cwd)
    const entry = await this.requireNode(normalized)
    if (entry.kind !== 'file') throw new FileSystemError(`不是文件：${normalized}`)
    const transaction = this.db().transaction('nodes', 'readwrite')
    transaction.objectStore('nodes').put({ ...entry, content, modifiedAt: Date.now() })
    await transactionDone(transaction)
  }

  /** Atomic browser-workspace write for agent tools; never touches the host filesystem. */
  async writeFile(path: string, content: string, options: { signal?: AbortSignal; expectedContent?: string | null } = {}): Promise<void> {
    const normalized = normalizePath(path, this.cwd)
    if (!normalized.startsWith(`${HOME}/`) || content.includes('\0')) throw new FileSystemError('无效的工作区文本文件。')
    if (new TextEncoder().encode(content).length > MAX_IMPORT_BYTES) throw new FileSystemError('文件超过 2 MB。')
    options.signal?.throwIfAborted()
    const transaction = this.db().transaction('nodes', 'readwrite')
    const done = transactionDone(transaction)
    // Observe the transaction immediately, including validation-triggered aborts.
    void done.catch(() => {})
    const abort = () => { try { transaction.abort() } catch { /* Already committed or aborted. */ } }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      const store = transaction.objectStore('nodes')
      const [existing, parent] = await Promise.all([
        requestResult<FileNode | undefined>(store.get(normalized)),
        requestResult<FileNode | undefined>(store.get(parentPath(normalized)!)),
      ])
      options.signal?.throwIfAborted()
      if (parent?.kind !== 'directory') throw new FileSystemError('父目录不存在。')
      if (existing?.kind === 'directory') throw new FileSystemError('目标是目录。')
      if (options.expectedContent === null && existing) throw new FileSystemError('文件已存在，请读取后修改。')
      if (typeof options.expectedContent === 'string' && (!existing || (existing.content ?? '') !== options.expectedContent)) throw new FileSystemError('文件已发生变化，请重新读取后修改。')
      store.put(node(normalized, 'file', content))
      await done
    } catch (error) { abort(); throw error }
    finally { options.signal?.removeEventListener('abort', abort) }
  }

  async ensureDirectory(path: string, signal?: AbortSignal): Promise<void> {
    const normalized = normalizePath(path, HOME)
    if (!inWorkspace(normalized) || /[\0\\]/.test(path)) throw new FileSystemError('目录必须位于工作区。')
    signal?.throwIfAborted()
    const transaction = this.db().transaction('nodes', 'readwrite')
    const done = transactionDone(transaction); void done.catch(() => {})
    const abort = () => { try { transaction.abort() } catch { /* Settled. */ } }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const store = transaction.objectStore('nodes')
      const parts = normalized.split('/').filter(Boolean)
      for (let index = 1; index <= parts.length; index++) {
        const current = `/${parts.slice(0, index).join('/')}`
        const existing = await requestResult<FileNode | undefined>(store.get(current))
        signal?.throwIfAborted()
        if (existing && existing.kind !== 'directory') throw new FileSystemError(`路径不是目录：${current}`)
        if (!existing) store.add(node(current, 'directory'))
      }
      await done
    } catch (error) { abort(); throw error }
    finally { signal?.removeEventListener('abort', abort) }
  }

  /** Commit an agent Python snapshot atomically; never overwrite concurrent workspace edits. */
  async applyPythonChanges(before: PythonNode[], after: PythonNode[], signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted()
    const previous = new Map(before.map(entry => [entry.path, entry]))
    const next = new Map<string, PythonNode>()
    if (after.length > 2000) throw new FileSystemError('Python 工作区最多支持 2000 个文件和目录。')
    let bytes = 0
    for (const entry of after) {
      if (!inWorkspace(entry.path) || normalizePath(entry.path, HOME) !== entry.path || /[\0\\]/.test(entry.path)
        || next.has(entry.path) || !['file', 'directory'].includes(entry.kind)) throw new FileSystemError('Python 返回了无效的文件路径。')
      if (entry.kind === 'file') {
        if (typeof entry.content !== 'string' || entry.content.includes('\0')) throw new FileSystemError('Python 仅同步 UTF-8 文本文件。')
        const size = new TextEncoder().encode(entry.content).length
        bytes += size
        if (size > MAX_IMPORT_BYTES || bytes > 20 * 1024 * 1024) throw new FileSystemError('Python 文件超出大小限制。')
      }
      next.set(entry.path, entry)
    }
    if (next.get(HOME)?.kind !== 'directory') throw new FileSystemError('Python 工作区目录无效。')
    for (const entry of next.values()) {
      if (entry.path !== HOME && next.get(parentPath(entry.path)!)?.kind !== 'directory') throw new FileSystemError('Python 文件父目录无效。')
    }
    for (const entry of previous.values()) {
      if (next.get(entry.path)?.kind !== entry.kind) throw new FileSystemError('Python 不支持删除、移动或改变已有文件的类型。')
    }
    const changes = [...next.values()].filter(entry => {
      const old = previous.get(entry.path)
      return !old || (entry.kind === 'file' && old.content !== entry.content)
    })
    if (!changes.length) return []
    const transaction = this.db().transaction('nodes', 'readwrite')
    const done = transactionDone(transaction); void done.catch(() => {})
    const abort = () => { try { transaction.abort() } catch { /* Settled. */ } }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const store = transaction.objectStore('nodes')
      const actual = (await requestResult<FileNode[]>(store.getAll())).filter(entry => inWorkspace(entry.path))
      signal.throwIfAborted()
      if (actual.length !== previous.size || actual.some(entry => {
        const old = previous.get(entry.path)
        return !old || old.kind !== entry.kind || (entry.kind === 'file' && (old.content ?? '') !== (entry.content ?? ''))
      })) throw new FileSystemError('Python 执行期间工作区已变化，未保存结果，请重新执行。')
      for (const entry of changes) store.put(node(entry.path, entry.kind, entry.content))
      await done
      return changes.map(entry => entry.path)
    } catch (error) { abort(); throw error }
    finally { signal.removeEventListener('abort', abort) }
  }

  async importFiles(files: File[], directory: string): Promise<number> {
    await this.requireDirectory(directory)
    if (!files.length) return 0
    const existing = new Set((await this.listNodes()).map((entry) => entry.path))
    const incoming: FileNode[] = []
    const decoder = new TextDecoder('utf-8', { fatal: true })
    for (const file of files) {
      if (!file.name || file.name === '.' || file.name === '..' || /[\\/]/.test(file.name)) throw new FileSystemError(`无效文件名：${file.name}`)
      if (file.size > MAX_IMPORT_BYTES) throw new FileSystemError(`文件超过 2 MB：${file.name}`)
      const path = `${directory === '/' ? '' : directory}/${file.name}`
      if (existing.has(path)) throw new FileSystemError(`路径已存在：${path}`)
      existing.add(path)
      let content: string
      try { content = decoder.decode(await file.arrayBuffer()) }
      catch { throw new FileSystemError(`仅支持 UTF-8 文本文件：${file.name}`) }
      if (content.includes('\0')) throw new FileSystemError(`仅支持文本文件：${file.name}`)
      incoming.push(node(path, 'file', content))
    }
    const transaction = this.db().transaction('nodes', 'readwrite')
    const store = transaction.objectStore('nodes')
    for (const entry of incoming) store.add(entry)
    await transactionDone(transaction)
    return incoming.length
  }

  private async copyOrMove(source: string, destination: string, move: boolean): Promise<string> {
    const sourceNode = await this.requireNode(source)
    if (source === '/' || source === HOME) throw new FileSystemError('不能复制或移动工作区根目录。')
    const destinationNode = await this.getNode(destination)
    const finalPath = destinationNode?.kind === 'directory' ? `${destination === '/' ? '' : destination}/${sourceNode.name}` : destination
    if (finalPath === source || (sourceNode.kind === 'directory' && finalPath.startsWith(`${source}/`))) {
      throw new FileSystemError('目标不能是源路径或其子目录。')
    }
    await this.requireDirectory(parentPath(finalPath)!)
    const nodes = await this.listNodes()
    const existing = new Set(nodes.map((entry) => entry.path))
    const subtree = nodes.filter((entry) => entry.path === source || entry.path.startsWith(`${source}/`))
    const replacements = subtree.map((entry) => ({ ...entry, path: `${finalPath}${entry.path.slice(source.length)}` }))
    if (replacements.some((entry) => existing.has(entry.path))) throw new FileSystemError(`目标路径已存在：${finalPath}`)
    const nextCwd = move && (this.cwd === source || this.cwd.startsWith(`${source}/`))
      ? `${finalPath}${this.cwd.slice(source.length)}` : this.cwd
    const transaction = this.db().transaction(move ? ['nodes', 'meta'] : ['nodes'], 'readwrite')
    const store = transaction.objectStore('nodes')
    if (move) for (const entry of subtree) store.delete(entry.path)
    for (const entry of replacements) store.add({ ...entry, parent: parentPath(entry.path), name: basename(entry.path), modifiedAt: Date.now() })
    if (nextCwd !== this.cwd) transaction.objectStore('meta').put(nextCwd, 'cwd')
    await transactionDone(transaction)
    this.cwd = nextCwd
    return finalPath
  }

  private async removePath(path: string, recursive: boolean): Promise<number> {
    const entry = await this.requireNode(path)
    if (path === '/' || path === HOME) throw new FileSystemError('不能删除工作区根目录。')
    if (this.cwd === path || this.cwd.startsWith(`${path}/`)) throw new FileSystemError('不能删除当前目录或其上级目录。')
    if (entry.kind === 'directory' && !recursive) throw new FileSystemError('删除目录请使用 rm -r <路径>。')
    const subtree = (await this.listNodes()).filter((item) => item.path === path || item.path.startsWith(`${path}/`))
    const transaction = this.db().transaction('nodes', 'readwrite')
    const store = transaction.objectStore('nodes')
    for (const item of subtree) store.delete(item.path)
    await transactionDone(transaction)
    return subtree.length
  }

  private async syncPythonNodes(before: FileNode[], after: PythonNode[]): Promise<void> {
    const previous = new Map<string, FileNode>(before.filter((entry) => inWorkspace(entry.path)).map((entry) => [entry.path, entry]))
    const current = new Map<string, PythonNode>()
    for (const entry of after) {
      if (!inWorkspace(entry.path) || current.has(entry.path)) throw new FileSystemError('Python 返回了无效的文件路径。')
      current.set(entry.path, entry)
    }
    if (current.get(HOME)?.kind !== 'directory') throw new FileSystemError('Python 工作区目录无效。')

    const transaction = this.db().transaction('nodes', 'readwrite')
    const store = transaction.objectStore('nodes')
    for (const path of previous.keys()) {
      if (path !== HOME && !current.has(path)) store.delete(path)
    }
    for (const entry of current.values()) {
      const existing = previous.get(entry.path)
      if (!existing || existing.kind !== entry.kind || (entry.kind === 'file' && (existing.content ?? '') !== (entry.content ?? ''))) {
        store.put(node(entry.path, entry.kind, entry.kind === 'file' ? entry.content ?? '' : undefined))
      }
    }
    await transactionDone(transaction)
  }

  private async pythonOutput(before: FileNode[], result: PythonRunResult): Promise<OutputLine[]> {
    const output: OutputLine[] = result.lines.map((text) => ({ text }))
    if (result.error) output.push({ text: result.error, tone: 'error' })
    if (result.nodes) {
      try { await this.syncPythonNodes(before, result.nodes) }
      catch (error) { output.push({ text: `同步文件失败：${error instanceof Error ? error.message : String(error)}`, tone: 'error' }) }
    }
    return output
  }

  async executePythonLine(line: string): Promise<{ output: OutputLine[]; more: boolean }> {
    if (!this.pythonReplActive) throw new FileSystemError('Python 交互会话未启动。')
    const before = await this.listNodes()
    let result: PythonRunResult
    try { result = await pythonRunner.run({ kind: 'repl-line', line }) }
    catch (error) {
      this.pythonReplActive = false
      throw error
    }
    return { output: await this.pythonOutput(before, result), more: result.more ?? false }
  }

  async endPythonRepl(): Promise<void> {
    if (!this.pythonReplActive) return
    this.pythonReplActive = false
    await pythonRunner.run({ kind: 'repl-end' })
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const fontSize = patch.fontSize ?? this.settings.fontSize
    this.settings = {
      fontSize: Math.min(18, Math.max(11, Math.round(fontSize))),
      wrapOutput: patch.wrapOutput ?? this.settings.wrapOutput,
      theme: normalizeTheme(patch.theme ?? this.settings.theme) ?? DEFAULT_SETTINGS.theme,
      font: patch.font ?? this.settings.font,
      background: patch.background === undefined ? this.settings.background : normalizeBackground(patch.background),
      backgroundImage: patch.backgroundImage ?? this.settings.backgroundImage,
    }
    await this.setMeta('settings', this.settings)
    return { ...this.settings }
  }

  async complete(input: string): Promise<string[]> {
    const leading = input.match(/^\s*/)?.[0] ?? ''
    const rest = input.slice(leading.length)
    const match = /^(\S*)(\s*)([\s\S]*)$/.exec(rest)
    if (!match) return []
    const [, command, spaces, argument] = match
    if (!spaces) return COMMANDS.filter((name) => name.startsWith(command)).map((name) => `${leading}${name} `)

    const prefix = `${leading}${command}${spaces}`
    if (command === 'blog') {
      return blogPosts.filter(post => post.slug.startsWith(argument)).map(post => `${prefix}${JSON.stringify(post.slug)}`)
    }
    if (command === 'theme') {
      if (/\s/.test(argument)) return []
      return THEME_INPUTS.filter((name) => name.startsWith(argument)).map((name) => `${prefix}${name}`)
    }
    if (command === 'font') {
      if (/\s/.test(argument)) return []
      return FONTS.filter((name) => name.startsWith(argument)).map((name) => `${prefix}${name}`)
    }
    if (command === 'background') {
      if (/\s/.test(argument)) return []
      return ['on', 'off'].filter((option) => option.startsWith(argument)).map((option) => `${prefix}${option}`)
    }
    if (command === 'set') {
      const options = argument.startsWith('font ') ? Array.from({ length: 8 }, (_, index) => `font ${index + 11}`)
        : argument.startsWith('wrap ') ? ['wrap on', 'wrap off']
          : argument.startsWith('background ') ? ['background default']
            : ['font ', 'wrap ', 'background ']
      return options.filter((option) => option.startsWith(argument)).map((option) => `${prefix}${option}`)
    }
    if (!['ls', 'tree', 'cd', 'cat', 'head', 'tail', 'wc', 'stat', 'mkdir', 'touch', 'edit', 'cp', 'mv', 'rm', 'find', 'grep', 'import', 'export', ...PYTHON_COMMANDS].includes(command)) return []
    if (PYTHON_COMMANDS.includes(command) && argument.startsWith('-')) return []

    let pathPrefix = prefix
    let pathArgument = argument
    if (command === 'rm' && argument.startsWith('-r ')) {
      pathPrefix += '-r '
      pathArgument = argument.slice(3)
    } else if (['head', 'tail'].includes(command) && /^-n\s+\d+\s+/.test(argument)) {
      const option = /^(-n\s+\d+\s+)(.*)$/.exec(argument)!
      pathPrefix += option[1]
      pathArgument = option[2]
    } else if (['cp', 'mv', 'grep'].includes(command)) {
      const second = /^((?:"(?:\\.|[^"])*"|'[^']*'|\S+)\s+)(.*)$/.exec(argument)
      if (second) {
        pathPrefix += second[1]
        pathArgument = second[2]
      } else if (command === 'grep') return []
    }

    const quote = pathArgument.startsWith('"') || pathArgument.startsWith("'") ? pathArgument[0] : null
    if (!quote && /\s/.test(pathArgument)) return []
    const typed = quote ? pathArgument.slice(1).replace(new RegExp(`${quote}$`), '') : pathArgument
    const slash = typed.lastIndexOf('/')
    const folder = slash >= 0 ? typed.slice(0, slash + 1) : ''
    const fragment = slash >= 0 ? typed.slice(slash + 1) : typed
    const parent = normalizePath(folder || '.', this.cwd)
    const directory = await this.getNode(parent)
    if (directory?.kind !== 'directory') return []

    return (await this.listNodes())
      .filter((entry) => entry.parent === parent && entry.name.startsWith(fragment)
        && (!['cd', 'import'].includes(command) || entry.kind === 'directory')
        && (!['export', 'head', 'tail', 'wc'].includes(command) || entry.kind === 'file')
        && (!PYTHON_COMMANDS.includes(command) || entry.kind === 'directory' || entry.name.endsWith('.py')))
      .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
      .map((entry) => {
        const path = `${folder}${entry.name}${entry.kind === 'directory' ? '/' : ''}`
        const rendered = quote || /\s/.test(path) ? `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : path
        return `${pathPrefix}${rendered}`
      })
  }

  async execute(input: string): Promise<CommandResult> {
    const trimmed = input.trim()
    if (!trimmed) return { cwd: this.cwd, history: [...this.history], output: [] }
    this.history = [...this.history, trimmed].slice(-80)
    await this.setMeta('history', this.history)
    try {
      const args = tokenize(trimmed)
      const [command, ...parameters] = args
      const target = (value: string) => normalizePath(value, this.cwd)
      const exactly = (count: number, usage: string) => {
        if (parameters.length !== count) throw new FileSystemError(`用法：${usage}`)
      }
      let output: OutputLine[] = []
      let action: CommandResult['action']

      switch (command) {
        case 'df':
          exactly(0, 'df')
          output = await diskUsage()
          break
        case 'lscpu':
          exactly(0, 'lscpu')
          action = { type: 'benchmark' }
          break
        case 'httping':
        case 'ping':
          action = { type: 'httping', ...parseHttping(parameters) }
          break
        case 'reboot':
          exactly(0, 'reboot')
          action = { type: 'reboot' }
          break
        case 'blog':
          if (parameters.length > 1) throw new FileSystemError('用法：blog [文章名]')
          if (parameters[0] && !blogPosts.some(post => post.slug === parameters[0])) throw new FileSystemError(`文章不存在：${parameters[0]}`)
          action = { type: 'blog', slug: parameters[0] }
          break
        case 'agent':
          exactly(0, 'agent')
          action = { type: 'agent' }
          break
        case 'game':
          exactly(0, 'game')
          action = { type: 'game' }
          break
        case 'portal':
        case 'nav':
          exactly(0, command)
          action = { type: 'portal' }
          break
        case 'help': {
          exactly(0, 'help')
          output = [
            { text: 'ZED / COMMANDS', tone: 'accent' },
            { text: '文件   ls  tree  cd  pwd  cat  head  tail  wc  stat' },
            { text: '管理   edit  touch  mkdir  cp  mv  rm' },
            { text: '查找   find [路径] [名称]  ·  grep <文本> [路径]' },
            { text: '传输   import [目录]  ·  export <文件>' },
            { text: '运行   python [文件.py]  ·  python -c "代码"' },
            { text: '外观   theme  font  background on/off  set' },
            { text: '网络   httping [-c 次数] <网址>  ·  ping（HTTP 探测别名）' },
            { text: '博客   blog [文章名]  ·  / 搜索  ·  Tab/Shift+Tab 选择  ·  Esc 返回' },
            { text: '助手   agent  ·  Enter 发送  ·  Shift+Enter 换行  ·  Tab 切换  ·  Esc 停止/返回' },
            { text: '游戏   game  ·  ↑↓ 选择  ·  Enter 开始  ·  Tab/Shift+Tab 切换  ·  Esc 返回' },
            { text: '导航   portal  ·  nav' },
            { text: '其他   lscpu  df  echo  date  history  clear  reboot  help' },
            { text: 'Tab 补全 · ↑↓ 历史 · cat README.md 查看示例', tone: 'muted' },
          ]
          break
        }
        case 'pwd':
          exactly(0, 'pwd')
          output = [{ text: this.cwd, tone: 'info' }]
          break
        case 'ls': {
          if (parameters.length > 1) throw new FileSystemError('用法：ls [路径]')
          const path = target(parameters[0] || '.')
          const entry = await this.requireNode(path)
          if (entry.kind === 'file') {
            output = [{ text: entry.name, tone: fileTone(entry) }]
          } else {
            const children = (await this.listNodes()).filter((item) => item.parent === path)
              .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1))
            output = children.length ? children.map((item) => ({ text: item.kind === 'directory' ? `${item.name}/` : item.name, tone: fileTone(item) })) : [{ text: '(空目录)', tone: 'muted' }]
          }
          break
        }
        case 'tree': {
          if (parameters.length > 1) throw new FileSystemError('用法：tree [路径]')
          const path = target(parameters[0] || '.')
          const root = await this.requireNode(path)
          output = [{ text: `${path}${root.kind === 'directory' && path !== '/' ? '/' : ''}`, tone: fileTone(root) }]
          if (root.kind === 'directory') {
            const children = new Map<string, FileNode[]>()
            for (const entry of await this.listNodes()) {
              if (!entry.parent) continue
              const group = children.get(entry.parent) ?? []
              group.push(entry)
              children.set(entry.parent, group)
            }
            for (const group of children.values()) group.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
            let shown = 0
            let truncated = false
            const visit = (directory: string, indent: string) => {
              const group = children.get(directory) ?? []
              for (const [index, entry] of group.entries()) {
                if (shown >= MAX_SEARCH_RESULTS) { truncated = true; return }
                const last = index === group.length - 1
                output.push({ text: `${indent}${last ? '└── ' : '├── '}${entry.name}${entry.kind === 'directory' ? '/' : ''}`, tone: fileTone(entry) })
                shown += 1
                if (entry.kind === 'directory') visit(entry.path, `${indent}${last ? '    ' : '│   '}`)
                if (truncated) return
              }
            }
            visit(path, '')
            if (truncated) output.push({ text: `仅显示前 ${MAX_SEARCH_RESULTS} 项。`, tone: 'muted' })
          }
          break
        }
        case 'cd': {
          if (parameters.length > 1) throw new FileSystemError('用法：cd [路径]')
          const path = target(parameters[0] || HOME)
          await this.requireDirectory(path)
          this.cwd = path
          await this.setMeta('cwd', path)
          break
        }
        case 'cat': {
          exactly(1, 'cat <文件>')
          const content = await this.readFile(parameters[0])
          output = /\.(?:md|markdown)$/i.test(parameters[0])
            ? [{ text: content, format: 'markdown' }]
            : content.split(/\r?\n/).map((text) => ({ text }))
          break
        }
        case 'head':
        case 'tail': {
          const usage = `${command} [-n 数量] <文件>`
          const withCount = parameters[0] === '-n'
          if (parameters.length !== (withCount ? 3 : 1)) throw new FileSystemError(`用法：${usage}`)
          const count = withCount ? lineCount(parameters[1], usage, MAX_SEARCH_RESULTS) : 10
          const lines = textLines(await this.readFile(parameters[withCount ? 2 : 0]))
          output = (command === 'head' ? lines.slice(0, count) : count ? lines.slice(-count) : []).map((text) => ({ text }))
          break
        }
        case 'wc': {
          exactly(1, 'wc <文件>')
          const content = await this.readFile(parameters[0])
          const words = content.trim() ? content.trim().split(/\s+/u).length : 0
          output = [{ text: `${textLines(content).length} 行  ${words} 词  ${Array.from(content).length} 字符  ${new TextEncoder().encode(content).length} 字节  ${target(parameters[0])}`, tone: 'value' }]
          break
        }
        case 'stat': {
          exactly(1, 'stat <路径>')
          const path = target(parameters[0])
          const entry = await this.requireNode(path)
          output = [
            { text: `路径：${path}`, tone: 'info' },
            { text: `类型：${entry.kind === 'directory' ? '目录' : '文件'}`, tone: 'label' },
            ...(entry.kind === 'file' ? [{ text: `大小：${new TextEncoder().encode(entry.content ?? '').length} 字节`, tone: 'value' as const }] : []),
            { text: `修改：${new Date(entry.modifiedAt).toLocaleString('zh-CN')}`, tone: 'value' },
          ]
          break
        }
        case 'mkdir':
        case 'touch': {
          exactly(1, `${command} <路径>`)
          const path = target(parameters[0])
          if (path === '/') throw new FileSystemError('根目录已经存在。')
          const parent = parentPath(path)
          if (!parent) throw new FileSystemError('无效路径。')
          await this.requireDirectory(parent)
          const existing = await this.getNode(path)
          if (existing) {
            if (command === 'touch' && existing.kind === 'file') {
              const transaction = this.db().transaction('nodes', 'readwrite')
              transaction.objectStore('nodes').put({ ...existing, modifiedAt: Date.now() })
              await transactionDone(transaction)
              output = [{ text: `已更新 ${path}`, tone: 'success' }]
              break
            }
            throw new FileSystemError(`路径已存在：${path}`)
          }
          const transaction = this.db().transaction('nodes', 'readwrite')
          transaction.objectStore('nodes').add(node(path, command === 'mkdir' ? 'directory' : 'file', command === 'touch' ? '' : undefined))
          await transactionDone(transaction)
          output = [{ text: `已创建 ${path}`, tone: 'success' }]
          break
        }
        case 'edit': {
          exactly(1, 'edit <文件>')
          const path = target(parameters[0])
          await this.readFile(path)
          action = { type: 'edit', path }
          output = [{ text: `已打开 ${path}`, tone: 'success' }]
          break
        }
        case 'cp':
        case 'mv': {
          exactly(2, `${command} <源路径> <目标路径>`)
          const destination = await this.copyOrMove(target(parameters[0]), target(parameters[1]), command === 'mv')
          output = [{ text: `${command === 'mv' ? '已移动' : '已复制'}到 ${destination}`, tone: 'success' }]
          break
        }
        case 'rm': {
          const recursive = parameters[0] === '-r'
          if (parameters.length !== (recursive ? 2 : 1)) throw new FileSystemError('用法：rm [-r] <路径>')
          const path = target(parameters[recursive ? 1 : 0])
          const count = await this.removePath(path, recursive)
          output = [{ text: `已删除 ${path}${count > 1 ? `（${count} 项）` : ''}`, tone: 'success' }]
          break
        }
        case 'find': {
          if (parameters.length > 2) throw new FileSystemError('用法：find [路径] [名称片段]')
          const path = target(parameters[0] || '.')
          const root = await this.requireNode(path)
          const name = parameters[1] || ''
          const matches = (root.kind === 'file' ? [root] : (await this.listNodes()).filter((entry) => entry.path !== path && entry.path.startsWith(`${path === '/' ? '' : path}/`)))
            .filter((entry) => entry.name.includes(name))
            .sort((a, b) => a.path.localeCompare(b.path))
          output = matches.slice(0, MAX_SEARCH_RESULTS).map((entry) => ({ text: `${entry.path}${entry.kind === 'directory' ? '/' : ''}` }))
          if (!matches.length) output = [{ text: '未找到匹配路径。', tone: 'muted' }]
          if (matches.length > MAX_SEARCH_RESULTS) output.push({ text: `仅显示前 ${MAX_SEARCH_RESULTS} 项。`, tone: 'muted' })
          break
        }
        case 'grep': {
          if (parameters.length < 1 || parameters.length > 2) throw new FileSystemError('用法：grep <文本> [路径]')
          const path = target(parameters[1] || '.')
          const root = await this.requireNode(path)
          const files = root.kind === 'file' ? [root] : (await this.listNodes()).filter((entry) => entry.kind === 'file' && entry.path.startsWith(`${path === '/' ? '' : path}/`))
          output = []
          let total = 0
          for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
            for (const [index, line] of (file.content ?? '').split(/\r?\n/).entries()) {
              if (line.includes(parameters[0])) {
                total += 1
                if (output.length < MAX_SEARCH_RESULTS) output.push({ text: `${file.path}:${index + 1}:${line}` })
              }
            }
          }
          if (!total) output = [{ text: '未找到匹配内容。', tone: 'muted' }]
          if (total > MAX_SEARCH_RESULTS) output.push({ text: `仅显示前 ${MAX_SEARCH_RESULTS} 项。`, tone: 'muted' })
          break
        }
        case 'import': {
          if (parameters.length > 1) throw new FileSystemError('用法：import [目录]')
          const path = target(parameters[0] || '.')
          await this.requireDirectory(path)
          action = { type: 'import', path }
          break
        }
        case 'export': {
          exactly(1, 'export <文件>')
          const path = target(parameters[0])
          const content = await this.readFile(path)
          action = { type: 'export', name: basename(path), content }
          break
        }
        case 'echo':
          output = [{ text: parameters.join(' ') }]
          break
        case 'date':
          exactly(0, 'date')
          output = [{ text: new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'medium', timeZoneName: 'short' }), tone: 'value' }]
          break
        case 'history': {
          if (parameters.length > 1) throw new FileSystemError('用法：history [数量]')
          const count = parameters.length ? lineCount(parameters[0], 'history [数量]', 80) : 20
          const start = Math.max(0, this.history.length - count)
          output = this.history.slice(start).map((item, index) => ({ text: `${start + index + 1}  ${item}` }))
          break
        }
        case 'python':
        case 'python3':
        case 'py': {
          if (!inWorkspace(this.cwd)) throw new FileSystemError('Python 当前只能在 /workspace 下运行。')
          if (parameters.length === 0) {
            const before = await this.listNodes()
            const result = await pythonRunner.run({
              kind: 'repl-start',
              cwd: this.cwd,
              nodes: before.filter((entry) => inWorkspace(entry.path)).map(({ path, kind, content }) => ({ path, kind, content })),
            })
            output = await this.pythonOutput(before, result)
            if (!result.error) {
              this.pythonReplActive = true
              action = { type: 'python-repl' }
              output.unshift({ text: 'Python / Pyodide', tone: 'label' })
            }
            break
          }
          let source: string
          if (parameters.length === 2 && parameters[0] === '-c') source = parameters[1]
          else if (parameters.length === 1 && parameters[0] !== '-c') {
            const path = target(parameters[0])
            if (!inWorkspace(path)) throw new FileSystemError('Python 文件必须位于 /workspace 下。')
            source = await this.readFile(path)
          } else throw new FileSystemError("用法：python <文件.py> 或 python -c '代码'")

          const before = await this.listNodes()
          const result = await pythonRunner.run({
            kind: 'script',
            source,
            cwd: this.cwd,
            nodes: before.filter((entry) => inWorkspace(entry.path)).map(({ path, kind, content }) => ({ path, kind, content })),
          })
          output = await this.pythonOutput(before, result)
          break
        }
        case 'set': {
          if (parameters.length === 0) {
            output = [{ text: `font ${this.settings.fontSize}` }, { text: `wrap ${this.settings.wrapOutput ? 'on' : 'off'}` }, { text: `background ${this.settings.background ?? 'default'}` }]
          } else if (parameters.length === 2 && parameters[0] === 'font') {
            const size = Number(parameters[1])
            if (!Number.isInteger(size) || size < 11 || size > 18) throw new FileSystemError('字号必须是 11 到 18 之间的整数。')
            await this.updateSettings({ fontSize: size })
            output = [{ text: `font ${size}`, tone: 'success' }]
          } else if (parameters.length === 2 && parameters[0] === 'wrap' && ['on', 'off'].includes(parameters[1])) {
            await this.updateSettings({ wrapOutput: parameters[1] === 'on' })
            output = [{ text: `wrap ${parameters[1]}`, tone: 'success' }]
          } else if (parameters.length === 1 && parameters[0] === 'background') {
            output = [{ text: `background ${this.settings.background ?? 'default'}` }]
          } else if (parameters.length === 2 && parameters[0] === 'background') {
            const background = parameters[1] === 'default' ? null : normalizeBackground(parameters[1])
            if (parameters[1] !== 'default' && !background) throw new FileSystemError('背景色请输入 #RGB、#RRGGBB 或 default。')
            await this.updateSettings({ background })
            output = [{ text: `background ${background ?? 'default'}`, tone: 'success' }]
          } else throw new FileSystemError('用法：set [font <11-18> | wrap <on|off> | background <颜色|default>]')
          break
        }
        case 'theme': {
          const theme = parameters.length === 1 ? normalizeTheme(parameters[0]) : null
          if (parameters.length === 0) {
            action = { type: 'theme-picker' }
          } else if (theme) {
            await this.updateSettings({ theme })
            output = [{ text: `已切换到 ${theme} 主题`, tone: 'success' }]
          } else throw new FileSystemError(`用法：theme [${THEME_INPUTS.join('|')}]`)
          break
        }
        case 'font': {
          if (parameters.length === 0) {
            output = [{ text: `font ${this.settings.font}（可选：${FONTS.join(' / ')}）` }]
          } else if (parameters.length === 1 && FONTS.includes(parameters[0] as FontName)) {
            const font = parameters[0] as FontName
            await this.updateSettings({ font })
            output = [{ text: `font ${font}`, tone: 'success' }]
          } else throw new FileSystemError('用法：font [mono|pixel]')
          break
        }
        case 'background': {
          if (parameters.length === 0) {
            output = [{ text: `background ${this.settings.backgroundImage ? 'on' : 'off'}` }]
          } else if (parameters.length === 1 && ['on', 'off'].includes(parameters[0])) {
            const backgroundImage = parameters[0] === 'on'
            await this.updateSettings({ backgroundImage })
            output = [{ text: `background ${parameters[0]}`, tone: 'success' }]
          } else throw new FileSystemError('用法：background [on|off]')
          break
        }
        case 'clear':
          exactly(0, 'clear')
          action = { type: 'clear' }
          break
        default:
          throw new FileSystemError(`未知命令：${command}。输入 help 查看可用命令。`)
      }
      return { cwd: this.cwd, history: [...this.history], output, action }
    } catch (error) {
      return { cwd: this.cwd, history: [...this.history], output: [{ text: error instanceof Error ? error.message : '命令执行失败。', tone: 'error' }] }
    }
  }
}

export const localSystem = new LocalSystem()
