import { describe, expect, it } from 'vitest'
import { cn } from '../../../src/lib/utils'

describe('utils', () => {
  describe('cn', () => {
    it('merges multiple class strings', () => {
      expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz')
    })

    it('filters out undefined arguments', () => {
      expect(cn('foo', undefined, 'bar')).toBe('foo bar')
    })

    it('filters out empty strings', () => {
      expect(cn('foo', '', 'bar')).toBe('foo bar')
    })

    it('returns empty string for no arguments', () => {
      expect(cn()).toBe('')
    })

    it('returns empty string when all inputs are falsy', () => {
      expect(cn('', undefined, '')).toBe('')
    })

    it('handles Tailwind class merging with mixed valid and invalid inputs', () => {
      expect(cn('bg-blue-500', undefined, 'text-white', '', 'p-4')).toBe(
        'bg-blue-500 text-white p-4',
      )
    })

    it('preserves whitespace-containing class strings', () => {
      expect(cn('foo bar', 'baz')).toBe('foo bar baz')
    })

    it('handles single class string', () => {
      expect(cn('foo')).toBe('foo')
    })
  })
})
