import { defineTool, textResult } from './types.ts'
import type { AgentTool, JsonObject } from './types.ts'

export interface Workspace {
  listNodes(): Promise<{ path: string; kind: 'file' | 'directory' }[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string, options?: { signal?: AbortSignal; expectedContent?: string | null }): Promise<void>
}
function fields(input: unknown, keys: string[]): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Arguments must be an object')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unexpected argument')
  for (const key of keys) if (typeof value[key] !== 'string') throw new Error(`${key} must be a string`)
  return value as Record<string, string>
}
function schema(properties: Record<string, string>): JsonObject {
  return { type: 'object', properties: Object.fromEntries(Object.entries(properties).map(([key, description]) => [key, { type: 'string', description }])),
    required: Object.keys(properties), additionalProperties: false }
}
export function workspacePath(path: string, cwd: string): string {
  if (!path || /[\0\\]/.test(path)) throw new Error('Invalid workspace path')
  const source = path === '~' ? '/workspace' : path.startsWith('~/') ? `/workspace/${path.slice(2)}` : path
  const parts: string[] = []
  for (const part of (source.startsWith('/') ? source : `${cwd}/${source}`).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  const resolved = `/${parts.join('/')}`
  if (resolved !== '/workspace' && !resolved.startsWith('/workspace/')) throw new Error('Path must stay inside /workspace')
  return resolved
}
export function createWorkspaceTools(workspace: Workspace, cwd = '/workspace'): AgentTool[] {
  const resolve = (path: string) => workspacePath(path, cwd)
  return [
    defineTool({ name: 'list_files', description: 'List immediate children of a directory in the browser workspace.', parameters: schema({ path: 'Directory path, e.g. .' }),
      parseArguments: input => fields(input, ['path']),
      async execute(_id, args, signal) {
        signal.throwIfAborted(); const path = resolve(args.path)
        const nodes = await workspace.listNodes(); signal.throwIfAborted()
        if (!nodes.some(node => node.path === path && node.kind === 'directory')) throw new Error(`Not a directory: ${path}`)
        const children = nodes.filter(node => node.path.startsWith(`${path}/`) && !node.path.slice(path.length + 1).includes('/')).sort((a, b) => a.path.localeCompare(b.path))
        const selected = children.slice(0, 200)
        return textResult(selected.map(node => `${node.kind === 'directory' ? 'dir ' : 'file'} ${node.path}`).join('\n') || '(empty)',
          { path, count: children.length, truncated: children.length > selected.length })
      } }),
    defineTool({ name: 'read_file', description: 'Read a UTF-8 text file in the browser workspace (up to 32,000 characters).', parameters: schema({ path: 'File path' }),
      parseArguments: input => fields(input, ['path']),
      async execute(_id, args, signal) {
        signal.throwIfAborted(); const path = resolve(args.path)
        const text = await workspace.readFile(path); signal.throwIfAborted()
        return textResult(text.slice(0, 32000), { path, characters: text.length, truncated: text.length > 32000 })
      } }),
    defineTool({ name: 'write_file', description: 'Create or replace a text file. Its parent directory must exist. Maximum 2 MB.', parameters: schema({ path: 'File path', content: 'Complete file content' }),
      parseArguments: input => fields(input, ['path', 'content']),
      async execute(_id, args, signal) {
        signal.throwIfAborted(); const path = resolve(args.path)
        if (new TextEncoder().encode(args.content).length > 2 * 1024 * 1024) throw new Error('File exceeds 2 MB')
        await workspace.writeFile(path, args.content, { signal })
        return textResult(`Wrote ${path}`, { path, characters: args.content.length })
      } }),
    defineTool({ name: 'edit_file', description: 'Replace exactly one occurrence of oldText. Reject ambiguous matches or a concurrently changed file.', parameters: schema({ path: 'File path', oldText: 'Exact text to replace (nonempty)', newText: 'Replacement text' }),
      parseArguments: input => { const args = fields(input, ['path', 'oldText', 'newText']); if (!args.oldText) throw new Error('oldText must not be empty'); return args },
      async execute(_id, args, signal) {
        signal.throwIfAborted(); const path = resolve(args.path)
        const content = await workspace.readFile(path); signal.throwIfAborted()
        const index = content.indexOf(args.oldText)
        if (index < 0) throw new Error('oldText was not found')
        if (index !== content.lastIndexOf(args.oldText)) throw new Error('oldText matches more than once')
        const next = content.slice(0, index) + args.newText + content.slice(index + args.oldText.length)
        if (new TextEncoder().encode(next).length > 2 * 1024 * 1024) throw new Error('File exceeds 2 MB')
        await workspace.writeFile(path, next, { signal, expectedContent: content })
        return textResult(`Edited ${path}`, { path, characters: next.length })
      } }),
  ]
}
