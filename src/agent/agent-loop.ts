/*! Adapted from Pi. MIT (c) 2025 Mario Zechner. License: /licenses/pi-agent-core.txt */
/**
 * Adapted from Pi's agent-loop.ts, MIT © 2025 Mario Zechner.
 * Upstream revision, license and intentional differences: third-party/pi-agent-core/README.md.
 */
import { abortable } from './abort.ts'
import type { AgentContext, AgentEvent, AgentEventSink, AgentLoopConfig, AgentMessage, AgentRunResult,
  AssistantMessage, AssistantStreamEvent, EndReason, ModelMessage, ToolCall, ToolResult, ToolResultMessage } from './types.ts'
import { textResult } from './types.ts'

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const failure = (error: unknown, signal: AbortSignal): AssistantMessage => ({ role: 'assistant', content: [],
  stopReason: signal.aborted ? 'aborted' : 'error', errorMessage: signal.aborted ? 'Operation aborted' : errorText(error), timestamp: Date.now() })
const defaultConvert = (messages: AgentMessage[]) => messages.filter((message): message is ModelMessage => message.role !== 'custom' && !(message.role === 'assistant' && ['error', 'aborted'].includes(message.stopReason)))
const snapshot = <T>(value: T): T => structuredClone(value)

/** Awaited event sink is a barrier: async observers settle before subsequent model/tool work. */
export async function runAgentLoop(prompts: AgentMessage[], context: AgentContext, config: AgentLoopConfig,
  sink: AgentEventSink = () => {}, signal: AbortSignal = new AbortController().signal): Promise<AgentRunResult> {
  const current: AgentContext = { ...context, messages: snapshot(context.messages), tools: [...context.tools] }
  const messages: AgentMessage[] = []
  const emit = async (event: AgentEvent) => { await sink(snapshot(event)) }
  const append = async (message: AgentMessage) => {
    const committed = snapshot(message)
    current.messages.push(committed); messages.push(committed)
    await emit({ type: 'message_start', message: committed })
    await emit({ type: 'message_end', message: committed })
  }
  let turn = 0
  let reason: EndReason = 'stop'
  let activeAssistant: AssistantMessage | undefined
  let turnOpen = false
  let toolResults: ToolResultMessage[] = []
  await emit({ type: 'agent_start' })
  try {
    const maxTurns = config.maxTurns ?? 32
    if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) throw new Error('maxTurns must be a positive integer')
    if (typeof config.streamFn !== 'function') throw new Error('An injected streamFn is required')
    const names = current.tools.map(tool => tool.name)
    if (new Set(names).size !== names.length) throw new Error('Tool names must be unique')
    let pending = snapshot(prompts)
    pending.push(...await abortable(() => config.getSteeringMessages?.() ?? [], signal))
    // Outer loop drains follow-ups only when the model and steering queue would otherwise stop.
    while (true) {
      let hasMoreToolCalls = true
      // Inner loop feeds tool results and steering messages back to the assistant.
      while (hasMoreToolCalls || pending.length) {
        signal.throwIfAborted()
        if (turn >= maxTurns) {
          // Preserve already-drained input in the transcript so continue() can resume it.
          for (const message of pending) await append(message)
          reason = 'max_turns'; return { messages: snapshot(messages), reason }
        }
        turn++; turnOpen = true; toolResults = []; activeAssistant = undefined
        await emit({ type: 'turn_start', turn })
        for (const message of pending) await append(message)
        pending = []
        activeAssistant = await streamAssistantResponse(current, config, emit, signal)
        current.messages.push(activeAssistant); messages.push(activeAssistant)
        if (activeAssistant.stopReason === 'error' || activeAssistant.stopReason === 'aborted') {
          reason = activeAssistant.stopReason
          await emit({ type: 'turn_end', turn, message: activeAssistant, toolResults }); turnOpen = false
          return { messages: snapshot(messages), reason }
        }
        const calls = activeAssistant.content.filter((part): part is ToolCall => part.type === 'toolCall')
        const counts = new Map<string, number>()
        for (const call of calls) counts.set(call.id, (counts.get(call.id) ?? 0) + 1)
        for (const call of calls) {
          const invalid = activeAssistant.stopReason === 'length' ? 'Response was truncated; re-issue the complete tool call.'
            : !call.id || counts.get(call.id)! > 1 ? 'Tool call IDs must be nonempty and unique in a response.' : undefined
          const result = await executeToolCall(call, current, config, emit, signal, invalid)
          current.messages.push(result); messages.push(result); toolResults.push(result)
          // Even cancelled/unexecuted calls get paired results, so a later continuation is valid.
        }
        await emit({ type: 'turn_end', turn, message: activeAssistant, toolResults }); turnOpen = false
        signal.throwIfAborted()
        hasMoreToolCalls = calls.length > 0
        pending = await abortable(() => config.getSteeringMessages?.() ?? [], signal)
      }
      pending = await abortable(() => config.getFollowUpMessages?.() ?? [], signal)
      if (!pending.length) break
    }
  } catch (error) {
    reason = signal.aborted ? 'aborted' : 'error'
    const message = failure(error, signal)
    await append(message)
    if (turnOpen) await emit({ type: 'turn_end', turn, message: activeAssistant ?? message, toolResults })
  } finally {
    await emit({ type: 'agent_end', messages, reason })
  }
  return { messages: snapshot(messages), reason }
}

