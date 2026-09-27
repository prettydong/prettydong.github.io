import type { StreamFn } from './types.ts'

let streamFn: StreamFn | undefined
const listeners = new Set<() => void>()
/** Application integration point; deliberately does not implement a model/provider. */
export function configureAgent(options: { streamFn?: StreamFn }) {
  streamFn = options.streamFn
  for (const listener of listeners) listener()
}
export function isAgentConfigured() { return Boolean(streamFn) }
export function subscribeAgentConfiguration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
/** Capture once per run so changing configuration cannot switch models mid-conversation turn. */
export function getAgentStream(): StreamFn {
  if (!streamFn) throw new Error('尚未连接模型接口。')
  return streamFn
}
