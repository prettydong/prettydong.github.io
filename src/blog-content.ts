/// <reference types="vite/client" />
import { blogCreators, parseBlogContent, type BlogCreator } from './blog-metadata'

export interface BlogPost {
  slug: string
  title: string
  date: string
  abstract: string
  creators: BlogCreator[]
  content: string
}

// File names supply the date; the first H1 supplies the title. README is author documentation.
const files = import.meta.glob<string>('../blog/*.md', { query: '?raw', import: 'default', eager: true })

// Reboot the development workspace when compiled content changes, keeping module state in sync.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())

export const blogPosts: BlogPost[] = Object.entries(files)
  .filter(([path]) => !/\/readme\.md$/i.test(path))
  .map(([path, raw]) => {
    const slug = path.slice(path.lastIndexOf('/') + 1, -3)
    const { abstract, creators, content } = parseBlogContent(raw, path)
    const heading = /^#\s+(.+)$/m.exec(content)
    return {
      slug,
      title: heading?.[1].trim() || slug,
      date: /^\d{4}-\d{2}-\d{2}(?=-)/.exec(slug)?.[0] ?? '',
      abstract,
      creators,
      content,
    }
  })
  .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))

export function filterBlog(query: string): BlogPost[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return blogPosts.filter(post => terms.every(term => `${post.title} ${post.date} ${post.abstract} ${post.creators.map(creator => blogCreators[creator]).join(' ')} ${post.content}`.toLocaleLowerCase().includes(term)))
}
