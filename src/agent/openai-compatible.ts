import type { AssistantMessage, ModelContext, StreamFn, ToolCall, TokenUsage } from './types.ts'
import { validateProviderCredentials, type ProviderCredentials } from './provider-vault.ts'

export function chatEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

function requestMessages(context: ModelContext, deepseek: boolean) {
  const messages: Record<string, unknown>[] = []
  if (context.systemPrompt) messages.push({ role: 'system', content: context.systemPrompt })
  for (const message of context.messages) {
    if (message.role === 'user') messages.push({ role: 'user', content: message.content })
    else if (message.role === 'toolResult') messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content.map(part => part.text).join('\n') })
    else {
      const calls = message.content.filter((part): part is ToolCall => part.type === 'toolCall')
      messages.push({ role: 'assistant', content: message.content.filter(part => part.type === 'text').map(part => part.text).join('') || null,
        ...(deepseek && context.tools.length ? { reasoning_content: message.reasoning ?? '' } : {}),
        ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) })
    }
  }
  return messages
}

/** SSE frames may span fetch chunks, UTF-8 code points and CRLF boundaries. */
async function* eventData(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let match: RegExpExecArray | null
      while ((match = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const data = frame.split(/\r\n|\n|\r/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
        if (data) yield data
      }
      if (buffer.length > 2_000_000) throw new Error('模型返回的数据帧过大。')
      if (done) break
    }
    if (buffer.trim()) throw new Error('模型数据流未完整结束。')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

type Delta = { content?: string | null; refusal?: string | null; reasoning_content?: string | null; tool_calls?: { index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[] }
type Chunk = { error?: unknown; usage?: unknown; choices?: { index: number; delta?: Delta; finish_reason?: string | null }[] }

/** Usage is cumulative within a response; never sum repeated streaming snapshots. */
export function parseTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return
  const value = raw as Record<string, unknown>
  const count = (n: unknown): number | undefined => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined
  const inputTokens = count(value.prompt_tokens), outputTokens = count(value.completion_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return
  const totalTokens = count(value.total_tokens) ?? inputTokens + outputTokens
  if (!Number.isSafeInteger(totalTokens) || totalTokens !== inputTokens + outputTokens) return
  const inputDetails = value.prompt_tokens_details as Record<string, unknown> | null
  const outputDetails = value.completion_tokens_details as Record<string, unknown> | null
  const cached = count(value.prompt_cache_hit_tokens) ?? count(inputDetails?.cached_tokens)
  const uncached = count(value.prompt_cache_miss_tokens)
  const reasoning = count(outputDetails?.reasoning_tokens)
  return { inputTokens, outputTokens, totalTokens,
    ...(cached !== undefined && cached <= inputTokens ? { cachedInputTokens: cached } : {}),
    ...(uncached !== undefined && uncached <= inputTokens ? { uncachedInputTokens: uncached } : {}),
    ...(reasoning !== undefined && reasoning <= outputTokens ? { reasoningTokens: reasoning } : {}) }
}

/** Chat Completions transport; the agent core remains provider independent. */
export function createOpenAICompatibleStream(credentials: ProviderCredentials, fetcher: typeof fetch = fetch): StreamFn {
  const config = validateProviderCredentials(credentials)
  const deepseek = new URL(config.baseUrl).hostname === 'api.deepseek.com'
  return async function* (context, { signal, inference = {} }) {
    const settings = { ...inference }
    if (settings.reasoningEffort !== undefined && !['none', 'low', 'high', 'max'].includes(settings.reasoningEffort)) throw new Error('思考强度无效。')
    if (settings.maxOutputTokens !== undefined && (!Number.isSafeInteger(settings.maxOutputTokens) || settings.maxOutputTokens < 256 || settings.maxOutputTokens > 65536)) throw new Error('输出上限需在 256–65536 tokens 之间。')
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const message: AssistantMessage = { role: 'assistant', content: [], stopReason: 'stop', timestamp: Date.now(), model: config.model,
      inference: { ...settings, ...(deepseek ? { reasoningEffort: settings.reasoningEffort ?? 'none' } : {}) }, timing: { durationMs: 0 } }
    const started = performance.now()
    const markToken = () => { message.timing!.firstTokenMs ??= Math.max(0, performance.now() - started) }
    const calls = new Map<number, { id: string; name: string; arguments: string }>()
    let text = '', finish: string | undefined
    const snapshot = (): AssistantMessage => ({ ...message, timing: { ...message.timing!, durationMs: Math.max(0, performance.now() - started) }, content: [...(text ? [{ type: 'text' as const, text }] : []),
      ...Array.from(calls.values(), call => ({ type: 'toolCall' as const, id: call.id, name: call.name, arguments: call.arguments }))] })
    try {
      signal.throwIfAborted()
      yield { type: 'start', partial: snapshot() }
      signal.throwIfAborted()
      let response: Response
      try {
        response = await fetcher(chatEndpoint(config.baseUrl), {
          method: 'POST', signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages: requestMessages(context, deepseek), stream: true, stream_options: { include_usage: true },
            ...(settings.maxOutputTokens !== undefined ? { max_tokens: settings.maxOutputTokens } : {}),
            ...(deepseek ? { thinking: { type: !settings.reasoningEffort || settings.reasoningEffort === 'none' ? 'disabled' : 'enabled' },
              ...(settings.reasoningEffort && settings.reasoningEffort !== 'none' ? { reasoning_effort: settings.reasoningEffort } : {}) }
              : settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
            ...(context.tools.length ? { tools: context.tools.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto' } : {}) }),
        })
      } catch {
        signal.throwIfAborted()
        throw new Error('无法连接模型接口，请检查地址、网络及服务端 CORS 设置。')
      }
      if (!response.ok) {
        await response.body?.cancel()
        // Never surface a server body that might echo Authorization or other secrets.
        throw new Error(response.status === 401 || response.status === 403 ? `模型接口鉴权失败（HTTP ${response.status}）。`
          : response.status === 429 ? '模型接口额度不足或请求过于频繁（HTTP 429）。' : `模型接口请求失败（HTTP ${response.status}）。`)
      }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel(); throw new Error('模型接口未返回 SSE 流，请确认支持 Chat Completions 流式调用。')
      }
      for await (const data of eventData(response.body, controller.signal)) {
        if (data.trim() === '[DONE]') break
        let chunk: Chunk
        try { chunk = JSON.parse(data) } catch { throw new Error('模型返回了无效的流式数据。') }
        if (!chunk || chunk.error) throw new Error('模型接口返回错误。')
        const usage = parseTokenUsage(chunk.usage)
        if (usage) { message.usage = usage; yield { type: 'usage', partial: snapshot() } }
        if (!Array.isArray(chunk.choices)) throw new Error('模型返回了无效的 choices。')
        const choice = chunk.choices.find(item => item.index === 0)
        if (!choice) continue // Optional usage chunks have an empty choices array.
        if (finish) throw new Error('模型在结束标记后继续返回内容。')
        const delta = choice.delta ?? {}
        if (delta.reasoning_content != null && typeof delta.reasoning_content !== 'string') throw new Error('模型思考内容格式无效。')
        if (delta.reasoning_content) {
          markToken(); message.reasoning = (message.reasoning ?? '') + delta.reasoning_content
          yield { type: 'reasoning_delta', delta: delta.reasoning_content, partial: snapshot() }
        }
        if (delta.content != null && typeof delta.content !== 'string') throw new Error('模型文本格式无效。')
        const addition = delta.content || delta.refusal || ''
        if (typeof addition !== 'string') throw new Error('模型文本格式无效。')
        if (addition) { markToken(); text += addition; yield { type: 'text_delta', delta: addition, partial: snapshot() } }
        if (delta.tool_calls) {
          markToken()
          if (!Array.isArray(delta.tool_calls)) throw new Error('工具调用格式无效。')
          for (const part of delta.tool_calls) {
            if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 127 || (part.type && part.type !== 'function')) throw new Error('工具调用格式无效。')
            const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' }
            for (const value of [part.id, part.function?.name, part.function?.arguments]) if (value != null && typeof value !== 'string') throw new Error('工具调用格式无效。')
            call.id += part.id ?? ''; call.name += part.function?.name ?? ''; call.arguments += part.function?.arguments ?? ''
            if (call.arguments.length > 2_000_000) throw new Error('工具参数过大。')
            calls.set(part.index, call)
          }
          yield { type: 'toolcall_delta', partial: snapshot() }
        }
        if (choice.finish_reason != null) finish = choice.finish_reason
      }
      signal.throwIfAborted()
      if (!finish) throw new Error('模型数据流提前中断，请重试。')
      if (!['stop', 'tool_calls', 'length'].includes(finish)) throw new Error(finish === 'content_filter' ? '模型接口过滤了本次输出。' : '模型返回了不支持的结束原因。')
      if ((calls.size && finish === 'stop') || (!calls.size && finish === 'tool_calls')) throw new Error('工具调用与结束标记不一致。')
      message.content = text ? [{ type: 'text', text }] : []
      const ids = new Set<string>()
      for (const call of calls.values()) {
        if (finish === 'length') continue // Never execute truncated argument JSON.
        if (!call.id || !call.name || ids.has(call.id)) throw new Error('工具调用缺少标识或标识重复。')
        ids.add(call.id)
        let args: unknown
        try { args = JSON.parse(call.arguments) } catch { throw new Error('工具参数不是完整的 JSON。') }
        message.content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: args })
      }
      message.stopReason = finish === 'tool_calls' ? 'toolUse' : finish === 'length' ? 'length' : 'stop'
      message.timing = { ...message.timing!, durationMs: Math.max(0, performance.now() - started) }
      if (finish === 'length') message.errorMessage = '输出达到长度上限，未执行截断的工具调用。'
      yield { type: 'done', message }
    } finally { signal.removeEventListener('abort', abort); controller.abort() }
  }
}
