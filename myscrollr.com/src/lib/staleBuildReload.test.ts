import { describe, expect, it, vi } from 'vitest'
import { reloadOnceForStaleBuild } from './staleBuildReload'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('reloadOnceForStaleBuild', () => {
  it('reloads on the first missing script file and not on the second', () => {
    const storage = memoryStorage()
    const reload = vi.fn()

    const first = new Event('vite:preloadError', { cancelable: true })
    expect(reloadOnceForStaleBuild(first, { storage, reload })).toBe(true)
    expect(first.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)

    // The reload did not help: let the error through instead of looping.
    const second = new Event('vite:preloadError', { cancelable: true })
    expect(reloadOnceForStaleBuild(second, { storage, reload })).toBe(false)
    expect(second.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload when session storage is blocked', () => {
    const reload = vi.fn()
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    const event = new Event('vite:preloadError', { cancelable: true })
    expect(reloadOnceForStaleBuild(event, { storage, reload })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
