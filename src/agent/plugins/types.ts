import type { AgentTool } from '../types.ts'
import type { Workspace } from '../workspace-tools.ts'
import type { PythonNode } from '../../system/python.ts'

export interface AgentPlugin {
  id: string
  title: string
  instructions: string
  tools: AgentTool[]
  /** Release session resources. The plugin may be used again after reset. */
  dispose?: () => void
}

export interface PluginWorkspace extends Workspace {
  /** Prefer an atomic snapshot including file contents; omitted contents are read separately. */
  listNodes(): Promise<PythonNode[]>
  ensureDirectory(path: string, signal?: AbortSignal): Promise<void>
  applyPythonChanges(before: PythonNode[], after: PythonNode[], signal: AbortSignal): Promise<string[]>
}

export function registerPlugins(plugins: AgentPlugin[], baseTools: AgentTool[] = []) {
  const ids = new Set<string>()
  const names = new Set(baseTools.map(tool => tool.name))
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) throw new Error(`Duplicate plugin: ${plugin.id}`)
    ids.add(plugin.id)
    for (const tool of plugin.tools) {
      if (names.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`)
      names.add(tool.name)
    }
  }
  return {
    plugins,
    tools: [...baseTools, ...plugins.flatMap(plugin => plugin.tools)],
    instructions: plugins.map(plugin => plugin.instructions).join('\n\n'),
    dispose: () => { for (const plugin of plugins) plugin.dispose?.() },
  }
}

export function argumentsObject(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Arguments must be an object')
  const args = input as Record<string, unknown>
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unexpected argument')
  return args
}

export function stringArgument(args: Record<string, unknown>, key: string, max = 64000): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`${key} must be nonempty text, at most ${max} characters`)
  }
  return value
}
