import { useEffect, useState } from 'react'
import type { JsonValue } from './agent/types'
import { MarkdownOutput } from './MarkdownOutput'

export function AgentBlogPreview({ details }: { details: JsonValue | undefined }) {
  const artifact = details && typeof details === 'object' && !Array.isArray(details) && details.type === 'blog-draft' ? details : null
  const markdown = typeof artifact?.markdown === 'string' ? artifact.markdown : ''
  const filename = typeof artifact?.filename === 'string' ? artifact.filename : ''
  const body = typeof artifact?.body === 'string' ? artifact.body : ''
  const [url, setUrl] = useState('')
  const valid = Boolean(markdown && markdown.length <= 100000 && /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(filename))
  useEffect(() => {
    if (!valid) { setUrl(''); return }
    const next = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [markdown, valid])
  if (!valid) return null
  return <div className="agent-blog-preview">
    {url && <a href={url} download={filename}>下载 {filename}</a>}
    <MarkdownOutput content={body} />
  </div>
}
