import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptProvider, decryptProvider, validateProviderCredentials } from '../src/agent/provider-vault.ts'
import { createOpenAICompatibleStream, chatEndpoint, parseTokenUsage } from '../src/agent/openai-compatible.ts'
import { summarizeUsage } from '../src/agent/telemetry.ts'
import { Agent, defineTool, textResult } from '../src/agent/index.ts'

const credentials = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-only-secret' }
const password = 'qa-pass8'
const context = { systemPrompt: 'test', messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools: [] }
const chunk = (delta = {}, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] })
const sse = (chunks, done = true) => chunks.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : '')
function response(source, step = 7) {
  const bytes = new TextEncoder().encode(source)
  let offset = 0
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) return controller.close()
    controller.enqueue(bytes.slice(offset, offset += step))
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
async function collect(stream, ctx = context, signal = new AbortController().signal) {
  const events = []
  for await (const event of stream(ctx, { signal })) events.push(event)
  return events
}

test('encrypted provider round-trip; random salt/IV; wrong passwords and tampering rejected', async () => {
  const a = await encryptProvider(credentials, password), b = await encryptProvider(credentials, password)
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext)
  assert.ok(!JSON.stringify(a).includes(credentials.apiKey)); assert.ok(!JSON.stringify(a).includes(password))
  assert.deepEqual(await decryptProvider(a, password), credentials)
  await assert.rejects(decryptProvider(a, 'incorrect'), /密码错误/)
  const bytes = Buffer.from(a.ciphertext, 'base64'); bytes[0] ^= 1
  await assert.rejects(decryptProvider({ ...a, ciphertext: bytes.toString('base64') }, password), /密码错误/)
  await assert.rejects(decryptProvider({ ...a, iterations: 1 }, password), /格式无效/)
  await assert.rejects(encryptProvider(credentials, 'short'), /8/)
})

test('provider URLs preserve service prefixes and reject insecure or credential-bearing endpoints', () => {
  assert.equal(chatEndpoint('https://example.com/v1/'), 'https://example.com/v1/chat/completions')
  assert.equal(chatEndpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions')
  for (const baseUrl of ['http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret', 'javascript:alert(1)']) {
    assert.throws(() => validateProviderCredentials({ ...credentials, baseUrl }))
  }
  assert.equal(validateProviderCredentials({ ...credentials, baseUrl: 'http://localhost:8000/v1' }).baseUrl, 'http://localhost:8000/v1')
})

test('UTF-8 and CRLF split streaming; request shape, no cookies/redirects, DeepSeek thinking disabled', async () => {
  let request
  const stream = createOpenAICompatibleStream(credentials, async (url, init) => {
    request = { url, ...init, json: JSON.parse(init.body) }
    return response(': keepalive\r\n\r\n' + sse([chunk({ content: '你好' }), chunk({ content: ' world' }), chunk({}, 'stop'), { choices: [], usage: {} }]), 1)
  })
  const events = await collect(stream)
  assert.equal(events.at(-1).message.content[0].text, '你好 world')
  assert.equal(events[1].partial.content[0].text, '你好')
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(request.headers.Authorization, `Bearer ${credentials.apiKey}`)
  assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error')
  assert.deepEqual(request.json.thinking, { type: 'disabled' })
  assert.equal(request.json.tools, undefined)
  let generic
  await collect(createOpenAICompatibleStream({ ...credentials, baseUrl: 'https://example.com/v1' }, async (_url, init) => {
    generic = JSON.parse(init.body); return response(sse([chunk({}, 'stop')]))
  }))
  assert.equal(generic.thinking, undefined)
})

test('fragmented tool calls round-trip through Agent to a second HTTP request', async () => {
  const requests = []; let executed = 0
  const tool = defineTool({ name: 'echo', description: 'echo', parameters: { type: 'object', properties: { text: { type: 'string' } } },
    parseArguments: args => { assert.equal(typeof args.text, 'string'); return args },
    execute: async (_id, args) => { executed++; return textResult(args.text) } })
  const streamFn = createOpenAICompatibleStream(credentials, async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return response(requests.length === 1 ? sse([
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"te' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'xt":"hello"}' } }] }), chunk({}, 'tool_calls'),
    ]) : sse([chunk({ content: 'complete' }), chunk({}, 'stop')]))
  })
  const agent = new Agent({ streamFn, tools: [tool] })
  assert.equal((await agent.prompt('go')).reason, 'stop')
  assert.equal(executed, 1); assert.equal(requests.length, 2)
  assert.equal(requests[0].tools[0].function.name, 'echo')
  assert.deepEqual(requests[1].messages.at(-1), { role: 'tool', content: 'hello', tool_call_id: 'call_1' })
  assert.equal(requests[1].messages.at(-2).tool_calls[0].function.arguments, '{"text":"hello"}')
})

