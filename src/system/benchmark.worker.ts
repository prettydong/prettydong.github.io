export {}

const scope = globalThis as unknown as { onmessage: (() => void) | null; postMessage: (value: unknown) => void }

function integerSample(duration: number) {
  let value = 0x12345678
  let operations = 0
  const started = performance.now()
  do {
    for (let index = 0; index < 8192; index += 1) {
      value = Math.imul(value ^ (value >>> 13), 1597334677)
      value ^= value << 7
    }
    operations += 8192
  } while (performance.now() - started < duration)
  return { rate: operations / (performance.now() - started) * 1000, checksum: value }
}

function floatingSample(duration: number) {
  let value = 0.6180339887
  let operations = 0
  const started = performance.now()
  do {
    for (let index = 0; index < 8192; index += 1) value = Math.sqrt(value + 1.25) * 0.75 + 0.125
    operations += 8192
  } while (performance.now() - started < duration)
  return { rate: operations / (performance.now() - started) * 1000, checksum: value }
}

scope.onmessage = () => {
  integerSample(150)
  floatingSample(150)
  const integer = []
  const floating = []
  for (let round = 0; round < 3; round += 1) {
    integer.push(integerSample(250))
    floating.push(floatingSample(250))
  }
  // Return the computed values as well as timings so the loops have observable results.
  scope.postMessage({ integer, floating })
}