export function runAgentLoopContinue(context: AgentContext, config: AgentLoopConfig,
  sink?: AgentEventSink, signal?: AbortSignal): Promise<AgentRunResult> {
  if (!context.messages.length) return Promise.reject(new Error('Cannot continue: no messages in context'))
  const last = context.messages.at(-1)
  if (last?.role === 'assistant' && !['error', 'aborted'].includes(last.stopReason)) return Promise.reject(new Error('Cannot continue from an assistant message; use prompt()'))
  return runAgentLoop([], context, config, sink, signal)
}

async function streamAssistantResponse(context: AgentContext, config: AgentLoopConfig, emit: AgentEventSink,
  signal: AbortSignal): Promise<AssistantMessage> {
  let partial: AssistantMessage = { role: 'assistant', content: [], stopReason: 'stop', timestamp: Date.now() }
  let started = false
  let iterator: AsyncIterator<AssistantStreamEvent> | undefined
  try {
    let messages = snapshot(context.messages)
    if (config.transformContext) messages = await abortable(() => config.transformContext!(messages, signal), signal)
    const modelMessages = await abortable(() => (config.convertToLlm ?? defaultConvert)(messages), signal)
    const response = await abortable(() => config.streamFn({ systemPrompt: context.systemPrompt, messages: snapshot(modelMessages),
      tools: context.tools.map(({ name, description, parameters }) => ({ name, description, parameters: snapshot(parameters) })) }, { signal }), signal)
    iterator = response[Symbol.asyncIterator]()
    while (true) {
      const item = await abortable(() => iterator!.next(), signal)
      if (item.done) throw new Error('Model stream ended without a done/error event')
      const event = item.value
      if (event.type === 'done' || event.type === 'error') {
        const final = snapshot(event.type === 'done' ? event.message : event.error)
        if (final.role !== 'assistant' || !Array.isArray(final.content) || !['stop', 'toolUse', 'length', 'error', 'aborted'].includes(final.stopReason)
          || final.content.some(part => !part || (part.type === 'text' ? typeof part.text !== 'string' : part.type !== 'toolCall' || typeof part.id !== 'string' || typeof part.name !== 'string'))) throw new Error('Invalid assistant message')
        if (!started) { await emit({ type: 'message_start', message: final }); started = true }
        await emit({ type: 'message_end', message: final })
        return final
      }
      partial = snapshot(event.partial)
      if (!started) { await emit({ type: 'message_start', message: partial }); started = true }
      if (event.type !== 'start') await emit({ type: 'message_update', message: partial, assistantMessageEvent: snapshot(event) })
    }
  } catch (error) {
    const final: AssistantMessage = { ...partial, ...failure(error, signal), content: partial.content, timestamp: partial.timestamp,
      ...(partial.timing ? { timing: { ...partial.timing, durationMs: Math.max(0, Date.now() - partial.timestamp) } } : {}) }
    if (!started) await emit({ type: 'message_start', message: final })
    await emit({ type: 'message_end', message: final })
    return final
  } finally {
    // A stalled producer must not prevent abort from completing; ignore any late stream values.
    if (iterator?.return) void Promise.resolve().then(() => iterator!.return!()).catch(() => {})
  }
}

