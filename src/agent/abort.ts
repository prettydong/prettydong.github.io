/** Abort waiting even if an injected stream ignores its signal. Its underlying work must cooperate. */
export function abortable<T>(run: () => T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return }
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return run() })
      .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
