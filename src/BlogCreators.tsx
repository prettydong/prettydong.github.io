import type { CSSProperties } from 'react'
import { blogCreators, type BlogCreator } from './blog-metadata'

export function BlogCreators({ creators }: { creators: BlogCreator[] }) {
  return <span className="blog-creators" role="group"
    aria-label={`创作者：${creators.length ? creators.map(creator => blogCreators[creator]).join('、') : '未标注'}`}>
    {creators.length ? creators.map(creator => <span className="blog-creator" key={creator}
      role="img" aria-label={blogCreators[creator]} title={blogCreators[creator]}>
      {creator === 'human' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7h-1c-2.5 0-4-1-5.5-3L3 13a1.6 1.6 0 0 1 2.5-2L8 13Z" />
      </svg> : <span className="blog-creator-logo" aria-hidden="true"
        style={{ '--creator-logo': `url("${import.meta.env.BASE_URL}blog/creators/${creator}.svg")` } as CSSProperties} />}
    </span>) : <span className="blog-creators-unknown">未标注</span>}
  </span>
}
