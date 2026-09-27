import { useEffect, useRef } from 'react'

const PORTAL_GROUPS = [
  { name: 'AI', tone: 'label', links: [
    { name: 'ChatGPT', keywords: 'OpenAI 人工智能 聊天', url: 'https://chatgpt.com/', description: '对话与创作' },
    { name: 'Claude', keywords: 'Anthropic 人工智能 聊天', url: 'https://claude.ai/', description: '对话与写作' },
  ] },
  { name: '开发', tone: 'info', links: [
    { name: 'GitHub', keywords: '代码仓库 开源 git', url: 'https://github.com/', description: '代码与项目' },
    { name: 'MDN', keywords: 'Mozilla 文档 前端 JavaScript CSS HTML', url: 'https://developer.mozilla.org/zh-CN/', description: 'Web 开发文档' },
  ] },
  { name: '阅读', tone: 'positive', links: [
    { name: '维基百科', keywords: 'Wikipedia wiki 知识', url: 'https://zh.wikipedia.org/', description: '百科查询' },
    { name: 'Hacker News', keywords: 'HN 新闻 科技', url: 'https://news.ycombinator.com/', description: '技术社区' },
  ] },
  { name: '日常', tone: 'value', links: [
    { name: '哔哩哔哩', keywords: 'bilibili B站 动画', url: 'https://www.bilibili.com/', description: '视频' },
    { name: '高德地图', keywords: 'amap 导航 路线', url: 'https://www.amap.com/', description: '地图与出行' },
  ] },
]

export function filterPortal(query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return PORTAL_GROUPS.map(group => ({ ...group, links: group.links.filter(link =>
    terms.every(term => `${group.name} ${link.name} ${link.description} ${link.keywords} ${new URL(link.url).hostname}`.toLocaleLowerCase().includes(term)),
  ) })).filter(group => group.links.length)
}

export function Portal({ query, onQueryChange, onClose }: {
  query: string
  onQueryChange: (query: string) => void
  onClose: () => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const portalRef = useRef<HTMLElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0
  }, [query])
  useEffect(() => {
    if (window.innerWidth > 760) searchRef.current?.focus()
  }, [])
  const groups = filterPortal(query)
  const links = groups.flatMap(group => group.links)
  function searchWeb() {
    if (query.trim()) window.open(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`, '_blank', 'noopener,noreferrer')
  }
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      const target = event.target as HTMLElement | null
      const editing = target?.matches('input, textarea, [contenteditable="true"]')
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        if (!event.repeat) searchWeb()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === '/' && !editing) {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      const anchors = Array.from(portalRef.current?.querySelectorAll<HTMLAnchorElement>('.portal-group a') ?? [])
      const index = anchors.indexOf(document.activeElement as HTMLAnchorElement)
      if (event.key === 'Tab') {
        event.preventDefault()
        if (!anchors.length) {
          searchRef.current?.focus()
          return
        }
        const nextIndex = index < 0 ? (event.shiftKey ? anchors.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + anchors.length) % anchors.length
        anchors[nextIndex].focus({ preventScroll: true })
        anchors[nextIndex].scrollIntoView({ block: 'nearest' })
        return
      }
      if (event.shiftKey) return
      let next: number | undefined
      // Follow the rendered columns, including when filtering changes the grid.
      const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp'
      const horizontal = !editing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      if (vertical || horizontal) {
        if (index < 0) {
          if (vertical) next = event.key === 'ArrowDown' ? 0 : anchors.length - 1
        } else {
          const origin = anchors[index].getBoundingClientRect()
          const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
          const candidates = anchors.map((anchor, candidateIndex) => {
            const rect = anchor.getBoundingClientRect()
            const dx = rect.left + rect.width / 2 - origin.left - origin.width / 2
            const dy = rect.top + rect.height / 2 - origin.top - origin.height / 2
            return { index: candidateIndex, distance: (vertical ? dy : dx) * (forward ? 1 : -1), offset: Math.abs(vertical ? dx : dy) }
          }).filter(candidate => candidate.distance > 1 && (!vertical || candidate.offset < origin.width / 2))
          candidates.sort((a, b) => a.offset - b.offset || a.distance - b.distance)
          next = candidates[0]?.index ?? index
        }
      }
      if (!editing && event.key === 'Home') next = 0
      if (!editing && event.key === 'End') next = anchors.length - 1
      if (next !== undefined && anchors.length) {
        event.preventDefault()
        anchors[next]?.focus({ preventScroll: true })
        anchors[next]?.scrollIntoView({ block: 'nearest' })
      } else if (!editing && /^[1-9]$/.test(event.key)) {
        const anchor = anchors[Number(event.key) - 1]
        if (anchor) {
          event.preventDefault()
          if (!event.repeat) anchor.click()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })
  return <section ref={portalRef} className="portal" aria-label="个人导航">
    <div className="portal-search">
      <div className="portal-search-field"><span className="portal-search-marker" aria-hidden="true">&gt;</span><input ref={searchRef} aria-label="筛选网站或输入搜索关键词" placeholder="筛选网站 / 输入搜索关键词" value={query}
        autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={event => onQueryChange(event.target.value)} /></div>
      <button disabled={!query.trim()} title="Ctrl/⌘+Enter" onClick={searchWeb}>Google 搜索</button>
      <button disabled={!query} onClick={() => { onQueryChange(''); searchRef.current?.focus() }}>清空</button>
    </div>
    <div ref={resultsRef} className="portal-results">
    <div className="portal-groups">
      {groups.map(group => <section className="portal-group" data-tone={group.tone} key={group.name} aria-label={group.name}>
        <h2>{group.name}</h2>
        <ul>{group.links.map(link => <li key={link.url}>
          <a href={link.url} onPointerMove={event => {
            if (event.pointerType !== 'mouse' || (!event.movementX && !event.movementY)) return
            const active = document.activeElement
            if (active?.matches('input, textarea, [contenteditable="true"]')) return
            event.currentTarget.focus({ preventScroll: true })
          }} title={`${new URL(link.url).hostname} · 在新标签页打开`} target="_blank" rel="noopener noreferrer"><span><span className="portal-number" aria-hidden="true">{links.indexOf(link) + 1}</span>{link.name}</span><span className="portal-description">{link.description}</span></a>
        </li>)}</ul>
      </section>)}
    </div>
    {!groups.length && <p className="portal-empty" role="status">没有匹配“{query.trim()}”的网站</p>}
    </div>
  </section>
}
