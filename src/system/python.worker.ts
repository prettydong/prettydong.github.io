import type { PythonNode, PythonRunRequest, PythonRunResult } from './python'

interface PythonFileSystem {
  mkdirTree(path: string): void
  readdir(path: string): string[]
  lstat(path: string): { mode: number; size: number }
  isDir(mode: number): boolean
  isFile(mode: number): boolean
  unlink(path: string): void
  rmdir(path: string): void
  writeFile(path: string, content: string, options: { encoding: 'utf8' }): void
  readFile(path: string): Uint8Array
}

interface PyodideRuntime {
  FS: PythonFileSystem
  runPythonAsync(source: string): Promise<unknown>
  loadPackagesFromImports(source: string): Promise<void>
  setStdin(options: { error: boolean }): void
  setStdout(options: { batched: (text: string) => void }): void
  setStderr(options: { batched: (text: string) => void }): void
}

type WorkerRequest = PythonRunRequest & { id: number }

interface WorkerResponse extends PythonRunResult {
  id: number
}

const scope = self as unknown as {
  importScripts: (...urls: string[]) => void
  loadPyodide?: (options: { indexURL: string }) => Promise<PyodideRuntime>
  postMessage: (response: WorkerResponse) => void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

const HOME = '/workspace'
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'
const MAX_OUTPUT = 200_000
let runtimePromise: Promise<PyodideRuntime> | null = null
let replActive = false

function getRuntime(): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      scope.importScripts(`${PYODIDE_URL}pyodide.js`)
      if (!scope.loadPyodide) throw new Error('Pyodide 加载失败。')
      const runtime = await scope.loadPyodide({ indexURL: PYODIDE_URL })
      runtime.setStdin({ error: true })
      runtime.FS.mkdirTree(HOME)
      return runtime
    })().catch((error: unknown) => {
      runtimePromise = null
      throw error
    })
  }
  return runtimePromise
}

function clearDirectory(fs: PythonFileSystem, directory: string): void {
  for (const name of fs.readdir(directory)) {
    if (name === '.' || name === '..') continue
    const path = `${directory}/${name}`
    if (fs.isDir(fs.lstat(path).mode)) {
      clearDirectory(fs, path)
      fs.rmdir(path)
    } else fs.unlink(path)
  }
}

function populate(fs: PythonFileSystem, nodes: PythonNode[]): void {
  fs.mkdirTree(HOME)
  clearDirectory(fs, HOME)
  for (const entry of nodes.filter((item) => item.kind === 'directory').sort((a, b) => a.path.length - b.path.length)) {
    fs.mkdirTree(entry.path)
  }
  for (const entry of nodes.filter((item) => item.kind === 'file')) {
    fs.writeFile(entry.path, entry.content ?? '', { encoding: 'utf8' })
  }
}

function snapshot(fs: PythonFileSystem, limited = false): PythonNode[] {
  const nodes: PythonNode[] = [{ path: HOME, kind: 'directory' }]
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  const visit = (directory: string) => {
    for (const name of fs.readdir(directory)) {
      if (name === '.' || name === '..') continue
      if (limited && nodes.length >= 2000) throw new Error('Python 工作区最多支持 2000 个文件和目录。')
      const path = `${directory}/${name}`
      const { mode, size } = fs.lstat(path)
      if (fs.isDir(mode)) {
        nodes.push({ path, kind: 'directory' })
        visit(path)
      } else if (fs.isFile(mode)) {
        bytes += size
        if (limited && (size > 2 * 1024 * 1024 || bytes > 20 * 1024 * 1024)) throw new Error('Python 工作区超过限制：单文件 2 MB，总计 20 MB。')
        try {
          nodes.push({ path, kind: 'file', content: decoder.decode(fs.readFile(path)) })
        } catch {
          throw new Error(`仅支持 UTF-8 文本文件：${path}`)
        }
      } else throw new Error(`仅支持普通文件和目录：${path}`)
    }
  }
  visit(HOME)
  return nodes
}

async function prepare(runtime: PyodideRuntime, cwd: string, nodes: PythonNode[]): Promise<void> {
  await runtime.runPythonAsync("import os; os.chdir('/')")
  populate(runtime.FS, nodes)
  await runtime.runPythonAsync(`import os, sys\nsys.dont_write_bytecode = True\nos.chdir(${JSON.stringify(cwd)})\nif ${JSON.stringify(cwd)} not in sys.path:\n    sys.path.insert(0, ${JSON.stringify(cwd)})\nfor name, module in list(sys.modules.items()):\n    path = getattr(module, '__file__', None)\n    if isinstance(path, str) and path.startswith('/workspace/'):\n        del sys.modules[name]`)
}

async function run(request: WorkerRequest): Promise<WorkerResponse> {
  const { id } = request
  const lines: string[] = []
  let outputLength = 0
  let truncated = false
  let runtime: PyodideRuntime
  try {
    runtime = await getRuntime()
    if (request.kind === 'repl-end') {
      replActive = false
      await runtime.runPythonAsync("globals().pop('_zed_console', None); globals().pop('_zed_push', None)")
      return { id, lines }
    }
    if (request.kind === 'script' || request.kind === 'repl-start') {
      await prepare(runtime, request.cwd, request.nodes)
    }
    if (request.kind === 'repl-start') {
      await runtime.runPythonAsync(`import json\nfrom pyodide.console import Console, repr_shorten\n_zed_console = Console()\nasync def _zed_push(line):\n    future = _zed_console.push(line)\n    more = future.syntax_check == 'incomplete'\n    try:\n        value = await future\n        if value is not None:\n            print(repr_shorten(value))\n    except BaseException:\n        return json.dumps({'more': more, 'error': future.formatted_error or 'Python 执行失败。'})\n    return json.dumps({'more': more, 'error': None})`)
      replActive = true
      return { id, lines }
    }
    if (request.kind === 'repl-line' && !replActive) throw new Error('Python 交互会话未启动。')
  } catch (error) {
    return { id, lines, error: error instanceof Error ? error.message : String(error) }
  }

  const collect = (text: string) => {
    if (outputLength >= MAX_OUTPUT) {
      truncated = true
      return
    }
    const available = MAX_OUTPUT - outputLength
    const visible = text.slice(0, available)
    lines.push(...visible.split('\n'))
    outputLength += visible.length + 1
    if (visible.length < text.length) truncated = true
  }
  runtime.setStdout({ batched: collect })
  runtime.setStderr({ batched: collect })

  let error: string | undefined
  let more = false
  try {
    if (request.kind === 'script') {
      replActive = false
      if (request.loadPackages) await runtime.loadPackagesFromImports(request.source)
      await runtime.runPythonAsync(request.source)
    } else if (request.kind === 'repl-line') {
      const response = await runtime.runPythonAsync(`await _zed_push(${JSON.stringify(request.line)})`)
      const parsed = JSON.parse(String(response)) as { more: boolean; error: string | null }
      more = parsed.more
      error = parsed.error ?? undefined
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  if (truncated) lines.push('… 输出过长，已截断。')

  try {
    return { id, lines, error, more, nodes: snapshot(runtime.FS, request.kind === 'script' && request.limitWorkspace === true) }
  } catch (caught) {
    const snapshotError = caught instanceof Error ? caught.message : String(caught)
    return { id, lines, error: [error, `同步文件失败：${snapshotError}`].filter(Boolean).join('\n') }
  }
}

scope.onmessage = (event) => {
  void run(event.data)
    .then((result) => scope.postMessage(result))
    .catch((error: unknown) => scope.postMessage({
      id: event.data.id,
      lines: [],
      error: error instanceof Error ? error.message : String(error),
    }))
}
