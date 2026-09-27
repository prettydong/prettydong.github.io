# Agent 插件开发

插件是本项目 agent 的工具与指令扩展。内置 `python`、`blog` 随源码注册，不从聊天或网络动态安装脚本。核心循环仍只依赖 `AgentTool` / `StreamFn`；插件不持有 provider key。

## 使用

进入 `agent` 并解锁后，用自然语言描述任务，例如：

- “用 Python 计算 1 到 1000 的平方和，打印结果。”
- “读取 notes/data.csv，统计每列缺失值，把结果保存成 notes/summary.json。”
- “检索我已有的 Python 文章，写一篇新的学习笔记草稿，预览给我。”
- “读取草稿 2026-09-28-python-notes.md，缩短开头并保留例子，然后重新预览。”

`/plugins` 展开或收起插件列表；`/help` 查看完整操作。Enter 发送，Shift+Enter 换行，运行中 Alt+Enter 排队，Tab / Shift+Tab 循环输入、工具摘要、下载链接及底栏，Esc / Ctrl+C 停止运行，空闲时 Esc 返回。工具摘要用 Enter / Space 展开收起，下载链接用 Enter 激活；触屏可点击。输入法选词不触发快捷键。停止前已完成的文件写入保留。

## Python

`run_python({ code, timeoutSeconds? })`：