test('malformed or incomplete tool streams cannot execute tools', async () => {
  const call = argumentsText => chunk({ tool_calls: [{ index: 0, id: 'one', type: 'function', function: { name: 'echo', arguments: argumentsText } }] })
  for (const source of [sse([call('{')]), sse([call('{'), chunk({}, 'tool_calls')]), sse([call('{}'), chunk({}, 'stop')]), sse([call('{}'), chunk({}, 'content_filter')])]) {
    const stream = createOpenAICompatibleStream(credentials, async () => response(source))
    await assert.rejects(collect(stream))
  }
  const truncated = await collect(createOpenAICompatibleStream(credentials, async () => response(sse([call('{'), chunk({}, 'length')]))))
  assert.equal(truncated.at(-1).message.stopReason, 'length')
  assert.deepEqual(truncated.at(-1).message.content, [])
})

test('HTTP/stream errors do not echo secret-bearing server messages', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(collect(createOpenAICompatibleStream(credentials, async () => new Response(credentials.apiKey, { status }))), error => {
      assert.ok(error.message.includes(String(status))); assert.ok(!error.message.includes(credentials.apiKey)); return true
    })
  }
  await assert.rejects(collect(createOpenAICompatibleStream(credentials, async () => response(sse([{ error: { message: credentials.apiKey } }])))), /模型接口返回错误/)
  await assert.rejects(collect(createOpenAICompatibleStream(credentials, async () => new Response('{}'))), /SSE/)
})

test('cancellation aborts fetch and iterator return cancels the response reader', async () => {
  const controller = new AbortController(); let fetchSignal
  let markStarted; const started = new Promise(resolve => { markStarted = resolve })
  const waiting = collect(createOpenAICompatibleStream(credentials, async (_url, init) => {
    fetchSignal = init.signal; markStarted()
    return await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  }), context, controller.signal)
  await started; controller.abort()
  await assert.rejects(waiting, { name: 'AbortError' }); assert.equal(fetchSignal.aborted, true)
  let canceled = false
  const stream = createOpenAICompatibleStream(credentials, async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(sse([chunk({ content: 'one' })], false))) }, cancel() { canceled = true },
  }), { headers: { 'Content-Type': 'text/event-stream' } }))
  for await (const event of stream(context, { signal: new AbortController().signal })) if (event.type === 'text_delta') break
  assert.equal(canceled, true)
})

test('reasoning deltas and all prior assistant reasoning round-trip through tool and user turns', async () => {
  const requests = [], updates = []; let turn = 0
  const adapter = createOpenAICompatibleStream(credentials, async (_url, init) => {
    requests.push(JSON.parse(init.body)); turn++
    const deltas = [chunk({ reasoning_content: `思考 ${turn}：` }), chunk({ reasoning_content: '检查工具结果。' })]
    if (turn === 1) deltas.push(chunk({ tool_calls: [{ index: 0, id: 'echo-1', type: 'function', function: { name: 'echo', arguments: '{}' } }] }))
    else deltas.push(chunk({ content: `answer ${turn}` }))
    deltas.push({ ...chunk({}, turn === 1 ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 100 * turn, completion_tokens: 20, total_tokens: 100 * turn + 20, prompt_cache_hit_tokens: 50, completion_tokens_details: { reasoning_tokens: 10 } } })
    return response(sse(deltas), 1)
  })
  const agent = new Agent({ tools: [defineTool({ name: 'echo', description: 'echo', parameters: { type: 'object' }, parseArguments: x => x, execute: async () => textResult('OK') })],
    streamFn: (ctx, options) => adapter(ctx, { ...options, inference: { reasoningEffort: 'high', maxOutputTokens: 2048 } }) })
  agent.subscribe(e => { if (e.type === 'message_update') updates.push(e) })
  await agent.prompt('first'); await agent.prompt('second')
  assert.equal(requests.length, 3)
  assert.deepEqual(requests[0].thinking, { type: 'enabled' }); assert.equal(requests[0].reasoning_effort, 'high')
  assert.equal(requests[0].max_tokens, 2048); assert.deepEqual(requests[0].stream_options, { include_usage: true })
  assert.equal(requests[1].messages.find(m => m.role === 'assistant').reasoning_content, '思考 1：检查工具结果。')
  assert.deepEqual(requests[2].messages.filter(m => m.role === 'assistant').map(m => m.reasoning_content), ['思考 1：检查工具结果。', '思考 2：检查工具结果。'])
  assert.equal(updates.find(e => e.assistantMessageEvent.type === 'reasoning_delta').message.reasoning, '思考 1：')
  const responses = agent.state.messages.filter(m => m.role === 'assistant')
  assert.equal(responses[0].usage.reasoningTokens, 10); assert.ok(responses[0].timing.firstTokenMs >= 0)
  const totals = summarizeUsage(agent.state.messages)
  assert.equal(totals.totals.totalTokens, 660); assert.equal(totals.totals.reasoningTokens, 30); assert.equal(totals.totals.cachedInputTokens, 150)
  assert.equal(totals.lastInputTokens, 300); assert.equal(totals.missing, 0)
})

