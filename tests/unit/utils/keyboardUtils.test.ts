import { describe, expect, it, vi } from 'vitest'
import {
  acceleratorToKeys,
  keysToAccelerator,
} from '../../../src/utils/keyboardUtils'

// Mock platformUtils
vi.mock('../../../src/utils/platformUtils', () => ({
  isMac: false,
  getModifierSymbol: (modifier: string) => {
    const m = modifier.toLowerCase()
    if (
      m === 'commandorcontrol' ||
      m === 'ctrl' ||
      m === 'control' ||
      m === 'cmd' ||
      m === 'command' ||
      m === 'meta'
    ) {
      return 'Ctrl'
    }
    if (m === 'alt' || m === 'option') {
      return 'Alt'
    }
    if (m === 'shift') {
      return 'Shift'
    }
    return modifier
  },
}))

describe('keyboardUtils', () => {
  describe('acceleratorToKeys', () => {
    it('should return empty array for empty string', () => {
      expect(acceleratorToKeys('')).toEqual([])
    })

    it('should convert CommandOrControl to Ctrl on non-Mac', () => {
      expect(acceleratorToKeys('CommandOrControl+S')).toEqual(['Ctrl', 'S'])
    })

    it('should convert Cmd to Ctrl on non-Mac', () => {
      expect(acceleratorToKeys('Cmd+S')).toEqual(['Ctrl', 'S'])
    })

    it('should convert Command to Ctrl on non-Mac', () => {
      expect(acceleratorToKeys('Command+S')).toEqual(['Ctrl', 'S'])
    })

    it('should convert Meta to Ctrl on non-Mac', () => {
      expect(acceleratorToKeys('Meta+S')).toEqual(['Ctrl', 'S'])
    })

    it('should convert Control to Ctrl', () => {
      expect(acceleratorToKeys('Control+S')).toEqual(['Ctrl', 'S'])
    })

    it('should convert Ctrl to Ctrl', () => {
      expect(acceleratorToKeys('Ctrl+S')).toEqual(['Ctrl', 'S'])
    })

    it('should convert Alt to Alt', () => {
      expect(acceleratorToKeys('Alt+S')).toEqual(['Alt', 'S'])
    })

    it('should convert Option to Alt', () => {
      expect(acceleratorToKeys('Option+S')).toEqual(['Alt', 'S'])
    })

    it('should convert Shift to Shift', () => {
      expect(acceleratorToKeys('Shift+S')).toEqual(['Shift', 'S'])
    })

    it('should convert Up to arrow', () => {
      expect(acceleratorToKeys('Up')).toEqual(['↑'])
    })

    it('should convert ArrowUp to arrow', () => {
      expect(acceleratorToKeys('ArrowUp')).toEqual(['↑'])
    })

    it('should convert Down to arrow', () => {
      expect(acceleratorToKeys('Down')).toEqual(['↓'])
    })

    it('should convert ArrowDown to arrow', () => {
      expect(acceleratorToKeys('ArrowDown')).toEqual(['↓'])
    })

    it('should convert Left to arrow', () => {
      expect(acceleratorToKeys('Left')).toEqual(['←'])
    })

    it('should convert ArrowLeft to arrow', () => {
      expect(acceleratorToKeys('ArrowLeft')).toEqual(['←'])
    })

    it('should convert Right to arrow', () => {
      expect(acceleratorToKeys('Right')).toEqual(['→'])
    })

    it('should convert ArrowRight to arrow', () => {
      expect(acceleratorToKeys('ArrowRight')).toEqual(['→'])
    })

    it('should capitalize single letter keys', () => {
      expect(acceleratorToKeys('a')).toEqual(['A'])
    })

    it('should keep multi-letter keys as is', () => {
      expect(acceleratorToKeys('Space')).toEqual(['Space'])
    })

    it('should handle complex accelerator', () => {
      expect(acceleratorToKeys('CommandOrControl+Shift+Space')).toEqual([
        'Ctrl',
        'Shift',
        'Space',
      ])
    })

    it('should be case insensitive', () => {
      expect(acceleratorToKeys('commandorcontrol+s')).toEqual(['Ctrl', 'S'])
    })
  })

  describe('keysToAccelerator', () => {
    it('should return empty string for empty array', () => {
      expect(keysToAccelerator([])).toBe('')
    })

    it('should convert Meta to CommandOrControl', () => {
      expect(keysToAccelerator(['Meta', 'S'])).toBe('CommandOrControl+S')
    })

    it('should convert Command to CommandOrControl', () => {
      expect(keysToAccelerator(['Command', 'S'])).toBe('CommandOrControl+S')
    })

    it('should convert Cmd to CommandOrControl', () => {
      expect(keysToAccelerator(['Cmd', 'S'])).toBe('CommandOrControl+S')
    })

    it('should convert ⌘ to CommandOrControl', () => {
      expect(keysToAccelerator(['⌘', 'S'])).toBe('CommandOrControl+S')
    })

    it('should convert Control to CommandOrControl on non-Mac', () => {
      expect(keysToAccelerator(['Control', 'S'])).toBe('CommandOrControl+S')
    })

    it('should convert Ctrl to CommandOrControl on non-Mac', () => {
      expect(keysToAccelerator(['Ctrl', 'S'])).toBe('CommandOrControl+S')
    })

    it('should convert ⌃ to CommandOrControl on non-Mac', () => {
      expect(keysToAccelerator(['⌃', 'S'])).toBe('CommandOrControl+S')
    })

    it('should convert Alt to Alt', () => {
      expect(keysToAccelerator(['Alt', 'S'])).toBe('Alt+S')
    })

    it('should convert Option to Alt', () => {
      expect(keysToAccelerator(['Option', 'S'])).toBe('Alt+S')
    })

    it('should convert ⌥ to Alt', () => {
      expect(keysToAccelerator(['⌥', 'S'])).toBe('Alt+S')
    })

    it('should convert Shift to Shift', () => {
      expect(keysToAccelerator(['Shift', 'S'])).toBe('Shift+S')
    })

    it('should convert ⇧ to Shift', () => {
      expect(keysToAccelerator(['⇧', 'S'])).toBe('Shift+S')
    })

    it('should convert ↑ to Up', () => {
      expect(keysToAccelerator(['↑'])).toBe('Up')
    })

    it('should convert Up to Up', () => {
      expect(keysToAccelerator(['Up'])).toBe('Up')
    })

    it('should convert ArrowUp to Up', () => {
      expect(keysToAccelerator(['ArrowUp'])).toBe('Up')
    })

    it('should convert ↓ to Down', () => {
      expect(keysToAccelerator(['↓'])).toBe('Down')
    })

    it('should convert Down to Down', () => {
      expect(keysToAccelerator(['Down'])).toBe('Down')
    })

    it('should convert ArrowDown to Down', () => {
      expect(keysToAccelerator(['ArrowDown'])).toBe('Down')
    })

    it('should convert ← to Left', () => {
      expect(keysToAccelerator(['←'])).toBe('Left')
    })

    it('should convert Left to Left', () => {
      expect(keysToAccelerator(['Left'])).toBe('Left')
    })

    it('should convert ArrowLeft to Left', () => {
      expect(keysToAccelerator(['ArrowLeft'])).toBe('Left')
    })

    it('should convert → to Right', () => {
      expect(keysToAccelerator(['→'])).toBe('Right')
    })

    it('should convert Right to Right', () => {
      expect(keysToAccelerator(['Right'])).toBe('Right')
    })

    it('should convert ArrowRight to Right', () => {
      expect(keysToAccelerator(['ArrowRight'])).toBe('Right')
    })

    it('should uppercase main key', () => {
      expect(keysToAccelerator(['s'])).toBe('S')
    })

    it('should handle complex combination', () => {
      expect(keysToAccelerator(['Meta', 'Shift', 'Space'])).toBe(
        'CommandOrControl+Shift+SPACE',
      )
    })

    it('should be case insensitive', () => {
      expect(keysToAccelerator(['meta', 's'])).toBe('CommandOrControl+S')
    })
  })
})
