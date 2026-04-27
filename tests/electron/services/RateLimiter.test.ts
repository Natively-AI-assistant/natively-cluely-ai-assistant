import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProviderRateLimiters,
  RateLimiter,
} from '../../../electron/services/RateLimiter'

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    if (rateLimiter) {
      rateLimiter.destroy()
    }
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should create instance with max tokens', () => {
      rateLimiter = new RateLimiter(10, 1)
      expect(rateLimiter).toBeInstanceOf(RateLimiter)
    })
  })

  describe('acquire', () => {
    it('should allow acquiring when tokens available', async () => {
      rateLimiter = new RateLimiter(10, 1)
      await expect(rateLimiter.acquire()).resolves.toBeUndefined()
    })

    it('should consume tokens on acquire', async () => {
      rateLimiter = new RateLimiter(2, 1)

      await rateLimiter.acquire()
      await rateLimiter.acquire()

      // Third acquire should wait
      const acquirePromise = rateLimiter.acquire()

      // Advance time to trigger refill
      vi.advanceTimersByTime(1100)

      await expect(acquirePromise).resolves.toBeUndefined()
    })

    it('should queue requests when bucket empty', async () => {
      rateLimiter = new RateLimiter(1, 0.5)

      await rateLimiter.acquire()

      // Second acquire should wait
      const acquirePromise = rateLimiter.acquire()

      // Advance time to trigger refill (need 2 seconds for 1 token at 0.5/sec)
      vi.advanceTimersByTime(2100)

      await expect(acquirePromise).resolves.toBeUndefined()
    })

    it('should process queue in order', async () => {
      rateLimiter = new RateLimiter(1, 1)

      await rateLimiter.acquire()

      const order: number[] = []
      const acquire1 = rateLimiter.acquire().then(() => order.push(1))
      const acquire2 = rateLimiter.acquire().then(() => order.push(2))
      const acquire3 = rateLimiter.acquire().then(() => order.push(3))

      // Advance time to refill tokens
      vi.advanceTimersByTime(3100)

      await Promise.all([acquire1, acquire2, acquire3])

      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('refill', () => {
    it('should refill tokens over time', async () => {
      rateLimiter = new RateLimiter(10, 1)

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.acquire()
      }

      // Should not be able to acquire immediately
      const acquirePromise = rateLimiter.acquire()

      // Advance time to trigger refill
      vi.advanceTimersByTime(1100)

      await expect(acquirePromise).resolves.toBeUndefined()
    })

    it('should not exceed max tokens', async () => {
      rateLimiter = new RateLimiter(5, 10)

      // Wait for potential refill
      vi.advanceTimersByTime(5000)

      // Should still be able to acquire max tokens
      for (let i = 0; i < 5; i++) {
        await rateLimiter.acquire()
      }

      // Next acquire should wait
      const acquirePromise = rateLimiter.acquire()
      vi.advanceTimersByTime(1100)
      await expect(acquirePromise).resolves.toBeUndefined()
    })
  })

  describe('destroy', () => {
    it('should clear refill timer', () => {
      rateLimiter = new RateLimiter(10, 1)
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

      rateLimiter.destroy()

      expect(clearIntervalSpy).toHaveBeenCalled()
    })

    it('should release all waiting requests', async () => {
      rateLimiter = new RateLimiter(1, 0.01) // Very slow refill

      await rateLimiter.acquire()

      const acquirePromise = rateLimiter.acquire()

      // Destroy should resolve the waiting request
      rateLimiter.destroy()

      await expect(acquirePromise).resolves.toBeUndefined()
    })

    it('should be safe to call multiple times', () => {
      rateLimiter = new RateLimiter(10, 1)
      rateLimiter.destroy()
      expect(() => rateLimiter.destroy()).not.toThrow()
    })
  })
})

describe('createProviderRateLimiters', () => {
  let limiters: ReturnType<typeof createProviderRateLimiters>

  beforeEach(() => {
    vi.useFakeTimers()
    limiters = createProviderRateLimiters()
  })

  afterEach(() => {
    Object.values(limiters).forEach((limiter: RateLimiter) => limiter.destroy())
    vi.useRealTimers()
  })

  it('should create limiters for all providers', () => {
    expect(limiters).toHaveProperty('groq')
    expect(limiters).toHaveProperty('gemini')
    expect(limiters).toHaveProperty('openai')
    expect(limiters).toHaveProperty('claude')
  })

  it('should create RateLimiter instances', () => {
    Object.values(limiters).forEach((limiter) => {
      expect(limiter).toBeInstanceOf(RateLimiter)
    })
  })

  it('should configure groq with correct limits', async () => {
    // Groq: 6 req/min = 0.1 tokens/sec
    // Should allow 6 immediate requests
    for (let i = 0; i < 6; i++) {
      await limiters.groq.acquire()
    }

    // 7th should wait
    const acquirePromise = limiters.groq.acquire()
    vi.advanceTimersByTime(11000) // Need 10 seconds for 1 token at 0.1/sec
    await expect(acquirePromise).resolves.toBeUndefined()
  })

  it('should configure gemini with correct limits', async () => {
    // Gemini: 120 req/min = 2 tokens/sec
    // Should allow many immediate requests (test with smaller number)
    for (let i = 0; i < 10; i++) {
      await limiters.gemini.acquire()
    }

    // Should still be able to acquire more
    const acquirePromise = limiters.gemini.acquire()
    vi.advanceTimersByTime(600) // Need 0.5 seconds for 1 token at 2/sec
    await expect(acquirePromise).resolves.toBeUndefined()
  })
})
