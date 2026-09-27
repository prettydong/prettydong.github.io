import type { OutputLine } from './index'

function validBytes(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function size(bytes: number | undefined) {
  if (!validBytes(bytes)) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let index = 0
  while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index += 1 }
  return `${index ? bytes.toFixed(1) : bytes.toFixed(0)} ${units[index]}`
}

export async function diskUsage(): Promise<OutputLine[]> {
  if (!navigator.storage?.estimate) return [{ text: '当前浏览器不支持存储统计。', tone: 'error' }]
  let estimate: StorageEstimate
  try { estimate = await navigator.storage.estimate() }
  catch { return [{ text: '无法读取本站存储占用。', tone: 'error' }] }
  const { usage, quota } = estimate
  const comparable = validBytes(usage) && validBytes(quota)
  const available = comparable ? Math.max(0, quota - usage) : undefined
  const percentage = comparable && quota > 0 ? usage / quota * 100 : undefined
  const percent = percentage === undefined ? '—' : percentage > 0 && percentage < 0.01 ? '<0.01%' : `${percentage.toFixed(2)}%`
  return [
    { text: '本站浏览器存储（估算）', tone: 'accent' },
    { text: `已用  ${size(usage)}  /  配额 ${size(quota)}`, tone: 'value' },
    { text: `可用  ${size(available)}  ·  使用率 ${percent}`, tone: 'info' },
  ]
}
