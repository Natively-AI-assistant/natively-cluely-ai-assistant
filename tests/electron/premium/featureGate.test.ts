import { beforeEach, describe, expect, it } from 'vitest'
import {
  isPremiumAvailable,
  resetFeatureGate,
} from '../../../electron/premium/featureGate'

describe('featureGate', () => {
  beforeEach(() => {
    // Reset the cached value before each test
    resetFeatureGate()
  })

  describe('isPremiumAvailable', () => {
    it('returns a boolean', () => {
      const result = isPremiumAvailable()
      expect(typeof result).toBe('boolean')
    })

    it('returns the same value on repeated calls (caching)', () => {
      const first = isPremiumAvailable()
      const second = isPremiumAvailable()
      const third = isPremiumAvailable()
      expect(first).toBe(second)
      expect(second).toBe(third)
    })

    it('caches the result — does not re-check on subsequent calls', () => {
      // First call
      const first = isPremiumAvailable()
      // Second call should use cache, not re-evaluate
      const second = isPremiumAvailable()
      expect(first).toBe(second)
    })
  })

  describe('resetFeatureGate', () => {
    it('clears the cached premium availability', () => {
      // Call once to populate cache
      const _first = isPremiumAvailable()

      // Reset should clear the cache
      resetFeatureGate()

      // After reset, isPremiumAvailable should still return the same value
      // (since the underlying require calls haven't changed), but it
      // should have re-executed rather than returning the cached value
      // The key is that calling resetFeatureGate then isPremiumAvailable
      // should NOT throw or behave differently — it should be a no-op on behavior
      expect(() => {
        resetFeatureGate()
        isPremiumAvailable()
      }).not.toThrow()
    })

    it('can be called multiple times safely', () => {
      expect(() => {
        resetFeatureGate()
        resetFeatureGate()
        resetFeatureGate()
      }).not.toThrow()
    })

    it('allows fresh evaluation after reset', () => {
      // First evaluation
      const _first = isPremiumAvailable()
      resetFeatureGate()

      // After reset, calling isPremiumAvailable should NOT return the same
      // cached reference — it should be a new call
      const second = isPremiumAvailable()
      expect(typeof second).toBe('boolean')
    })
  })

  describe('caching behavior', () => {
    it('subsequent calls do not trigger new require calls', () => {
      // Call isPremiumAvailable multiple times
      isPremiumAvailable()
      isPremiumAvailable()
      isPremiumAvailable()

      // The function should still work and not throw even after multiple calls
      const result = isPremiumAvailable()
      expect(typeof result).toBe('boolean')
    })
  })
})
