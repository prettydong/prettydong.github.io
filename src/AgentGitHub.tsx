import { useEffect, useRef, useState } from 'react'
import { GitHubBlogSession, githubRepository } from './agent/plugins/github'
import encryptedProvider from './agent/provider-config.json'
import { decryptProvider } from './agent/provider-vault'

export function AgentGitHub({ session }: { session: GitHubBlogSession }) {
  const passwordMode = Boolean(encryptedProvider && 'githubConfigured' in encryptedProvider && encryptedProvider.githubConfigured)
  const token = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const [connected, setConnected] = useState(session.connected)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { mounted.current = true; token.current?.focus(); return () => { mounted.current = false; if (token.current) token.current.value = '' } }, [])
  async function connect() {
    if (busy) return
    const value = token.current?.value ?? ''
    if (token.current) token.current.value = ''
    setBusy(true); setNotice('')
    try {
      const credential = passwordMode ? (await decryptProvider(encryptedProvider, value)).githubToken : value
      if (!mounted.current) return
      if (!credential) throw new Error('尚未配置 GitHub 令牌。')
      await session.connect(credential); setConnected(true)
    }
    catch (error) { setConnected(false); setNotice(error instanceof Error ? error.message : '连接失败。') }
    finally { setBusy(false) }
  }
  return <div className="agent-github">
    <div>GitHub / {githubRepository}</div>
    {connected ? <><span>已连接 </span><button onClick={() => { session.disconnect(); setConnected(false); setNotice('') }}>断开</button></> : <>
      <label>{passwordMode ? '密码' : '令牌'} <input ref={token} type="password" autoComplete="off" aria-label={passwordMode ? 'GitHub 解锁密码' : 'GitHub 令牌'} disabled={busy} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!event.repeat) void connect() }
      }} /></label> <button disabled={busy} onClick={() => void connect()}>{busy ? '连接中' : '连接'}</button>
      {!passwordMode && <div><a href="https://github.com/settings/personal-access-tokens/new?name=Zed%20Blog&target_name=prettydong&contents=write&actions=read" target="_blank" rel="noopener noreferrer">创建仓库令牌</a> · 仅选择 prettydong.github.io，Contents 读写、Actions 只读。</div>}
    </>}
    {notice && <div role="status">{notice}</div>}
  </div>
}
