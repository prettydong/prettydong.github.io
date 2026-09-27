import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { writeFile, rename, rm } from 'node:fs/promises'
import { encryptProvider, validateProviderCredentials } from '../src/agent/provider-vault.ts'

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('请在本机交互终端运行 npm run agent:configure。')
  process.exit(1)
}
let hidden = false
const output = new Writable({ write(chunk, _encoding, callback) { if (!hidden) process.stdout.write(chunk); callback() } })
const prompt = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 })
let interrupted = false
const inputAbort = new AbortController()
prompt.on('SIGINT', () => { interrupted = true; inputAbort.abort(); prompt.close() })
prompt.on('close', () => { interrupted = true; inputAbort.abort() })
async function ask(label, secret = false) {
  if (interrupted) throw new Error('已取消。')
  if (secret) process.stdout.write(label)
  hidden = secret
  try {
    const answer = await prompt.question(secret ? '' : label, { signal: inputAbort.signal })
    if (interrupted) throw new Error('已取消。')
    return answer
  } finally { hidden = false; if (secret) process.stdout.write('\n') }
}
const target = new URL('../src/agent/provider-config.json', import.meta.url)
const temporary = new URL(`../src/agent/.provider-config-${process.pid}.tmp`, import.meta.url)
try {
  const baseUrl = (await ask('Base URL [https://api.deepseek.com]: ')).trim() || 'https://api.deepseek.com'
  const model = (await ask('模型名称 [deepseek-flash]: ')).trim() || 'deepseek-flash'
  let apiKey = await ask('API key（隐藏输入）: ', true)
  let password = await ask('解锁密码（至少 8 字符，隐藏输入）: ', true)
  let confirmation = await ask('再次输入密码: ', true)
  if (password !== confirmation) throw new Error('两次密码不一致，未写入配置。')
  const encrypted = await encryptProvider(validateProviderCredentials({ baseUrl, model, apiKey }), password)
  apiKey = ''; password = ''; confirmation = ''
  await writeFile(temporary, JSON.stringify(encrypted, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await rename(temporary, target)
  console.log('已写入加密配置。重新构建并部署后，在 agent 中输入密码解锁。')
} catch (error) {
  console.error(interrupted ? '已取消。' : error instanceof Error ? error.message : '配置失败。')
  process.exitCode = 1
} finally { prompt.close(); await rm(temporary, { force: true }) }
