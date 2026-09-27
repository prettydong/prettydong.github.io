import { useEffect, useLayoutEffect, useRef } from 'react'
import { blogPosts, filterBlog } from './blog-content'
import { MarkdownOutput } from './MarkdownOutput'
import { BlogCreators } from './BlogCreators'

export function Blog({ query, slug, welcome, onQueryChange, onOpen, onBack, onBrowse, onHome, onClose }: {
  query: string
  slug: string | null
  welcome: boolean
  onQueryChange: (query: string) => void
  onOpen: (slug: string) => void
  onBack: () => void
  onBrowse: () => void
  onHome: () => void
  onClose: () => void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const browseRef = useRef<HTMLButtonElement>(null)
  const listPosition = useRef(0)
  const selectedSlug = useRef<string | null>(slug)
  const post = blogPosts.find(item => item.slug === slug)
  const posts = filterBlog(query)

  function openPost(nextSlug: string) {
    listPosition.current = resultsRef.current?.scrollTop ?? 0
    selectedSlug.current = nextSlug
    onOpen(nextSlug)
  }

  useLayoutEffect(() => {
    if (welcome) {
      browseRef.current?.focus({ preventScroll: true })
    } else if (slug) {
      if (articleRef.current) articleRef.current.scrollTop = 0
      articleRef.current?.focus({ preventScroll: true })
    } else {
      if (resultsRef.current) resultsRef.current.scrollTop = listPosition.current
      const selected = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-post]') ?? [])
        .find(button => button.dataset.post === selectedSlug.current)
      if (selected) selected.focus({ preventScroll: true })
      else if (window.innerWidth > 760) searchRef.current?.focus({ preventScroll: true })
      else rootRef.current?.focus({ preventScroll: true })
    }
  }, [slug, welcome])

  useEffect(() => {
    listPosition.current = 0
    if (resultsRef.current) resultsRef.current.scrollTop = 0
  }, [query])

  useEffect(() => {
    const terminal = rootRef.current?.closest('main')
    function controls(): HTMLElement[] {
      const content = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-blog-control], article[tabindex], article a[href]') ?? [])
      const footer = Array.from(terminal?.querySelectorAll<HTMLElement>('.blog-footer button') ?? [])
      return [...content, ...footer].filter(item => !item.matches(':disabled')
        && !item.closest('[inert], [hidden], [aria-hidden="true"]') && item.getClientRects().length > 0)
    }
    function focusItem(item?: HTMLElement) {
      if (!item) return
      item.focus({ preventScroll: true })
      if (item.matches('[data-post], article a')) item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    function focusSearch() {
      focusItem(searchRef.current ?? undefined)
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && target !== document.body && !terminal?.contains(target)) return
      const editing = target?.matches('input, textarea, [contenteditable="true"]')
      if (event.key === 'Tab') {
        event.preventDefault()
        const items = controls()
        if (!items.length) { rootRef.current?.focus({ preventScroll: true }); return }
        const index = items.indexOf(document.activeElement as HTMLElement)
        const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length
        focusItem(items[next])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (event.repeat) return
        if (slug) onBack()
        else if (!welcome && query) { onQueryChange(''); focusSearch() }
        else onClose()
        return
      }
      if (!welcome && event.key.toLowerCase() === 'h' && !event.shiftKey && !editing) {
        event.preventDefault()
        if (!event.repeat) onHome()
        return
      }
      if (welcome) {
        // Native Enter/Space activates whichever button is actually focused.
        if (event.key === 'Enter' && !event.shiftKey && !target?.closest('button, a') && !event.repeat) {
          event.preventDefault()
          onBrowse()
        } else if (!event.shiftKey && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault()
          const items = controls()
          const index = items.indexOf(document.activeElement as HTMLElement)
          focusItem(items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length])
        }
        return
      }
      if (!slug && !event.shiftKey) {
        const articles = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-post]') ?? [])
        if (event.key === '/' && !editing) {
          event.preventDefault()
          focusSearch()
          searchRef.current?.select()
        } else if (event.key === 'Enter' && target === searchRef.current) {
          event.preventDefault()
          if (!event.repeat && posts[0]) openPost(posts[0].slug)
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const items: HTMLElement[] = searchRef.current ? [searchRef.current, ...articles] : articles
          if (!items.length) return
          const index = items.indexOf(document.activeElement as HTMLElement)
          const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
            : event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1)
              : index === 0 ? items.length - 1 : index - 1
          focusItem(items[next])
        } else if (!editing && ['Home', 'End'].includes(event.key)) {
          event.preventDefault()
          focusItem(event.key === 'Home' ? articles[0] ?? searchRef.current ?? undefined
            : articles.at(-1) ?? searchRef.current ?? undefined)
        }
        return
      }
      if (slug && !editing) {
        const reader = articleRef.current
        const readingSpace = event.key === ' ' && !target?.closest('button, a')
        const scrollingKey = !event.shiftKey && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)
        if (!reader || (!readingSpace && !scrollingKey)) return
        event.preventDefault()
        if (event.key === 'Home') reader.scrollTop = 0
        else if (event.key === 'End') reader.scrollTop = reader.scrollHeight
        else reader.scrollBy({ top: (event.key === 'ArrowUp' || event.key === 'PageUp' || (readingSpace && event.shiftKey) ? -1 : 1)
          * (readingSpace || event.key.startsWith('Page') ? reader.clientHeight * .85 : 48) })
      }
    }
    terminal?.addEventListener('keydown', onKeyDown)
    return () => terminal?.removeEventListener('keydown', onKeyDown)
  })

  return <section ref={rootRef} className="blog" data-view={welcome ? 'welcome' : post ? 'article' : 'list'} aria-label="博客" tabIndex={-1}>
    <div className="blog-stage">
      <div className="blog-top-space" aria-hidden="true" />
      <header className="blog-hero">
        <button className="blog-art-button blog-control" data-blog-control onClick={welcome ? onBrowse : onHome}
          aria-label={welcome ? '浏览文章' : '返回博客首页'}>
          <img className="blog-welcome-art" src={`${import.meta.env.BASE_URL}blog/bulma-openai-time-machine.png`}
            width={1536} height={1024} alt="布尔玛开发时间机器，机身与工作服上带有 OpenAI 标志" draggable={false} />
        </button>
        <div className="blog-profile">
          <p className="blog-profile-label">Zed System / Blog</p>
          <h1>Zed Huang</h1>
          <p className="blog-profile-role">
            <span className="blog-profile-work">AI Agent 开发者</span>
            <span className="blog-profile-interests">NBA 球迷 · 游戏玩家</span>
          </p>
          <div className="blog-intro-actions" inert={!welcome} aria-hidden={!welcome}>
            <div className="blog-entry">
              <span className="blog-entry-count">{blogPosts.length} 篇文章</span>
              <button ref={browseRef} className="blog-browse blog-control" data-blog-control onClick={onBrowse}>浏览文章</button>
            </div>
          </div>
        </div>
      </header>
      <div className="blog-content" inert={welcome} aria-hidden={welcome}>
    {!welcome && (post ? <article ref={articleRef} className="blog-reader" aria-label={post.title} tabIndex={-1}>
      <header className="blog-article-metadata">
        <h1>{post.title}</h1>
        <BlogCreators creators={post.creators} />
        {post.abstract && <p className="blog-abstract" aria-label="摘要">{post.abstract}</p>}
      </header>
      <MarkdownOutput content={post.content.replace(/^#\s+.+(?:\n|$)/m, '')} />
    </article> : <div className="blog-list-view">
      <div className="blog-search">
        <div className="blog-search-field">
        <span className="blog-search-cursor" aria-hidden="true">›</span>
        <input data-blog-control ref={searchRef} aria-label="搜索博客" placeholder="搜索文章" value={query} autoComplete="off" autoCapitalize="off" spellCheck={false}
          onChange={event => onQueryChange(event.target.value)} />
        </div>
        <button className="blog-control" data-blog-control disabled={!query} onClick={() => { onQueryChange(''); searchRef.current?.focus() }}>清空</button>
      </div>
      <div ref={resultsRef} className="blog-results">
        <ul className="blog-list">{posts.map(item => <li key={item.slug}>
          <button className="blog-control" data-blog-control data-post={item.slug} onClick={() => openPost(item.slug)}>
            <span className="blog-post-heading"><span className="blog-post-title">{item.title}</span>
              <span className="blog-post-meta"><BlogCreators creators={item.creators} />{item.date && <time dateTime={item.date}>{item.date}</time>}</span>
            </span>
            {item.abstract && <span className="blog-abstract">{item.abstract}</span>}
          </button>
        </li>)}</ul>
        {!posts.length && <p className="blog-empty" role="status">{blogPosts.length ? '没有匹配的文章' : '暂无文章'}</p>}
      </div>
    </div>)}
      </div>
    </div>
  </section>
}