- 使用现有 Pyodide 0.29.5，在独立 Web Worker 中运行；首次执行从 CDN 加载解释器。代码中识别到的 Pyodide 发行包会由 `loadPackagesFromImports` 加载。参见 [Pyodide 包加载文档](https://pyodide.org/en/stable/usage/loading-packages.html)。不保证任意 PyPI 包或本机扩展可用，没有通用 pip 工具。
- `code` 非空，最多 64,000 字符。用 `print()` 返回值；合并 stdout/stderr 返回前 32,000 字符，超出明确标记。Python 异常返回错误和已有输出。`input()` 不可用。
- `timeoutSeconds` 为 1–120 的整数，默认 60，包含解释器/依赖初始化及执行、快照阶段。取消或超时终止该 agent 的工作线程，下一次调用重新初始化。
- 当前目录固定为进入 agent 时的工作区目录；从根目录等工作区外位置进入时使用 `/workspace`。每次调用从 IndexedDB 重新载入 `/workspace`，Python globals 跨调用保留；清空会话、锁定、退出或超时会释放解释器。与普通终端 `python` 的交互状态不共享。异常可能已改变内存变量，文件则不提交。
- 只同步 `/workspace` 内的 UTF-8 文本与目录。最多 2000 个节点，单文件 2 MB，总计 20 MB。新建目录和文件、修改已有文件均可；删除、移动、类型变更、符号链接或二进制文件会拒绝本次保存。图表可保存成文本 SVG，二进制 PNG 不会保存到当前文本工作区。
- 执行成功后，`applyPythonChanges` 在单个 IndexedDB 事务里比较执行前后的工作区基线，拒绝覆盖并发修改，再原子写入差异。异常、取消、超时或校验失败不提交本次文件变化；已经提交的早期工具结果不会回滚。输出里的“已保存”仅在事务成功后出现。

这是浏览器 Python，不提供本机文件系统、系统 shell 或原生子进程。Worker 用来隔离计算负载和实现终止，不是安全沙箱；Python 的 JS 桥接仍能访问浏览器网络等能力。不要把自动生成代码当成受限权限代码。文件快照检查只约束正常工具同步流程。

## 博客

| 工具 | 参数 | 结果 |
| --- | --- | --- |
| `blog_list` | `query?`, `source?: all/published/draft` | 检索文章/草稿，最多 50 条，返回匹配总数、截断标记和本地日期 |
| `blog_read` | `source: published/draft`, `id`, `offset?` | Markdown、SHA-256 revision、长度、下一页 offset；每页最多 32,000 字符 |
| `blog_write_draft` | `filename`, `title`, `abstract`, `body`, `expectedRevision`, `creators?` | 原子创建或修改草稿，返回路径及新 revision |
| `blog_preview` | `filename` | 在消息内展示保存时的草稿快照与 Markdown 下载链接 |

公开文章的 `id` 是 `blog_list` 返回的 slug；草稿 `id` 是带 `.md` 的文件名。草稿路径固定为 `/workspace/blog-drafts/YYYY-MM-DD-slug.md`，日期须有效，slug 使用小写英文、数字、连字符，文件名最多 160 字符。目录首次写入时自动创建。公开文章的 Markdown 由构建时的文章内容和元数据重建，可能与源文件的空白、YAML 排版不同。

`title` 为单行，最多 200 字符；`abstract` 最多 1000 字符；`body` 不含顶层标题/元数据，最多 60,000 字符。三项均非空。插件输出兼容当前博客格式：

```markdown
---
abstract: 文章摘要
creators:
  - deepseek
---

# 文章标题

正文……
```

新建时 `expectedRevision: null`，拒绝覆盖已有文件。修改先 `blog_read`，使用它的完整 SHA-256 revision；提交时同时校验读到的原文，避免校验后发生的并发覆盖。长文章应读取全部分页再改写，分页中发现 revision 改变应重新读取。坏元数据可通过明确传入 `creators` 的完整替换修复。

`creators` 可用值与 `src/blog-metadata.ts` 一致。省略时，新稿标记当前已知服务商（内置 DeepSeek 解锁连接为 `deepseek`，官方 OpenAI 地址为 `openai`）；更新保留旧标记并补充当前服务商。明确传入时替换旧标记，仍补充当前服务商。未知或外部注入连接不猜测服务商；`human` 只在用户确认人的实际贡献时添加。

预览最多 100,000 字符，下载包含完整 YAML 和正文。链接对应当次预览快照；继续修改后需重新预览取得新文件。预览与下载不自动发布。刷新后草稿仍在，可重新让 agent 读取预览，也可退出后使用 `edit /workspace/blog-drafts/文件名.md`、`export /workspace/blog-drafts/文件名.md`。要发布，把下载的 Markdown 放入源码 `blog/`，按现有流程构建部署。

## 扩展接口

`src/agent/plugins/types.ts` 定义 `AgentPlugin`：

```ts
interface AgentPlugin {
  id: string
  title: string
  instructions: string
  tools: AgentTool[]
  dispose?: () => void
}
```

在新文件中导出工厂，利用 `defineTool` 定义 JSON schema、运行时参数校验和 `execute`。示例：

```ts
import { defineTool, textResult } from '../types.ts'
import type { AgentPlugin } from './types.ts'

export function createWordCountPlugin(): AgentPlugin {
  return {
    id: 'word-count', title: '文本计数',
    instructions: 'Use count_characters to count Unicode code points in text.',
    tools: [defineTool({
      name: 'count_characters', description: 'Count Unicode code points.',
      parameters: {
        type: 'object', properties: { text: { type: 'string' } },
        required: ['text'], additionalProperties: false,
      },
      parseArguments(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid arguments')
        const value = input as Record<string, unknown>
        if (Object.keys(value).some(key => key !== 'text') || typeof value.text !== 'string' || value.text.length > 64000) throw new Error('Invalid text')
        return { text: value.text }
      },
      async execute(_id, { text }, signal) {
        signal.throwIfAborted()
        return textResult(String(Array.from(text).length))
      },
    })],
  }
}
```

在 `src/agent/plugins/index.ts` 导出工厂，再加入 `AgentTerminal.tsx` 中 `registerPlugins([...], createWorkspaceTools(...))` 的工厂列表。注册器拒绝重复插件 ID 或重复工具名，并合并工具与系统指令；`/plugins` 自动列出新增工具。只有工具声明与文本结果进入当前 DeepSeek 传输，UI 附件放在 `ToolResult.details`，不会作为 Markdown 正文重复传给模型。

插件工厂不得触发网络或启动 Worker：React 初始化可能重复调用。资源按需建立，`dispose` 必须可重复调用，并允许下次执行重新建立资源。耗时工具要响应 `AbortSignal`，异步写入在提交前再次检查；使用工作区事务 API，不能仅靠模型自觉处理冲突。新增 UI 操作需参加现有双向 Tab 循环、支持 IME 和手机点击，统计仍在底栏，内容保持终端字号。

本次实现按用户要求未运行测试、构建或浏览器验证。

## GitHub 在线管理

内置 github-blog 插件管理 `prettydong/prettydong.github.io` 的 `blog/`。解锁后通过 `/github` 或底栏 GitHub 连接，使用专用令牌框，不向对话发送凭据。支持实时列表、源文读取、草稿发布、文章删除和部署状态查询；发布/删除需浏览器确认，覆盖使用 blob SHA 防止冲突。令牌在清空、锁定、退出、刷新后清除。完整步骤见 [部署文档](github-pages.md)。
