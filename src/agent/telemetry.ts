import type { AgentMessage, TokenUsage } from './types.ts'

export interface UsageSummary {
  requests: number
  reported: number
  missing: number
  totals: TokenUsage
  reasoningReported: number
  cacheReported: number
  lastInputTokens?: number
}
export function summarizeUsage(messages: AgentMessage[]): UsageSummary {
  const result: UsageSummary = { requests: 0, reported: 0, missing: 0, reasoningReported: 0, cacheReported: 0,
    totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
  for (const message of messages) {
    if (message.role !== 'assistant' || (!message.model && !message.usage)) continue
    result.requests++
    if (!message.usage) { result.missing++; continue }
    const usage = message.usage
    result.reported++
    result.lastInputTokens = usage.inputTokens
    result.totals.inputTokens += usage.inputTokens
    result.totals.outputTokens += usage.outputTokens
    result.totals.totalTokens += usage.totalTokens
    if (usage.reasoningTokens !== undefined) { result.reasoningReported++; result.totals.reasoningTokens = (result.totals.reasoningTokens ?? 0) + usage.reasoningTokens }
    if (usage.cachedInputTokens !== undefined) { result.cacheReported++; result.totals.cachedInputTokens = (result.totals.cachedInputTokens ?? 0) + usage.cachedInputTokens }
    if (usage.uncachedInputTokens !== undefined) result.totals.uncachedInputTokens = (result.totals.uncachedInputTokens ?? 0) + usage.uncachedInputTokens
  }
  return result
}
