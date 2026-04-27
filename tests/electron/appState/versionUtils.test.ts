/**
 * Tests for versionUtils.ts - pure version comparison functions.
 */

import { describe, expect, it } from 'vitest'
import { isVersionNewer } from '../../../electron/appState/versionUtils'

describe('isVersionNewer', () => {
  describe('patch version bumps', () => {
    it('returns true when latest is newer patch version', () => {
      expect(isVersionNewer('1.0.0', '1.0.1')).toBe(true)
    })

    it('returns false when current is newer patch version', () => {
      expect(isVersionNewer('1.0.1', '1.0.0')).toBe(false)
    })
  })

  describe('minor version bumps', () => {
    it('returns true when latest is newer minor version', () => {
      expect(isVersionNewer('1.0.0', '1.1.0')).toBe(true)
    })

    it('returns false when current is newer minor version', () => {
      expect(isVersionNewer('1.1.0', '1.0.0')).toBe(false)
    })
  })

  describe('major version bumps', () => {
    it('returns true when latest is newer major version', () => {
      expect(isVersionNewer('1.0.0', '2.0.0')).toBe(true)
    })

    it('returns false when current is newer major version', () => {
      expect(isVersionNewer('2.0.0', '1.0.0')).toBe(false)
    })
  })

  describe('same version', () => {
    it('returns false when versions are identical', () => {
      expect(isVersionNewer('1.0.0', '1.0.0')).toBe(false)
    })
  })

  describe('pre-release versions', () => {
    it('handles pre-release suffix in current version', () => {
      expect(isVersionNewer('1.0.0-beta.1', '1.0.1')).toBe(true)
    })

    it('handles pre-release suffix in latest version', () => {
      expect(isVersionNewer('1.0.0', '1.0.1-beta.1')).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles single digit versions', () => {
      expect(isVersionNewer('1', '2')).toBe(true)
    })

    it('handles missing patch version', () => {
      expect(isVersionNewer('1.0', '1.0.1')).toBe(true)
    })
  })
})
