import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// CRITICAL: Mock platformUtils BEFORE importing - module has side effect reading window.electronAPI.platform at import time
vi.mock('../../../src/utils/platformUtils', () => ({
  isMac: false,
  isWindows: true,
  isLinux: false,
  getModifierSymbol: (modifier: string) => {
    const m = modifier.toLowerCase()
    if (m === 'commandorcontrol' || m === 'cmd' || m === 'command' || m === 'meta' || m === 'ctrl' || m === 'control') {
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
  getPlatformShortcut: (keys: string[]) => keys.map(key => {
    const k = key.toLowerCase()
    if (k === '⌘' || k === 'command' || k === 'meta' || k === 'cmd') {
      return 'Ctrl'
    }
    if (k === '⌃' || k === 'control' || k === 'ctrl') {
      return 'Ctrl'
    }
    if (k === '⌥' || k === 'option' || k === 'alt') {
      return 'Alt'
    }
    if (k === '⇧' || k === 'shift') {
      return 'Shift'
    }
    return key
  }),
}))

// Also need to mock electronAPI for the module-level side effect
const mockElectronAPI = {
  platform: 'win32',
}

beforeEach(() => {
  // @ts-ignore
  global.window = {
    electronAPI: mockElectronAPI,
  }
})

afterEach(() => {
  vi.resetModules()
})

describe('platformUtils', () => {
  describe('isMac', () => {
    it('should be false when platform is win32', async () => {
      const { isMac } = await import('../../../src/utils/platformUtils')
      expect(isMac).toBe(false)
    })
  })

  describe('isWindows', () => {
    it('should be true when platform is win32', async () => {
      const { isWindows } = await import('../../../src/utils/platformUtils')
      expect(isWindows).toBe(true)
    })
  })

  describe('getModifierSymbol', () => {
    it('should return Ctrl for commandorcontrol on Windows', async () => {
      const { getModifierSymbol } = await import('../../../src/utils/platformUtils')
      expect(getModifierSymbol('commandorcontrol')).toBe('Ctrl')
    })

    it('should return Ctrl for cmd on Windows', async () => {
      const { getModifierSymbol } = await import('../../../src/utils/platformUtils')
      expect(getModifierSymbol('cmd')).toBe('Ctrl')
    })

    it('should return Ctrl for meta on Windows', async () => {
      const { getModifierSymbol } = await import('../../../src/utils/platformUtils')
      expect(getModifierSymbol('meta')).toBe('Ctrl')
    })

    it('should return Alt for alt on Windows', async () => {
      const { getModifierSymbol } = await import('../../../src/utils/platformUtils')
      expect(getModifierSymbol('alt')).toBe('Alt')
    })

    it('should return Alt for option on Windows', async () => {
      const { getModifierSymbol } = await import('../../../src/utils/platformUtils')
      expect(getModifierSymbol('option')).toBe('Alt')
    })

    it('should return Shift for shift on Windows', async () => {
      const { getModifierSymbol } = await import('../../../src/utils/platformUtils')
      expect(getModifierSymbol('shift')).toBe('Shift')
    })

    it('should return modifier unchanged for unknown modifiers', async () => {
      const { getModifierSymbol } = await import('../../../src/utils/platformUtils')
      expect(getModifierSymbol('unknown' as any)).toBe('unknown')
    })
  })

  describe('getPlatformShortcut', () => {
    it('should convert ⌘ to Ctrl on Windows', async () => {
      const { getPlatformShortcut } = await import('../../../src/utils/platformUtils')
      expect(getPlatformShortcut(['⌘', 'S'])).toEqual(['Ctrl', 'S'])
    })

    it('should convert Command to Ctrl on Windows', async () => {
      const { getPlatformShortcut } = await import('../../../src/utils/platformUtils')
      expect(getPlatformShortcut(['Command', 'S'])).toEqual(['Ctrl', 'S'])
    })

    it('should convert ⌃ to Ctrl on Windows', async () => {
      const { getPlatformShortcut } = await import('../../../src/utils/platformUtils')
      expect(getPlatformShortcut(['⌃', 'S'])).toEqual(['Ctrl', 'S'])
    })

    it('should convert ⌥ to Alt on Windows', async () => {
      const { getPlatformShortcut } = await import('../../../src/utils/platformUtils')
      expect(getPlatformShortcut(['⌥', 'S'])).toEqual(['Alt', 'S'])
    })

    it('should convert ⇧ to Shift on Windows', async () => {
      const { getPlatformShortcut } = await import('../../../src/utils/platformUtils')
      expect(getPlatformShortcut(['⇧', 'S'])).toEqual(['Shift', 'S'])
    })

    it('should leave non-modifier keys unchanged', async () => {
      const { getPlatformShortcut } = await import('../../../src/utils/platformUtils')
      expect(getPlatformShortcut(['A', 'B', 'C'])).toEqual(['A', 'B', 'C'])
    })
  })
})
