import { describe, it, expect } from 'vitest'
import { FEATURES } from '../../../src/lib/featureFlags'

describe('featureFlags', () => {
  describe('FEATURES', () => {
    it('should export PREMIUM_ENABLED flag', () => {
      expect(FEATURES).toHaveProperty('PREMIUM_ENABLED')
    })

    it('should have PREMIUM_ENABLED as boolean', () => {
      expect(typeof FEATURES.PREMIUM_ENABLED).toBe('boolean')
    })

    it('should have PREMIUM_ENABLED set to true by default', () => {
      expect(FEATURES.PREMIUM_ENABLED).toBe(true)
    })

    it('should have readonly values (as const)', () => {
      // as const makes values readonly at type level
      // TypeScript prevents reassignment at compile time
      const premiumValue: true = FEATURES.PREMIUM_ENABLED
      expect(premiumValue).toBe(true)
    })

    it('should have expected shape', () => {
      const keys = Object.keys(FEATURES)
      expect(keys).toContain('PREMIUM_ENABLED')
      expect(keys.length).toBe(1)
    })
  })
})
