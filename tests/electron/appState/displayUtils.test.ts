/**
 * Tests for displayUtils.ts - pure display selection functions.
 */

import { describe, expect, it } from 'vitest'
import {
  type Display,
  getDisplayById,
  getTargetDisplay,
} from '../../../electron/appState/displayUtils'

const mockDisplays: Display[] = [
  {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    internal: true,
  },
  {
    id: 2,
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    size: { width: 2560, height: 1440 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
  },
]

describe('displayUtils', () => {
  describe('getDisplayById', () => {
    it('returns display when found', () => {
      const display = getDisplayById(mockDisplays, 1)
      expect(display?.id).toBe(1)
    })

    it('returns undefined when display not found', () => {
      const display = getDisplayById(mockDisplays, 999)
      expect(display).toBeUndefined()
    })

    it('returns undefined when displayId is null', () => {
      const display = getDisplayById(mockDisplays, null)
      expect(display).toBeUndefined()
    })
  })

  describe('getTargetDisplay', () => {
    it('returns matching display when ID is valid', () => {
      const display = getTargetDisplay(mockDisplays, 2)
      expect(display?.id).toBe(2)
    })

    it('returns primary display (first) when ID is null', () => {
      const display = getTargetDisplay(mockDisplays, null)
      expect(display?.id).toBe(1)
    })

    it('returns primary display when ID not found', () => {
      const display = getTargetDisplay(mockDisplays, 999)
      expect(display?.id).toBe(1)
    })

    it('throws when no displays available', () => {
      expect(() => getTargetDisplay([], null)).toThrow()
    })
  })
})
