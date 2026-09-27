export interface PythonNode {
  path: string
  kind: 'file' | 'directory'
  content?: string
}

export type PythonRunRequest =
  | { kind: 'script'; source: string; cwd: string; nodes: PythonNode[]; loadPackages?: boolean; limitWorkspace?: boolean }
  | { kind: 'repl-start'; cwd: string; nodes: PythonNode[] }
  | { kind: 'repl-line'; line: string }
  | { kind: 'repl-end' }

export interface PythonRunResult {
  lines: string[]
  error?: string
  nodes?: PythonNode[]
  more?: boolean
}

type WorkerRequest = PythonRunRequest & { id: number }

interface WorkerResponse extends PythonRunResult {
  id: number
}

export class PythonRunner {
  private worker: Worker | null = null
  private nextId = 0
  private pending = new Map<number, { resolve: (result: PythonRunResult) => void; reject: (error: Error) => void }>()
  private queue: Promise<void> = Promise.resolve()
  private generation = 0

  run(request: PythonRunRequest, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<PythonRunResult> {
    const generation = this.generation
    const result = this.queue.then(() => {
      options.signal?.throwIfAborted()
      if (generation !== this.generation) throw new Error('Python 会话已重置。')
      return this.dispatch(request, options)
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  dispose(error = new Error('Python 会话已结束。')) {
    this.generation++
    this.worker?.terminate(); this.worker = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear(); this.queue = Promise.resolve()
  }

  private dispatch(request: PythonRunRequest, options: { signal?: AbortSignal; timeoutMs?: number }): Promise<PythonRunResult> {
    if (!this.worker) {
      const worker = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'classic' })
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, ...result } = event.data
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.resolve(result)
      }
      worker.onerror = (event) => {
        const error = new Error(event.message || 'Python 工作线程启动失败。')
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
        worker.terminate()
        if (this.worker === worker) this.worker = null
      }
      this.worker = worker
    }

    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
      const abort = () => this.dispose(new Error('Python 执行已停止。'))
      this.pending.set(id, { resolve: result => { cleanup(); resolve(result) }, reject: error => { cleanup(); reject(error) } })
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.timeoutMs) timer = setTimeout(() => this.dispose(new Error('Python 执行超时，工作线程已重置。')), options.timeoutMs)
      if (options.signal?.aborted) { abort(); return }
      try {
        this.worker!.postMessage({ ...request, id } satisfies WorkerRequest)
      } catch (error) {
        cleanup()
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

export const pythonRunner = new PythonRunner()
