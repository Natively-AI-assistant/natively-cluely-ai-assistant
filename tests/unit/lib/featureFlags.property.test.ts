import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FEATURES } from '../../../src/lib/featureFlags'

describe('Feature flags — invariant tests', () => {
  it('PREMIUM_ENABLED is always a boolean after repeated access', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100 }), (n) => {
        for (let i = 0; i < n; i++) {
          expect(typeof FEATURES.PREMIUM_ENABLED).toBe('boolean')
        }
      }),
    )
  })

  it('FEATURES object shape is stable under repeated enumeration', () => {
    const initialKeys = Object.keys(FEATURES)
    fc.assert(
      fc.property(fc.nat({ max: 50 }), () => {
        expect(Object.keys(FEATURES)).toEqual(initialKeys)
      }),
    )
  })

  it('FEATURES values do not mutate under repeated access', () => {
    const snapshotted = { ...FEATURES }
    fc.assert(
      fc.property(fc.nat({ max: 100 }), () => {
        expect(FEATURES.PREMIUM_ENABLED).toBe(snapshotted.PREMIUM_ENABLED)
      }),
    )
  })
})
