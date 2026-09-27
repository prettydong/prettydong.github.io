import { parse } from 'yaml'

export const blogCreators = {
  human: 'Zed Huang',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
} as const

export type BlogCreator = keyof typeof blogCreators

export function parseBlogContent(raw: string, path: string) {
  let content = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  let abstract: string | undefined
  let creators: BlogCreator[] = []
  if (content.startsWith('---\n')) {
    const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(content)
    if (!frontmatter) throw new Error(`${path}: 文章元数据缺少结束的 ---`)
    try {
      const metadata: unknown = parse(frontmatter[1])
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('元数据必须是字段对象')
      }
      const fields = metadata as Record<string, unknown>
      if (typeof fields.abstract !== 'string' || !fields.abstract.trim()) {
        throw new Error('abstract 必须是非空文本')
      }
      if (!Array.isArray(fields.creators) || !fields.creators.every(
        (creator): creator is BlogCreator => typeof creator === 'string' && Object.hasOwn(blogCreators, creator),
      )) {
        throw new Error(`creators 必须是数组，可用值：${Object.keys(blogCreators).join(', ')}`)
      }
      abstract = fields.abstract.trim().replace(/\s+/g, ' ')
      creators = [...new Set(fields.creators)]
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    content = content.slice(frontmatter[0].length).trim()
  }
  // Older articles retain their excerpt without inventing an authorship attribution.
  const firstParagraph = content.split(/\n\s*\n/).find(block => !/^[#>`~|\-\*\d]/.test(block.trim())) ?? ''
  return {
    abstract: abstract ?? firstParagraph.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 160),
    creators,
    content,
  }
}
