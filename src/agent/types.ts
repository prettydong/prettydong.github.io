/** Provider-independent subset of Pi's agent protocol. See third-party/pi-agent-core/README.md. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export interface TextContent { type: 'text'; text: string }
export interface ToolCall { type: 'toolCall'; id: string; name: string; arguments: unknown }
export interface UserMessage { role: 'user'; content: string; timestamp: number }
export type ReasoningEffort = 'none' | 'low' | 'high' | 'max'
export interface InferenceOptions { reasoningEffort?: ReasoningEffort; maxOutputTokens?: number }
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens?: number
  cachedInputTokens?: number
  uncachedInputTokens?: number
}
export interface ResponseTiming { durationMs: number; firstTokenMs?: number }
export interface AssistantMessage {
  role: 'assistant'
  content: (TextContent | ToolCall)[]
  stopReason: 'stop' | 'toolUse' | 'length' | 'error' | 'aborted'
  errorMessage?: string
  timestamp: number
  /** Provider-returned reasoning; kept separately from the final answer and tool arguments. */
  reasoning?: string
  usage?: TokenUsage
  timing?: ResponseTiming
  model?: string
  inference?: InferenceOptions
}
export interface ToolResult {
  content: TextContent[]
  details?: JsonValue
  isError?: boolean
}
export interface ToolResultMessage extends ToolResult {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  timestamp: number
  isError: boolean
}
export interface CustomMessage { role: 'custom'; type: string; data: JsonValue; timestamp: number }
export type ModelMessage = UserMessage | AssistantMessage | ToolResultMessage
export type AgentMessage = ModelMessage | CustomMessage
export interface ToolDefinition { name: string; description: string; parameters: JsonObject }
export interface AgentTool extends ToolDefinition {
  /** Must validate untrusted arguments before execution; throw on invalid input. */
  parseArguments: (input: unknown) => unknown
  execute: (id: string, args: unknown, signal: AbortSignal, onUpdate: (result: ToolResult) => Promise<void>) => Promise<ToolResult>
}
export function defineTool<Args>(tool: ToolDefinition & {
  parseArguments: (input: unknown) => Args
  execute: (id: string, args: Args, signal: AbortSignal, onUpdate: (result: ToolResult) => Promise<void>) => Promise<ToolResult>
}): AgentTool {
  return { ...tool, execute: (id, args, signal, onUpdate) => tool.execute(id, args as Args, signal, onUpdate) }
}
export interface AgentContext { systemPrompt: string; messages: AgentMessage[]; tools: AgentTool[] }
export interface ModelContext { systemPrompt: string; messages: ModelMessage[]; tools: ToolDefinition[] }
export type AssistantStreamEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_delta'; delta: string; partial: AssistantMessage }
  | { type: 'reasoning_delta'; delta: string; partial: AssistantMessage }
  | { type: 'usage'; partial: AssistantMessage }
  | { type: 'toolcall_delta'; partial: AssistantMessage }
  | { type: 'done'; message: AssistantMessage }
  | { type: 'error'; error: AssistantMessage }
/** Only model boundary. No provider registry, model catalog, credentials, or network implementation. */
export type StreamFn = (context: ModelContext, options: { signal: AbortSignal; inference?: InferenceOptions }) => AsyncIterable<AssistantStreamEvent> | Promise<AsyncIterable<AssistantStreamEvent>>
export type EndReason = 'stop' | 'error' | 'aborted' | 'max_turns'
export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start'; turn: number }
  | { type: 'message_start' | 'message_end'; message: AgentMessage }
  | { type: 'message_update'; message: AssistantMessage; assistantMessageEvent: AssistantStreamEvent }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult: ToolResult }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: ToolResult; isError: boolean }
  | { type: 'turn_end'; turn: number; message: AssistantMessage; toolResults: ToolResultMessage[] }
  | { type: 'agent_end'; messages: AgentMessage[]; reason: EndReason }
export type AgentEventSink = (event: AgentEvent) => void | Promise<void>
export interface ToolCallContext { toolCall: ToolCall; args: unknown; context: AgentContext }
export interface AgentLoopConfig {
  streamFn: StreamFn
  /** Defaults to 32 assistant responses per run, including steering/follow-ups. */
  maxTurns?: number
  transformContext?: (messages: AgentMessage[], signal: AbortSignal) => AgentMessage[] | Promise<AgentMessage[]>
  convertToLlm?: (messages: AgentMessage[]) => ModelMessage[] | Promise<ModelMessage[]>
  getSteeringMessages?: () => AgentMessage[] | Promise<AgentMessage[]>
  getFollowUpMessages?: () => AgentMessage[] | Promise<AgentMessage[]>
  beforeToolCall?: (call: ToolCallContext, signal: AbortSignal) => void | { block: true; reason: string } | Promise<void | { block: true; reason: string }>
  afterToolCall?: (call: ToolCallContext & { result: ToolResult }, signal: AbortSignal) => ToolResult | void | Promise<ToolResult | void>
}
export interface AgentRunResult { messages: AgentMessage[]; reason: EndReason }
export const userMessage = (content: string): UserMessage => ({ role: 'user', content, timestamp: Date.now() })
export const textResult = (text: string, details?: JsonValue): ToolResult => ({ content: [{ type: 'text', text }], ...(details === undefined ? {} : { details }) })