async function executeToolCall(call: ToolCall, context: AgentContext, config: AgentLoopConfig,
  emit: AgentEventSink, signal: AbortSignal, invalid?: string): Promise<ToolResultMessage> {
  await emit({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: call.arguments })
  let result: ToolResult
  let acceptingUpdates = true
  let updates = Promise.resolve()
  try {
    signal.throwIfAborted()
    if (invalid) throw new Error(invalid)
    const tool = context.tools.find(tool => tool.name === call.name)
    if (!tool) throw new Error(`Tool ${call.name} not found`)
    const args = tool.parseArguments(snapshot(call.arguments))
    const hookContext = { toolCall: snapshot(call), args, context: { ...context, messages: snapshot(context.messages) } }
    const before = await abortable(() => config.beforeToolCall?.(hookContext, signal), signal)
    if (before?.block) throw new Error(before.reason)
    result = await abortable(() => tool.execute(call.id, args, signal, partialResult => {
      if (!acceptingUpdates || signal.aborted) return Promise.resolve()
      const update = snapshot(partialResult)
      updates = updates.then(() => emit({ type: 'tool_execution_update', toolCallId: call.id, toolName: call.name, partialResult: update }))
      // A tool may choose not to await progress; keep its rejection observed until finalization.
      void updates.catch(() => {})
      return updates
    }), signal)
    acceptingUpdates = false
    await updates
    const after = await abortable(() => config.afterToolCall?.({ ...hookContext, result }, signal), signal)
    if (after) result = after
  } catch (error) {
    acceptingUpdates = false
    await updates
    result = { ...textResult(signal.aborted ? 'Operation aborted; tool execution cancelled or skipped.' : errorText(error)), isError: true }
  }
  if (!result || !Array.isArray(result.content) || result.content.some(part => part.type !== 'text' || typeof part.text !== 'string')) {
    result = { ...textResult('Tool returned an invalid result'), isError: true }
  }
  const message: ToolResultMessage = { ...snapshot(result), role: 'toolResult', toolCallId: call.id, toolName: call.name,
    timestamp: Date.now(), isError: result.isError ?? false }
  await emit({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, result, isError: message.isError })
  await emit({ type: 'message_start', message })
  await emit({ type: 'message_end', message })
  return message
}

/** Pi-style push event stream. Stopping iteration aborts subsequent work; result() resolves at settlement. */
export function agentLoop(prompts: AgentMessage[], context: AgentContext, config: AgentLoopConfig, signal?: AbortSignal) {
  return createEventStream((sink, activeSignal) => runAgentLoop(prompts, context, config, sink, activeSignal), signal)
}
export function agentLoopContinue(context: AgentContext, config: AgentLoopConfig, signal?: AbortSignal) {
  return createEventStream((sink, activeSignal) => runAgentLoopContinue(context, config, sink, activeSignal), signal)
}
function createEventStream(run: (emit: AgentEventSink, signal: AbortSignal) => Promise<AgentRunResult>, signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const queue: AgentEvent[] = []
  let wake: (() => void) | undefined
  let done = false
  let failure: unknown
  const result = run(event => { queue.push(event); wake?.(); wake = undefined }, controller.signal)
    .catch(error => { failure = error; throw error })
    .finally(() => { done = true; signal?.removeEventListener('abort', abort); wake?.(); wake = undefined })
  void result.catch(() => {})
  return {
    result: () => result,
    async *[Symbol.asyncIterator]() {
      try {
        while (queue.length || !done) {
          if (queue.length) yield queue.shift()!
          else await new Promise<void>(resolve => { wake = resolve })
        }
        if (failure) throw failure
      } finally { if (!done) controller.abort() }
    },
  }
}
