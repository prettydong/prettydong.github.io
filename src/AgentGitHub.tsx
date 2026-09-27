import { useEffect, useRef, useState } from 'react'
import { GitHubBlogSession, githubRepository } from './agent/plugins/github'

export function AgentGitHub({ session }: { session: GitHubBlogSession }) {
  const token = useRef<HTMLInputElement>(null)
  const [connected, setConnected] = useState(session.connected)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { token.current?.focus(); return () => { if (token.current) token.current.value = '' } }, [])
  async function connect() {
    if (busy) return
    const value = token.current?.value ?? ''
    if (token.current) token.current.value = ''
    setBusy(true); setNotice('')
    try { await session.connect(value); setConnected(true) }
    catch (error) { setConnected(false); setNotice(error instanceof Error ? error.message : '连接失败。') }
    finally { setBusy(false) }
  }
  return <div className="agent-github">
    <div>GitHub / {githubRepository}</div>
    {connected ? <><span>已连接 </span><button onClick={() => { session.disconnect(); setConnected(false); setNotice('') }}>断开</button></> : <>
      <label>令牌 <input ref={token} type="password" autoComplete="off" aria-label="GitHub 令牌" disabled={busy} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!event.repeat) void connect() }
      }} /></label> <button disabled={busy} onClick={() => void connect()}>{busy ? '连接中' : '连接'}</button>
      <div><a href="https://github.com/settings/personal-access-tokens/new?name=Zed%20Blog&target_name=prettydong&contents=write&actions=read" target="_blank" rel="noopener noreferrer">创建仓库令牌</a> · 仅选择 prettydong.github.io，Contents 读写、Actions 只读。</div>
    </>}
    {notice && <div role="status">{notice}</div>}
  </div>
}
