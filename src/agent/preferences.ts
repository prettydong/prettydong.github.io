import type { InferenceOptions, ReasoningEffort } from './types.ts'

export const reasoningEfforts: ReasoningEffort[] = ['none', 'low', 'high', 'max']
export const effortLabels: Record<ReasoningEffort, string> = { none: '关闭', low: '低', high: '高', max: '最高' }
export const outputLimits = [2048, 8192, 16384, 32768, 65536]
export const defaultPreferences = { reasoningEffort: 'high' as ReasoningEffort, maxOutputTokens: 8192 }
export type AgentPreferences = Required<InferenceOptions>
const key = 'zed-agent-preferences-v1'
export function readPreferences(): AgentPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    return { reasoningEffort: reasoningEfforts.includes(value?.reasoningEffort) ? value.reasoningEffort : defaultPreferences.reasoningEffort,
      maxOutputTokens: Number.isSafeInteger(value?.maxOutputTokens) && value.maxOutputTokens >= 256 && value.maxOutputTokens <= 65536 ? value.maxOutputTokens : defaultPreferences.maxOutputTokens }
  } catch { return { ...defaultPreferences } }
}
export function savePreferences(value: AgentPreferences) {
  try { localStorage.setItem(key, JSON.stringify({ reasoningEffort: value.reasoningEffort, maxOutputTokens: value.maxOutputTokens })) } catch { /* Still usable with storage disabled. */ }
}
