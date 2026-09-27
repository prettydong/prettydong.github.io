import { useEffect, useState } from 'react'
import type { AssistantMessage } from './agent/types'
import type { UsageSummary } from './agent/telemetry'

export const tokenCount = (value?: number) => value === undefined ? '—' : value.toLocaleString('en-US')
export const compactTokens = (value?: number) => value === undefined ? '—' : value < 1000 ? String(value)
  : value < 1_000_000 ? `${Number((value / 1000).toFixed(1))}k` : `${Number((value / 1_000_000).toFixed(1))}M`
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export function AgentReasoning({ message, live }: { message: AssistantMessage; live: boolean }) {
  const [open, setOpen] = useState(live)
  useEffect(() => { if (!live) setOpen(false) }, [live])
  if (!message.reasoning) return null
  const thinking = live && !message.content.some(part => part.type === 'text' || part.type === 'toolCall')
  return <details className="agent-reasoning" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{thinking ? 'thinking…' : 'thinking'}</summary>
    <pre>{message.reasoning}</pre>
  </details>
}

export type UsageView = 'session' | 'run' | 'last'
export const usageViews: UsageView[] = ['session', 'run', 'last']
export function FooterTelemetry({ session, run, last, view, onCycle }: {
  session: UsageSummary; run: UsageSummary; last?: AssistantMessage; view: UsageView; onCycle: () => void
}) {
  const summary = view === 'run' ? run : session
  const usage = view === 'last' ? last?.usage : summary.reported ? summary.totals : undefined
  const count = (field: 'inputTokens' | 'outputTokens' | 'totalTokens') => {
    if (!usage) return view === 'last' ? last ? '—' : '0' : summary.requests ? '—' : '0'
    return `${compactTokens(usage[field])}${view !== 'last' && summary.missing ? '+' : ''}`
  }
  const label = view === 'session' ? '会话' : view === 'run' ? '任务' : '最近'
  const exact = `${label} · 输入 ${tokenCount(usage?.inputTokens)} · 输出 ${tokenCount(usage?.outputTokens)} · 合计 ${tokenCount(usage?.totalTokens)} · 思考 ${tokenCount(usage?.reasoningTokens)} · 缓存命中 ${tokenCount(usage?.cachedInputTokens)} · 缓存未命中 ${tokenCount(usage?.uncachedInputTokens)}`
  return <div className="agent-footer-usage">
    <button className="agent-usage-view" onClick={onCycle} aria-label={`切换用量视图，当前${label}`} title={exact}>{label}</button>
    <span title={`输入 ${tokenCount(usage?.inputTokens)}`}>↑{count('inputTokens')}</span>
    <span title={`输出 ${tokenCount(usage?.outputTokens)}`}>↓{count('outputTokens')}</span>
    <span title={`合计 ${tokenCount(usage?.totalTokens)}`}>Σ{count('totalTokens')}</span>
    {usage?.cachedInputTokens !== undefined && <span title="缓存命中 tokens">R{compactTokens(usage.cachedInputTokens)}{view !== 'last' && summary.cacheReported < summary.requests ? '+' : ''}</span>}
    {usage?.reasoningTokens !== undefined && <span title="思考 tokens，已包含在输出中">T{compactTokens(usage.reasoningTokens)}{view !== 'last' && summary.reasoningReported < summary.requests ? '+' : ''}</span>}
    {view !== 'last' && summary.missing > 0 && <span title="已报告用量 / 请求数">{summary.reported}/{summary.requests}</span>}
    {view === 'last' && last?.timing && <>
      <span title="请求耗时">{seconds(last.timing.durationMs)}</span>
      {last.timing.firstTokenMs !== undefined && <span title="首段响应时间">首段 {seconds(last.timing.firstTokenMs)}</span>}
    </>}
  </div>
}
