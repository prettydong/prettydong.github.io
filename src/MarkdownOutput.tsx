import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

export const MarkdownOutput = memo(function MarkdownOutput({ content }: { content: string }) {
  return <div className="markdown-output">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} skipHtml components={{
      a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
      table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
    }}>{content}</ReactMarkdown>
  </div>
})
