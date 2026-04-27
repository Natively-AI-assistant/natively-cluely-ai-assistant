import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cn } from '../../../src/lib/utils'

describe('cn — property-based tests', () => {
  it('always returns a string', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.constant(undefined))),
        (classes) => {
          const result = cn(...(classes as (string | undefined)[]))
          expect(typeof result).toBe('string')
        },
      ),
    )
  })

  it('returns empty string when all inputs are falsy', () => {
    fc.assert(
      fc.property(fc.array(fc.constant(undefined)), (classes) => {
        expect(cn(...(classes as (string | undefined)[]))).toBe('')
      }),
    )
  })

  it('output contains all non-falsy input strings', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 })), (classes) => {
        const result = cn(...(classes as (string | undefined)[]))
        for (const cls of classes as string[]) {
          expect(result).toContain(cls)
        }
      }),
    )
  })

  it('output length equals sum of input lengths plus separators', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 })),
        (classes) => {
          const result = cn(...(classes as (string | undefined)[]))
          const expectedLength = (classes as string[]).join(' ').length
          expect(result.length).toBe(expectedLength)
        },
      ),
    )
  })

  it('idempotent: calling twice gives same result', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.constant(undefined))),
        (classes) => {
          const args = classes as (string | undefined)[]
          const result1 = cn(...args)
          const result2 = cn(...args)
          expect(result1).toBe(result2)
        },
      ),
    )
  })
})
