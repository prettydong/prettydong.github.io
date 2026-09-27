import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Agent } from './agent/agent'
import { createWorkspaceTools } from './agent/workspace-tools'
import { createBlogPlugin, createPythonPlugin, registerPlugins } from './agent/plugins'
import { blogPosts } from './blog-content'
import type { BlogCreator } from './blog-metadata'
import { AgentGitHub } from './AgentGitHub'
import { GitHubBlogSession, createGitHubBlogPlugin } from './agent/plugins/github'
import { AgentBlogPreview } from './AgentBlogPreview'
import { configureAgent, getAgentStream, isAgentConfigured, subscribeAgentConfiguration } from './agent/runtime'
import encryptedProvider from './agent/provider-config.json'
import { decryptProvider } from './agent/provider-vault'
import { createOpenAICompatibleStream } from './agent/openai-compatible'
import { userMessage, type AgentMessage, type AssistantMessage, type InferenceOptions, type StreamFn } from './agent/types'
import { defaultPreferences, effortLabels, outputLimits, readPreferences, reasoningEfforts, savePreferences, type AgentPreferences } from './agent/preferences'
import { summarizeUsage } from './agent/telemetry'
import { AgentReasoning, FooterTelemetry, compactTokens, usageViews, type UsageView } from './AgentTelemetry'
import { localSystem } from './system'
import { MarkdownOutput } from './MarkdownOutput'

