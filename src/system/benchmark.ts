interface Sample { rate: number; checksum: number }
export interface BenchmarkResult { integer: Sample[]; floating: Sample[] }

export function runCpuBenchmark(signal: AbortSignal): Promise<BenchmarkResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已停止', 'AbortError')); return }
    const worker = new Worker(new URL('./benchmark.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => { cleanup(); reject(new DOMException('已停止', 'AbortError')) }
    const timeout = setTimeout(() => { cleanup(); reject(new Error('跑分超时，请保持页面在前台后重试。')) }, 10000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<BenchmarkResult>) => { cleanup(); resolve(event.data) }
    worker.onerror = () => { cleanup(); reject(new Error('跑分未能启动，请重试。')) }
    worker.postMessage(null)
  })
}

export function medianRate(samples: Sample[]) {
  return samples.map(sample => sample.rate).sort((a, b) => a - b)[Math.floor(samples.length / 2)]
}

// 2026-09-26: Apple M4, Chromium 154, median of three foreground runs.
// Same kernels as benchmark.worker.ts; this is a toy JS single-thread reference.
const M4_INTEGER = 620232704
const M4_FLOATING = 207159296

export function benchmarkScore(result: BenchmarkResult) {
  const ratio = Math.sqrt(medianRate(result.integer) / M4_INTEGER * medianRate(result.floating) / M4_FLOATING)
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('跑分结果无效，请重试。')
  return { score: Math.round(ratio * 1000), ratio }
}