test('usage-only and repeated usage chunks count once; missing/invalid usage stays unknown', async () => {
  const usage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 10 } }
  const events = await collect(createOpenAICompatibleStream(credentials, async () => response(sse([
    { ...chunk({ content: 'x' }), usage }, chunk({}, 'stop'), { choices: [], usage },
  ]))))
  const message = events.at(-1).message
  assert.equal(message.usage.totalTokens, 130)
  const missing = { ...message, usage: undefined, stopReason: 'aborted' }
  const total = summarizeUsage([message, missing])
  assert.equal(total.totals.totalTokens, 130); assert.equal(total.missing, 1); assert.equal(total.reported, 1)
  for (const invalid of [null, {}, { prompt_tokens: -1, completion_tokens: 20 }, { prompt_tokens: 10, completion_tokens: 20, total_tokens: 99 }]) assert.equal(parseTokenUsage(invalid), undefined)
  assert.equal(parseTokenUsage({ prompt_tokens: 10, completion_tokens: 5 }).totalTokens, 15)
  assert.equal(parseTokenUsage({ prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 99 } }).reasoningTokens, undefined)
})

test('thinking effort and output limits validate before fetch; generic hosts omit DeepSeek reasoning history', async () => {
  let requests = 0, request
  const stream = createOpenAICompatibleStream(credentials, async (_url, init) => { requests++; request = JSON.parse(init.body); return response(sse([chunk({}, 'stop')])) })
  for (const effort of ['none', 'low', 'high', 'max']) {
    for await (const _ of stream(context, { signal: new AbortController().signal, inference: { reasoningEffort: effort, maxOutputTokens: 1024 } })) {}
    assert.equal(request.thinking.type, effort === 'none' ? 'disabled' : 'enabled')
    assert.equal(request.reasoning_effort, effort === 'none' ? undefined : effort)
  }
  for (const inference of [{ reasoningEffort: 'invalid' }, { maxOutputTokens: 0 }, { maxOutputTokens: 65537 }]) {
    await assert.rejects(async () => { for await (const _ of stream(context, { signal: new AbortController().signal, inference })) {} })
  }
  assert.equal(requests, 4)
  const generic = createOpenAICompatibleStream({ ...credentials, baseUrl: 'https://example.com/v1' }, async (_url, init) => { request = JSON.parse(init.body); return response(sse([chunk({}, 'stop')])) })
  await collect(generic, { ...context, tools: [{ name: 'echo', description: 'echo', parameters: {} }], messages: [{ role: 'assistant', content: [{ type: 'text', text: 'a' }], reasoning: 'private provider field', timestamp: 1, stopReason: 'stop' }] })
  assert.equal(request.messages.at(-1).reasoning_content, undefined)
})

test('abort retains partial reasoning, usage and timing without invoking partial tools', async () => {
  let agent
  agent = new Agent({ streamFn: async function* () {
    yield { type: 'reasoning_delta', delta: 'partial', partial: { role: 'assistant', content: [], reasoning: 'partial', model: 'test', timestamp: Date.now(), stopReason: 'stop', timing: { durationMs: 1, firstTokenMs: 1 }, usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 } } }
    await new Promise(() => {})
  } })
  agent.subscribe(event => { if (event.type === 'message_update') agent.abort() })
  assert.equal((await agent.prompt('go')).reason, 'aborted')
  const message = agent.state.messages.at(-1)
  assert.equal(message.reasoning, 'partial'); assert.equal(message.usage.totalTokens, 13); assert.ok(message.timing.durationMs >= 0)
})
