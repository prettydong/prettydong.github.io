import { PythonRunner, type PythonNode } from '../../system/python.ts'
import { defineTool, textResult } from '../types.ts'
import { workspacePath } from '../workspace-tools.ts'
import { argumentsObject, stringArgument, type AgentPlugin, type PluginWorkspace } from './types.ts'

export function createPythonPlugin(workspace: PluginWorkspace, cwd = '/workspace'): AgentPlugin {
  const runner = new PythonRunner()
  const directory = cwd === '/workspace' || cwd.startsWith('/workspace/') ? cwd : '/workspace'
  return {
    id: 'python', title: 'Python 执行',
    instructions: `Use run_python for Python calculations, data processing and scripts. It runs in a browser Pyodide worker, not an OS shell. Its working directory is ${directory}. Use print() for output. Pyodide distribution packages referenced by imports load automatically; arbitrary native/PyPI packages are not guaranteed. input() is unavailable. Only UTF-8 text files under /workspace are saved, after successful execution. Do not delete, move, or change the type of existing files. Globals persist until the session is reset; workspace files refresh on every call. Execution errors, cancellation and timeout do not commit files. Code has browser network/JS capabilities, not a security sandbox.`,
    dispose: () => runner.dispose(),
    tools: [defineTool({
      name: 'run_python',
      description: 'Execute Python in Pyodide. Return stdout/stderr and atomically save new/edited UTF-8 workspace files. Use print() to return values. Default timeout 60 seconds including startup; maximum 120 seconds.',
      parameters: { type: 'object', properties: {
        code: { type: 'string', description: 'Python source, at most 64,000 characters' },
        timeoutSeconds: { type: 'integer', minimum: 1, maximum: 120, description: 'Optional execution timeout, default 60' },
      }, required: ['code'], additionalProperties: false },
      parseArguments(input) {
        const args = argumentsObject(input, ['code', 'timeoutSeconds'])
        const code = stringArgument(args, 'code')
        const timeoutSeconds = args.timeoutSeconds ?? 60
        if (typeof timeoutSeconds !== 'number' || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) throw new Error('timeoutSeconds must be an integer from 1 to 120')
        return { code, timeoutSeconds }
      },
      async execute(_id, args, signal) {
        signal.throwIfAborted()
        workspacePath(directory, '/workspace')
        const nodes: PythonNode[] = (await workspace.listNodes())
          .filter(node => node.path === '/workspace' || node.path.startsWith('/workspace/'))
          .map(node => ({ path: node.path, kind: node.kind, ...(node.kind === 'file' ? { content: node.content } : {}) }))
        signal.throwIfAborted()
        if (nodes.length > 2000) throw new Error('Python 工作区最多支持 2000 个文件和目录。')
        if (!nodes.some(node => node.path === directory && node.kind === 'directory')) throw new Error(`目录不存在：${directory}`)
        let bytes = 0
        for (const node of nodes) {
          if (workspacePath(node.path, '/workspace') !== node.path) throw new Error('工作区路径无效。')
          if (node.kind !== 'file') continue
          if (node.content === undefined) node.content = await workspace.readFile(node.path)
          signal.throwIfAborted()
          const size = new TextEncoder().encode(node.content!).length
          bytes += size
          if (node.content!.includes('\0') || size > 2 * 1024 * 1024 || bytes > 20 * 1024 * 1024) throw new Error('Python 工作区仅支持文本：单文件 2 MB，总计 20 MB。')
        }
        const result = await runner.run({ kind: 'script', source: args.code, cwd: directory, nodes, loadPackages: true, limitWorkspace: true }, { signal, timeoutMs: args.timeoutSeconds * 1000 })
        signal.throwIfAborted()
        const output = result.lines.join('\n')
        const visible = output.slice(0, 32000)
        const suffix = output.length > 32000 ? '\n… 输出已截断。' : ''
        if (result.error) return { ...textResult(`${visible}${suffix}\n${result.error.slice(-8000)}\n文件未保存。`.trim()), isError: true }
        if (!result.nodes) throw new Error('Python 未返回工作区结果，文件未保存。')
        let changedFiles: string[]
        try { changedFiles = await workspace.applyPythonChanges(nodes, result.nodes, signal) }
        catch (error) {
          signal.throwIfAborted()
          return { ...textResult(`${visible}${suffix}\n${error instanceof Error ? error.message : String(error)}\n文件未保存。`.trim()), isError: true }
        }
        return textResult([visible || '(无输出)', suffix, changedFiles.length ? `已保存：\n${changedFiles.join('\n')}` : ''].filter(Boolean).join('\n'),
          { changedFiles, truncated: output.length > 32000 })
      },
    })],
  }
}
