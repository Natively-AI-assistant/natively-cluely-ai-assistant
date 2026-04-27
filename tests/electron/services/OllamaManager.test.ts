import { spawn } from 'node:child_process'
import treeKill from 'tree-kill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OllamaManager } from '../../../electron/services/OllamaManager'

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    on: vi.fn(),
    kill: vi.fn(),
  })),
}))

vi.mock('tree-kill', () => ({
  default: vi.fn((_pid, _signal, cb) => cb(null)),
}))

describe('OllamaManager', () => {
  let ollamaManager: OllamaManager

  beforeEach(() => {
    ;(OllamaManager as any).instance = undefined
    vi.useFakeTimers()
    ollamaManager = OllamaManager.getInstance()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('getInstance', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = OllamaManager.getInstance()
      const instance2 = OllamaManager.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('init', () => {
    it('should not start Ollama if already running', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = fetchMock

      await ollamaManager.init()

      expect(fetchMock).toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
    })

    it('should start Ollama if not running and poll until ready', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true })
      global.fetch = fetchMock

      await ollamaManager.init()

      vi.advanceTimersByTime(5000)

      expect(spawn).toHaveBeenCalledWith(
        'ollama',
        ['serve'],
        expect.any(Object),
      )
      expect(fetchMock).toHaveBeenCalled()
    })
  })

  describe('stop', () => {
    it('should not throw when stopping without init', () => {
      expect(() => ollamaManager.stop()).not.toThrow()
    })

    it('should kill process if app managed it', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false })
      global.fetch = fetchMock

      await ollamaManager.init()
      vi.advanceTimersByTime(5000)

      ollamaManager.stop()

      expect(treeKill).toHaveBeenCalledWith(
        12345,
        'SIGTERM',
        expect.any(Function),
      )
    })
  })
})
