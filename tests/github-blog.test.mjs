import test from 'node:test'
import assert from 'node:assert/strict'
import { GitHubBlogSession, createGitHubBlogPlugin, articleFilename } from '../src/agent/plugins/github.ts'

const markdown = '---\nabstract: 测试摘要\ncreators: [human]\n---\n\n# 测试标题\n\n中文正文\n'
const sha = 'a'.repeat(40)
const signal = () => new AbortController().signal
const workspace = { readFile: async path => { assert.equal(path, '/workspace/blog-drafts/2026-09-28-test.md'); return markdown } }
const tool = (plugin, name) => plugin.tools.find(t => t.name === name)
const run = (t, args) => t.execute('one', t.parseArguments(args), signal(), async () => {})

async function withFetch(fn) {
 const original = globalThis.fetch
 const requests = []
 globalThis.fetch = async (url, options) => {
  requests.push({url, options})
  if (url.endsWith('/user')) return Response.json({login:'prettydong'})
  if (url.endsWith('prettydong.github.io')) return Response.json({permissions:{push:true}})
  if (options.method === 'PUT' || options.method === 'DELETE') return Response.json({commit:{sha,html_url:'https://github.com/prettydong/prettydong.github.io/commit/'+sha}})
  return Response.json({encoding:'base64',size:Buffer.byteLength(markdown),content:Buffer.from(markdown).toString('base64'),sha})
 }
 try { await fn(requests) } finally { globalThis.fetch = original }
}

test('reject path traversal and invalid dates before network', () => {
 for (const value of ['../README.md','2026-02-30-test.md','2026-09-28-Test.md','2026-09-28-test.md/evil']) assert.throws(() => articleFilename(value))
 assert.equal(articleFilename('2026-09-28-test.md'), '2026-09-28-test.md')
})

test('publish confirms exact UTF-8 snapshot and uses expected SHA, never returns token', async () => withFetch(async requests => {
 const session = new GitHubBlogSession(); await session.connect('test-secret')
 let review = ''
 const plugin = createGitHubBlogPlugin(workspace,session,text => {review=text;return true})
 const result = await run(tool(plugin,'github_blog_publish'), {filename:'2026-09-28-test.md',expectedSha:sha})
 assert.ok(review.includes(markdown))
 const write = requests.at(-1)
 assert.equal(write.url,'https://api.github.com/repos/prettydong/prettydong.github.io/contents/blog/2026-09-28-test.md')
 const body = JSON.parse(write.options.body)
 assert.equal(body.sha,sha);assert.equal(body.branch,'master')
 assert.equal(Buffer.from(body.content,'base64').toString(),markdown)
 assert.ok(!JSON.stringify(result).includes('test-secret'))
 assert.equal(JSON.parse(result.content[0].text).deployment,'pending')
 plugin.dispose();assert.equal(session.connected,false)
 await assert.rejects(run(tool(plugin,'github_blog_list'),{}),/连接 GitHub/)
}))

test('cancelled publish/delete performs no mutation', async () => withFetch(async requests => {
 const session = new GitHubBlogSession();await session.connect('test-secret')
 const plugin = createGitHubBlogPlugin(workspace,session,() => false)
 await assert.rejects(run(tool(plugin,'github_blog_publish'),{filename:'2026-09-28-test.md',expectedSha:null}),/取消/)
 await assert.rejects(run(tool(plugin,'github_blog_delete'),{filename:'2026-09-28-test.md',expectedSha:sha}),/取消/)
 assert.ok(requests.every(r => r.options.method==='GET'))
}))

test('read Unicode source and preserve SHA for conflict detection', async () => withFetch(async () => {
 const session = new GitHubBlogSession();await session.connect('test-secret')
 const plugin = createGitHubBlogPlugin(workspace,session)
 const result = await run(tool(plugin,'github_blog_read'),{filename:'2026-09-28-test.md'})
 const data = JSON.parse(result.content[0].text)
 assert.equal(data.markdown,markdown);assert.equal(data.sha,sha)
 assert.throws(() => tool(plugin,'github_blog_publish').parseArguments({filename:'2026-09-28-test.md',expectedSha:'invalid'}))
}))

test('conflict errors do not forward credential-bearing server responses', async () => {
 const session = new GitHubBlogSession()
 await withFetch(async () => {await session.connect('test-secret')})
 const original = globalThis.fetch
 globalThis.fetch = async () => Response.json({message:'test-secret'}, {status:409})
 try {await assert.rejects(session.request('https://api.github.com/repos/prettydong/prettydong.github.io'), error => /版本冲突/.test(error.message) && !error.message.includes('test-secret'))} finally {globalThis.fetch=original}
})
