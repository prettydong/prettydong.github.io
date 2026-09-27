import type { OutputLine } from './index'

export interface HttpingOptions {
  url: string
  count: number
}

export function parseHttping(parameters: string[]): HttpingOptions {
  const usage = '用法：httping [-c 次数(1–20)] <域名或 HTTP(S) 网址>；ping 是别名。'
  let count = 4
  let address: string | undefined
  let countSet = false
  for (let index = 0; index < parameters.length; index += 1) {
    const value = parameters[index]
    if (value === '-c' && !countSet) {
      const rawCount = parameters[++index] ?? ''
      if (!/^\d+$/.test(rawCount) || Number(rawCount) < 1 || Number(rawCount) > 20) throw new Error(usage)
      count = Number(rawCount)
      countSet = true
    } else if (!address && !value.startsWith('-')) address = value
    else throw new Error(usage)
  }
  if (!address) throw new Error(usage)
  if (/\s|\\/.test(address) || /^[/?#]/.test(address)) throw new Error('网址无效，请输入域名或完整 HTTP(S) 网址。')
  const explicitProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(address)
  if (!explicitProtocol && /^(?:javascript|data|file|mailto):/i.test(address)) throw new Error('仅支持 HTTP(S) 网址。')
  let url: URL
  try { url = new URL(explicitProtocol ? address : `https://${address}`) }
  catch { throw new Error('网址无效，请输入域名或完整 HTTP(S) 网址。') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP(S) 网址。')
  if (url.username || url.password) throw new Error('网址不能包含用户名或密码。')
  url.hash = ''
  return { url: url.href, count }
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return }
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 1000)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export async function runHttping(options: HttpingOptions, signal: AbortSignal, emit: (line: OutputLine) => void): Promise<void> {
  const times: number[] = []
  let failed = 0
  let timedOut = 0
  let attempted = 0
  let cancelled = 0
  emit({ text: `HTTP HEAD ${options.url} · 请求耗时，非 ICMP`, tone: 'accent' })
  for (let seq = 1; seq <= options.count && !signal.aborted; seq += 1) {
    const request = new AbortController()
    const abort = () => request.abort()
    signal.addEventListener('abort', abort, { once: true })
    let timeout = false
    const timer = setTimeout(() => { timeout = true; request.abort() }, 5000)
    attempted += 1
    const started = performance.now()
    try {
      const response = await fetch(options.url, {
        method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: request.signal,
      })
      if (signal.aborted) { cancelled += 1; break }
      const elapsed = performance.now() - started
      times.push(elapsed)
      const status = response.type === 'opaque' ? '收到响应 · 跨域状态不可读' : `HTTP ${response.status}`
      emit({ text: `#${seq}  ${elapsed.toFixed(1)} ms  ${status}`, tone: response.type === 'opaque' ? 'info' : response.ok ? 'success' : 'error' })
    } catch {
      if (signal.aborted) { cancelled += 1; break }
      if (timeout) {
        timedOut += 1
        emit({ text: `#${seq}  超时（5 秒）`, tone: 'error' })
      } else {
        failed += 1
        emit({ text: `#${seq}  请求失败：网络或浏览器策略限制，不能据此判断目标离线。`, tone: 'error' })
      }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    if (seq < options.count && !signal.aborted) await pause(signal)
  }
  emit({ text: `${signal.aborted ? '已停止' : '探测完成'} · 已发起 ${attempted} · 收到响应 ${times.length} · 请求失败 ${failed} · 超时 ${timedOut} · 取消 ${cancelled}`, tone: 'muted' })
  if (times.length) {
    const average = times.reduce((total, time) => total + time, 0) / times.length
    emit({ text: `请求耗时 min / avg / max = ${Math.min(...times).toFixed(1)} / ${average.toFixed(1)} / ${Math.max(...times).toFixed(1)} ms`, tone: 'value' })
  }
}
