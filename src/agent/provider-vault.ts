export interface ProviderCredentials { baseUrl: string; model: string; apiKey: string }
export interface EncryptedProvider {
  version: 1
  kdf: 'PBKDF2-SHA256'
  iterations: 600000
  salt: string
  iv: string
  ciphertext: string
}
const iterations = 600000
const encoder = new TextEncoder()
const additionalData = encoder.encode('zed-system-agent-provider-v1')
const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
const unbase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

export function validateProviderCredentials(value: unknown): ProviderCredentials {
  const config = value as Partial<ProviderCredentials> | null
  if (!config || typeof config.baseUrl !== 'string' || typeof config.model !== 'string' || !config.model.trim()
    || typeof config.apiKey !== 'string' || !config.apiKey.trim() || /[\r\n]/.test(config.apiKey)) throw new Error('模型配置无效。')
  let url: URL
  try { url = new URL(config.baseUrl) } catch { throw new Error('Base URL 必须是完整地址。') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 需使用 HTTPS，且不能包含凭据、查询参数或片段；本机服务可使用 HTTP。')
  }
  return { baseUrl: url.href.replace(/\/+$/, ''), model: config.model.trim(), apiKey: config.apiKey.trim() }
}

async function deriveKey(password: string, salt: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error('密码解锁需要 HTTPS 或 localhost 环境。')
  const bytes = encoder.encode(password)
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey'])
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  } finally { bytes.fill(0) }
}

/** Used by the local configuration CLI; only the returned ciphertext is written to disk. */
export async function encryptProvider(config: ProviderCredentials, password: string): Promise<EncryptedProvider> {
  if (Array.from(password).length < 8) throw new Error('解锁密码至少需要 8 个字符。')
  const plaintext = encoder.encode(JSON.stringify(validateProviderCredentials(config)))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    const key = await deriveKey(password, salt)
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plaintext)
    return { version: 1, kdf: 'PBKDF2-SHA256', iterations, salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) }
  } finally { plaintext.fill(0) }
}

export async function decryptProvider(envelope: unknown, password: string): Promise<ProviderCredentials> {
  const value = envelope as Partial<EncryptedProvider> | null
  if (!value || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== iterations
    || typeof value.salt !== 'string' || typeof value.iv !== 'string' || typeof value.ciphertext !== 'string'
    || value.ciphertext.length > 64000) throw new Error('加密配置格式无效。')
  if (!globalThis.crypto?.subtle) throw new Error('密码解锁需要 HTTPS 或 localhost 环境。')
  let plaintext: Uint8Array | undefined
  try {
    const salt = unbase64(value.salt), iv = unbase64(value.iv), ciphertext = unbase64(value.ciphertext)
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) throw new Error('Invalid envelope')
    const key = await deriveKey(password, salt)
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, ciphertext))
    return validateProviderCredentials(JSON.parse(new TextDecoder().decode(plaintext)))
  } catch { throw new Error('密码错误或加密配置已损坏。') }
  finally { plaintext?.fill(0) }
}