type Props = { cwd: string; footerHost: HTMLElement | null; onClose: () => void; onStatus: (status: string) => void }
const disconnected: StreamFn = () => { throw new Error('尚未连接模型接口。') }
export function AgentTerminal({ cwd, footerHost, onClose, onStatus }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const footer = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const activeStream = useRef<StreamFn>(disconnected)
  const passwordInput = useRef<HTMLInputElement>(null)
  const unlockGeneration = useRef(0)
  const ownedStream = useRef<StreamFn | null>(null)
  const activeInference = useRef<InferenceOptions>({})
  const runStarted = useRef(0)
  const providerCreator = useRef<BlogCreator | null>(null)
  const [githubSession] = useState(() => new GitHubBlogSession())
  const [githubOpen, setGithubOpen] = useState(false)
  const [plugins] = useState(() => registerPlugins([
    createPythonPlugin(localSystem, cwd),
    createGitHubBlogPlugin(localSystem, githubSession),
    createBlogPlugin(localSystem, blogPosts, () => ownedStream.current && activeStream.current === ownedStream.current ? providerCreator.current : null),
  ], createWorkspaceTools(localSystem, cwd)))
  const [agent] = useState(() => new Agent({
    systemPrompt: `You are the assistant in Zed System, a browser terminal. Work inside /workspace. Current directory: ${cwd}. Use the supplied tools for actual file operations. Report results accurately; never claim a file was changed without a successful tool result.

${plugins.instructions}

回复规则：
- 使用用户的语言，直接回答当前问题，默认只用 1–3 个短句；能用一句话说清就只用一句。
- 只保留回答问题或交付任务必需的内容。不扩展话题，不主动建议下一步，不罗列可选操作，不以问题结尾。
- 不反问，不要求用户选择或确认。信息不足时，仅简短说明缺少的必要信息；不能执行时，仅说明具体阻碍，不猜测原因、不编造结果。
- 不复述用户的问题，不寒暄、不道歉铺垫、不评价用户，不讲述检索、检查或思考过程。
- 默认不用标题、分节和总结。不输出无关目录、文件清单、工具名称或实现细节；用户明确索要的清单、代码、文章等交付内容应完整提供，不受默认句数限制。
- 查无结果时直接说未找到；用户的前提与实际不符时，只给出已核实的事实，不推测其他设备、其他位置或用户意图。
- 对执行请求直接使用工具完成，最终只报告结果和必需的文件路径或限制。以上规则约束你生成的回复，不要向用户复述这些规则。

示例：用户询问有几篇博客，工具返回 1 篇已发布文章和 0 篇草稿。回复：目前有 1 篇已发布文章《从这里开始》，没有草稿。`,
    tools: plugins.tools, streamFn: (context, options) => activeStream.current(context, { ...options, inference: activeInference.current }),
  }))
  const [state, setState] = useState(agent.state)
  const [draft, setDraft] = useState('')
  const [queued, setQueued] = useState<{ message: AgentMessage; kind: string }[]>([])
  const [notice, setNotice] = useState('')
  const [password, setPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [preferences, setPreferences] = useState(readPreferences)
  const [provider, setProvider] = useState<{ model: string; deepseek: boolean } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [usageView, setUsageView] = useState<UsageView>('session')
  const [runStartIndex, setRunStartIndex] = useState(0)
  const [phase, setPhase] = useState('WAITING')
  const [clock, setClock] = useState(0)
  const configured = useSyncExternalStore(subscribeAgentConfiguration, isAgentConfigured)
  const locked = Boolean(encryptedProvider) && !configured
  const isLocalDraft = draft.trim().startsWith('/') && !draft.trim().startsWith('//')
  const canSend = Boolean(draft.trim()) && (configured || state.isRunning || isLocalDraft)
  const telemetryMessages = state.streamMessage ? [...state.messages, state.streamMessage] : state.messages
  const sessionUsage = summarizeUsage(telemetryMessages)
  const runUsage = summarizeUsage(telemetryMessages.slice(runStartIndex))
  const lastResponse = [...telemetryMessages].reverse().find((message): message is AssistantMessage => message.role === 'assistant' && Boolean(message.model || message.usage))

  useEffect(() => {
    const unsubscribe = agent.subscribe(event => {
      setState(agent.state)
      if (event.type === 'turn_start') setPhase('WAITING')
      if (event.type === 'tool_execution_start') setPhase('TOOLS')
      if (event.type === 'message_update') {
        if (event.assistantMessageEvent.type === 'reasoning_delta') setPhase('THINKING')
        if (event.assistantMessageEvent.type === 'text_delta') setPhase('RESPONDING')
        if (event.assistantMessageEvent.type === 'toolcall_delta') setPhase('TOOL CALL')
      }
      if (event.type === 'message_end' && event.message.role === 'user') {
        const message = event.message
        setQueued(items => items.filter(item => item.message.timestamp !== message.timestamp || item.message.role !== 'user' || item.message.content !== message.content))
      }
    })
    return () => {
      unsubscribe(); agent.abort(); agent.clearQueues(); plugins.dispose(); unlockGeneration.current++
      if (ownedStream.current && isAgentConfigured() && getAgentStream() === ownedStream.current) configureAgent({})
      ownedStream.current = null; activeStream.current = disconnected; providerCreator.current = null
    }
  }, [agent, plugins])
  useEffect(() => {
    onStatus(unlocking ? 'UNLOCKING' : locked ? 'LOCKED' : state.isRunning ? `${phase} · ${Math.max(0, Math.floor((clock - runStarted.current) / 1000))}s` : configured ? 'READY' : '未连接模型接口')
  }, [configured, state.isRunning, onStatus, locked, unlocking, phase, clock])
  useEffect(() => {
    if (!state.isRunning) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state.isRunning])
  useLayoutEffect(() => { (locked ? passwordInput.current : input.current)?.focus({ preventScroll: true }) }, [locked])
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    root.current?.scrollIntoView({ block: 'nearest' })
    const scroll = root.current?.parentElement
    if (!scroll) return
    const track = () => { followOutput.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48 }
    scroll.addEventListener('scroll', track)
    return () => scroll.removeEventListener('scroll', track)
  }, [])
  useLayoutEffect(() => {
    const scroll = root.current?.parentElement
    if (scroll && followOutput.current) scroll.scrollTop = scroll.scrollHeight
  }, [state, queued, notice])
  useLayoutEffect(() => {
    if (input.current) { input.current.style.height = 'auto'; input.current.style.height = `${Math.min(input.current.scrollHeight, 150)}px` }
  }, [draft, locked])
  useLayoutEffect(() => {
    if (helpOpen) {
      const help = root.current?.querySelector<HTMLElement>('.agent-help')
      help?.focus({ preventScroll: true }); help?.scrollIntoView({ block: 'nearest' })
    }
  }, [helpOpen])
  useLayoutEffect(() => {
    if (pluginsOpen) root.current?.querySelector('.agent-plugins')?.scrollIntoView({ block: 'nearest' })
  }, [pluginsOpen])

  function changeUsageView(next?: UsageView) {
    setUsageView(current => next ?? usageViews[(usageViews.indexOf(current) + 1) % usageViews.length])
    footer.current?.querySelector('.agent-usage-view')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function updatePreferences(next: AgentPreferences) {
    if (agent.state.isRunning) { setNotice('请先停止当前任务再调整设置。'); return }
    setPreferences(next); savePreferences(next); setNotice('')
  }
  function localCommand(value: string) {
    if (!value.startsWith('/') || value.startsWith('//')) return false
    const [command, ...args] = value.split(/\s+/)
    setDraft(''); setNotice('')
    switch (command.toLowerCase()) {
      case '/help': if (args.length) break; setHelpOpen(open => !open); return true
      case '/github': if (args.length) break; if (agent.state.isRunning) setNotice('请先停止当前任务。'); else setGithubOpen(open => !open); return true
      case '/plugins': if (args.length) break; setPluginsOpen(open => !open); return true
      case '/usage':
        if (args.length > 1 || (args[0] && !usageViews.includes(args[0] as UsageView))) { setNotice('用法：/usage [session|run|last]'); return true }
        changeUsageView(args[0] as UsageView | undefined); return true
      case '/think': {
        const effort = args[0] === 'off' ? 'none' : args[0]
        if (args.length !== 1 || !reasoningEfforts.includes(effort as AgentPreferences['reasoningEffort'])) { setNotice('用法：/think off|low|high|max'); return true }
        if (!provider?.deepseek) { setNotice('当前连接未提供思考强度控制。'); return true }
        updatePreferences({ ...preferences, reasoningEffort: effort as AgentPreferences['reasoningEffort'] }); return true
      }
      case '/limit': {
        const maxOutputTokens = Number(args[0])
        if (args.length !== 1 || !/^\d+$/.test(args[0]) || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 65536) { setNotice('用法：/limit 256–65536'); return true }
        if (!provider) { setNotice('当前连接未提供输出上限控制。'); return true }
        updatePreferences({ ...preferences, maxOutputTokens }); return true
      }
      case '/clear': if (args.length) break; if (agent.state.isRunning) setNotice('请先停止当前任务。'); else clear(); return true
      case '/stop': if (args.length) break; stop(); return true
      case '/lock': if (args.length) break; if (ownedStream.current) lock(); else setNotice('当前连接无需密码锁定。'); return true
      case '/exit': if (args.length) break; close(); return true
      default: setNotice('未知指令。输入 /help 查看帮助；以 // 开头发送普通文本。'); return true
    }
    setNotice(`${command} 不接受参数。`); return true
  }

  async function send(followUp = false) {
    if (!canSend) return
    const content = draft.trim()
    if (localCommand(content)) { input.current?.focus({ preventScroll: true }); return }
    const message = userMessage(content.startsWith('//') ? content.slice(1) : content)
    setDraft(''); setNotice('')
    if (agent.state.isRunning) {
      if (followUp) agent.followUp(message)
      else agent.steer(message)
      setQueued(items => [...items, { message, kind: followUp ? '排队' : '补充' }])
      input.current?.focus({ preventScroll: true })
      return
    }
    activeStream.current = getAgentStream()
    activeInference.current = provider ? { maxOutputTokens: preferences.maxOutputTokens, ...(provider.deepseek ? { reasoningEffort: preferences.reasoningEffort } : {}) } : {}
    setRunStartIndex(agent.state.messages.length); runStarted.current = Date.now(); setClock(runStarted.current); setPhase('WAITING')
    const promise = agent.prompt(message)
    setState(agent.state)
    input.current?.focus({ preventScroll: true })
    try {
      const result = await promise
      if (result.reason === 'max_turns') setNotice('已达到本次轮次上限。')
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { activeStream.current = disconnected; setState(agent.state) }
  }
  async function unlock() {
    if (unlocking || !password) return
    const generation = ++unlockGeneration.current
    const submitted = password
    setPassword(''); setUnlocking(true); setNotice('')
    try {
      const credentials = await decryptProvider(encryptedProvider, submitted)
      if (generation !== unlockGeneration.current) return
      let githubError = ''
      if (credentials.githubToken) {
        try { await githubSession.connect(credentials.githubToken) }
        catch (error) { githubError = error instanceof Error ? error.message : 'GitHub 连接失败。' }
        if (generation !== unlockGeneration.current) return
      }
      const streamFn = createOpenAICompatibleStream({ baseUrl: credentials.baseUrl, model: credentials.model, apiKey: credentials.apiKey })
      ownedStream.current = streamFn
      const hostname = new URL(credentials.baseUrl).hostname
      providerCreator.current = hostname === 'api.deepseek.com' ? 'deepseek' : hostname === 'api.openai.com' ? 'openai' : null
      setProvider({ model: credentials.model, deepseek: hostname === 'api.deepseek.com' })
      configureAgent({ streamFn })
      if (githubError) setNotice(`模型已解锁；${githubError}`)
    } catch (error) {
      if (generation === unlockGeneration.current) setNotice(error instanceof Error ? error.message : '解锁失败。')
    } finally {
      if (generation === unlockGeneration.current) { setUnlocking(false); passwordInput.current?.focus({ preventScroll: true }) }
    }
  }
  function lock() {
    agent.abort(); agent.clearQueues(); plugins.dispose(); setGithubOpen(false); setQueued([]); setNotice(''); setPassword('')
    unlockGeneration.current++; setUnlocking(false)
    ownedStream.current = null; activeStream.current = disconnected; providerCreator.current = null; setProvider(null); configureAgent({})
  }
  function stop() { agent.clearQueues(); setQueued([]); agent.abort(); input.current?.focus({ preventScroll: true }) }
  function close() { agent.abort(); agent.clearQueues(); plugins.dispose(); onClose() }
  function clear() { agent.reset(); plugins.plugins.filter(plugin => plugin.id !== 'github-blog').forEach(plugin => plugin.dispose?.()); setGithubOpen(false); setState(agent.state); setRunStartIndex(0); setQueued([]); setNotice(''); input.current?.focus({ preventScroll: true }) }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const controls = [...Array.from(root.current?.querySelectorAll<HTMLElement>('input, textarea, button, a, summary') ?? []),
        ...Array.from(footer.current?.querySelectorAll<HTMLElement>('button') ?? [])]
        .filter(item => !item.matches(':disabled') && item.getClientRects().length > 0 && !item.closest('[hidden], [inert]'))
      const index = controls.indexOf(document.activeElement as HTMLElement)
      const next = index < 0 ? event.shiftKey ? controls.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      ;(controls[next] ?? root.current)?.focus()
      return
    }
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); if (!event.repeat) { if (agent.state.isRunning) stop(); else close() }; return
    }
    if (event.target === passwordInput.current && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); if (!event.repeat) void unlock(); return
    }
    if (event.key.toLowerCase() === 'c' && event.ctrlKey && !event.metaKey && !event.altKey && state.isRunning && window.getSelection()?.isCollapsed) {
      event.preventDefault(); stop(); return
    }
    if (event.target === input.current && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); if (!event.repeat) void send(event.altKey)
    }
  }
  function renderMessage(message: AgentMessage, index: number, live = false) {
    if (message.role === 'custom') return null
    if (message.role === 'user') return <div key={index} className="agent-user"><span className="agent-prefix">you ›</span><span>{message.content}</span></div>
    if (message.role === 'toolResult') return <details key={index} open={message.toolName === 'blog_preview' && !message.isError ? true : undefined} className={`agent-tool-result ${message.isError ? 'agent-error' : ''}`}>
      <summary>{message.isError ? '×' : '✓'} {message.toolName}</summary>
      <pre>{message.content.map(part => part.text).join('\n')}</pre>
      {!message.isError && message.toolName === 'blog_preview' && <AgentBlogPreview details={message.details} />}
    </details>
    return <div key={index} className="agent-assistant">
      <AgentReasoning message={message} live={live} />
      {message.content.map((part, i) => part.type === 'text' ? <MarkdownOutput key={i} content={part.text} />
        : state.messages.slice(index + 1).some(next => next.role === 'toolResult' && next.toolCallId === part.id) ? null : <div key={i} className="agent-tool-call">{state.pendingToolCalls.includes(part.id) ? '…' : '›'} {part.name}</div>)}
      {message.errorMessage && <div className="agent-error" role="status">{message.stopReason === 'aborted' ? '已停止。' : message.errorMessage}</div>}
    </div>
  }
  return <div ref={root} className="agent-session" aria-label="Agent 交互" tabIndex={-1} onKeyDown={onKeyDown}>
    {!locked && githubOpen && <AgentGitHub session={githubSession} />}
    {!locked && helpOpen && <div className="agent-help" tabIndex={-1}>
      <div>/think off|low|high|max　思考强度</div><div>/limit 256–65536　每次模型请求的输出上限，包含思考</div>
      <div>/usage [session|run|last]　切换底栏用量　 /clear　清空会话</div><div>/stop　停止　 /lock　锁定　 /exit　返回终端</div>
      <div>/github　连接 GitHub　 /plugins　查看插件　 /help　收起帮助</div>
      <div>可直接要求执行 Python、检索博客、写入草稿和预览。预览内可下载 Markdown。</div>
      <div>↑ 输入　↓ 输出　Σ 合计　R 缓存命中　T 思考　+ 已知小计</div>
      <div>Enter 发送 · Shift+Enter 换行 · Alt+Enter 排队</div><div>Tab / Shift+Tab 切换 · Esc 停止或返回 · Ctrl+C 停止</div>
      <div>设置在下次任务生效；运行中先停止再调整。// 开头发送普通文本。</div>
      {provider && <button disabled={state.isRunning} onClick={() => updatePreferences({ ...defaultPreferences })}>恢复默认设置</button>}
    </div>}
    {!locked && pluginsOpen && <div className="agent-help agent-plugins">
      {plugins.plugins.map(plugin => <div key={plugin.id}>{plugin.id} · {plugin.title}<br />{plugin.tools.map(tool => tool.name).join(' · ')}</div>)}
      <button onClick={() => { setPluginsOpen(false); input.current?.focus({ preventScroll: true }) }}>收起插件</button>
    </div>}
    <div className="agent-messages">{state.messages.map((message, index) => renderMessage(message, index))}
      {state.streamMessage && renderMessage(state.streamMessage, state.messages.length, true)}
      {queued.map((item, index) => <div key={index} className="agent-queued">{item.kind} › {item.message.role === 'user' ? item.message.content : ''}</div>)}
    </div>
    {notice && <div role="status" className="agent-error">{notice}</div>}
    {locked ? <div className="agent-prompt"><label className="agent-prefix" htmlFor="agent-password">密码 ›</label>
      <input ref={passwordInput} id="agent-password" aria-label="Agent 解锁密码" type="password" autoComplete="off" spellCheck={false} autoCapitalize="off" readOnly={unlocking}
        value={password} onChange={event => setPassword(event.target.value)} />
      <button disabled={unlocking || !password} onClick={() => void unlock()}>{unlocking ? '解锁中' : '解锁'}</button>
    </div> : <div className="agent-prompt"><span className="agent-prefix">❯</span>
      <textarea ref={input} rows={1} aria-label="输入 Agent 消息" spellCheck={false} autoCapitalize="off" value={draft} onChange={event => setDraft(event.target.value)} />
      <button disabled={!canSend} onClick={() => void send()}>{state.isRunning ? '补充' : '发送'}</button>
    </div>}
    {footerHost && createPortal(<div ref={footer} className="agent-footer">
      <div className="agent-footer-scroll">
        {locked ? <span>ENTER 解锁</span> : <>
          <FooterTelemetry session={sessionUsage} run={runUsage} last={lastResponse} view={usageView} onCycle={() => changeUsageView()} />
          <div className="agent-footer-model">
            {provider && <span>{provider.model}</span>}
            {provider?.deepseek && <button disabled={state.isRunning} aria-label="调整思考强度" onClick={() => updatePreferences({ ...preferences, reasoningEffort: reasoningEfforts[(reasoningEfforts.indexOf(preferences.reasoningEffort) + 1) % reasoningEfforts.length] })}>思考 {effortLabels[preferences.reasoningEffort]}</button>}
            {provider && <button disabled={state.isRunning} aria-label="调整输出上限" onClick={() => updatePreferences({ ...preferences, maxOutputTokens: outputLimits.find(value => value > preferences.maxOutputTokens) ?? outputLimits[0] })}>上限 {compactTokens(preferences.maxOutputTokens)}</button>}
          </div>
          <button disabled={state.isRunning} aria-expanded={githubOpen} onClick={() => setGithubOpen(open => !open)}>GitHub</button>
          <button aria-expanded={helpOpen} onClick={() => setHelpOpen(open => !open)}>/help</button>
          {ownedStream.current && configured && <button onClick={lock}>锁定</button>}
          <button onClick={clear} disabled={state.isRunning}>清空</button>
        </>}
      </div>
      <div className="agent-footer-actions"><span title="Tab / Shift+Tab 切换操作；Esc 停止或返回">TAB/⇧TAB · ESC</span>
        {state.isRunning ? <button onClick={stop}>停止</button> : <button onClick={close}>返回</button>}</div>
    </div>, footerHost)}
  </div>
}
