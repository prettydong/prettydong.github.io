/*! Adapted from Pi. MIT (c) 2025 Mario Zechner. License: /licenses/pi-agent-core.txt */
/** Stateful wrapper around the adapted Pi loop. See third-party/pi-agent-core/README.md. */
import { runAgentLoop, runAgentLoopContinue } from './agent-loop.ts'
import { userMessage } from './types.ts'
import type { AgentContext, AgentEvent, AgentEventSink, AgentLoopConfig, AgentMessage, AgentRunResult, AssistantMessage, EndReason } from './types.ts'

export interface AgentState {
  messages: AgentMessage[]
  isRunning: boolean
  streamMessage: AssistantMessage | null
  pendingToolCalls: string[]
  reason?: EndReason
}
export interface AgentOptions extends Omit<AgentLoopConfig, 'getSteeringMessages' | 'getFollowUpMessages'> {
  systemPrompt?: string
  tools?: AgentContext['tools']
  messages?: AgentMessage[]
}
export class Agent {
  private current: AgentState
  private options: AgentOptions
  private listeners = new Set<AgentEventSink>()
  private steering: AgentMessage[] = []
  private followUps: AgentMessage[] = []
  private controller: AbortController | null = null
  private running: Promise<AgentRunResult> | null = null

  constructor(options: AgentOptions) {
    this.options = options
    this.current = { messages: structuredClone(options.messages ?? []), isRunning: false, streamMessage: null, pendingToolCalls: [] }
  }
  get state(): AgentState { return structuredClone(this.current) }
  subscribe(listener: AgentEventSink) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  steer(message: string | AgentMessage) { this.steering.push(structuredClone(typeof message === 'string' ? userMessage(message) : message)) }
  followUp(message: string | AgentMessage) { this.followUps.push(structuredClone(typeof message === 'string' ? userMessage(message) : message)) }
  clearQueues() { this.steering = []; this.followUps = [] }
  abort() { this.controller?.abort() }
  waitForIdle(): Promise<AgentRunResult | undefined> { return this.running ?? Promise.resolve(undefined) }
  reset() {
    if (this.current.isRunning) throw new Error('Cannot reset a running agent; abort and await waitForIdle() first')
    this.clearQueues()
    this.current = { messages: [], isRunning: false, streamMessage: null, pendingToolCalls: [] }
  }
  prompt(input: string | AgentMessage | AgentMessage[]): Promise<AgentRunResult> {
    const prompts = typeof input === 'string' ? [userMessage(input)] : Array.isArray(input) ? input : [input]
    if (!prompts.length) return Promise.reject(new Error('A prompt is required'))
    return this.run(prompts)
  }
  continue(): Promise<AgentRunResult> {
    if (this.current.isRunning) return Promise.reject(new Error('Agent is already running'))
    const queued = this.steering.length ? this.steering.splice(0, 1) : this.followUps.splice(0, 1)
    return this.run(queued.length ? queued : undefined)
  }

  private run(prompts?: AgentMessage[]): Promise<AgentRunResult> {
    if (this.current.isRunning) return Promise.reject(new Error('Agent is already running; use steer() or followUp()'))
    this.controller = new AbortController()
    this.current.isRunning = true; this.current.reason = undefined
    const context: AgentContext = { systemPrompt: this.options.systemPrompt ?? '', tools: this.options.tools ?? [], messages: this.current.messages }
    const config: AgentLoopConfig = { ...this.options,
      getSteeringMessages: () => this.steering.splice(0, 1), getFollowUpMessages: () => this.followUps.splice(0, 1) }
    const signal = this.controller.signal
    // Defer until running has been assigned, so even synchronous listeners see the active run.
    this.running = Promise.resolve().then(() => prompts
      ? runAgentLoop(prompts, context, config, event => this.handleEvent(event), signal)
      : runAgentLoopContinue(context, config, event => this.handleEvent(event), signal))
      .finally(() => {
        this.current.isRunning = false; this.current.streamMessage = null; this.current.pendingToolCalls = []
        this.controller = null; this.running = null
      })
    return this.running
  }
  private async handleEvent(event: AgentEvent) {
    if (event.type === 'message_update') this.current.streamMessage = structuredClone(event.message)
    if (event.type === 'message_start' && event.message.role === 'assistant') this.current.streamMessage = structuredClone(event.message)
    if (event.type === 'message_end') {
      this.current.messages.push(structuredClone(event.message))
      if (event.message.role === 'assistant') this.current.streamMessage = null
    }
    if (event.type === 'tool_execution_start') this.current.pendingToolCalls.push(event.toolCallId)
    if (event.type === 'tool_execution_end') this.current.pendingToolCalls = this.current.pendingToolCalls.filter(id => id !== event.toolCallId)
    if (event.type === 'agent_end') {
      this.current.reason = event.reason
      // End-event listeners can render idle state; new runs are accepted only after settlement.
    }
    for (const listener of this.listeners) await listener(structuredClone(event))
  }
}
