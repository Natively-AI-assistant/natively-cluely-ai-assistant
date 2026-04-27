import { describe, expect, it, vi } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

// Mock all Electron APIs before importing KeybindManager
vi.mock('electron', () =>
  createElectronMock({
    app: {
      getPath: vi.fn(() => '/tmp/userdata'),
    },
    globalShortcut: {
      unregisterAll: vi.fn(),
      register: vi.fn(),
      isRegistered: vi.fn(() => true),
    },
    Menu: {
      buildFromTemplate: vi.fn(() => ({})),
      setApplicationMenu: vi.fn(),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
    ipcMain: {
      handle: vi.fn(),
    },
  }),
)

vi.mock('path', () => ({
  default: { join: (...args: string[]) => args.join('/') },
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}))

import { DEFAULT_KEYBINDS } from '../../../electron/services/KeybindManager'

describe('KeybindManager', () => {
  describe('DEFAULT_KEYBINDS', () => {
    it('contains expected keybinds', () => {
      expect(DEFAULT_KEYBINDS.length).toBeGreaterThan(0)
    })

    it('all keybinds have unique IDs', () => {
      const ids = DEFAULT_KEYBINDS.map((kb) => kb.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('all keybinds have non-empty accelerators', () => {
      for (const kb of DEFAULT_KEYBINDS) {
        expect(kb.accelerator).toBeTruthy()
        expect(kb.accelerator.length).toBeGreaterThan(0)
      }
    })

    it('all keybinds have labels', () => {
      for (const kb of DEFAULT_KEYBINDS) {
        expect(kb.label).toBeTruthy()
      }
    })

    it('all keybinds have defaultAccelerator matching accelerator', () => {
      for (const kb of DEFAULT_KEYBINDS) {
        expect(kb.defaultAccelerator).toBe(kb.accelerator)
      }
    })

    it('all chat shortcuts use CommandOrControl modifier', () => {
      const chatKeybinds = DEFAULT_KEYBINDS.filter((kb) =>
        kb.id.startsWith('chat:'),
      )
      for (const kb of chatKeybinds) {
        expect(kb.accelerator).toMatch(/CommandOrControl/)
      }
    })

    it('all keybinds are marked as global', () => {
      for (const kb of DEFAULT_KEYBINDS) {
        expect(kb.isGlobal).toBe(true)
      }
    })

    it('includes toggle-visibility shortcut', () => {
      const toggle = DEFAULT_KEYBINDS.find(
        (kb) => kb.id === 'general:toggle-visibility',
      )
      expect(toggle).toBeDefined()
      expect(toggle?.accelerator).toBe('CommandOrControl+B')
    })

    it('includes whatToAnswer shortcut', () => {
      const whatToAnswer = DEFAULT_KEYBINDS.find(
        (kb) => kb.id === 'chat:whatToAnswer',
      )
      expect(whatToAnswer).toBeDefined()
      expect(whatToAnswer?.accelerator).toBe('CommandOrControl+1')
    })

    it('includes all chat mode shortcuts (1-7)', () => {
      for (let i = 1; i <= 7; i++) {
        const kb = DEFAULT_KEYBINDS.find(
          (k) => k.accelerator === `CommandOrControl+${i}`,
        )
        expect(kb).toBeDefined()
      }
    })

    it('includes window movement shortcuts', () => {
      const directions = ['up', 'down', 'left', 'right']
      for (const dir of directions) {
        const kb = DEFAULT_KEYBINDS.find((k) => k.id === `window:move-${dir}`)
        expect(kb).toBeDefined()
        expect(kb?.accelerator).toContain('Shift')
      }
    })

    it('includes scroll shortcuts', () => {
      const up = DEFAULT_KEYBINDS.find((kb) => kb.id === 'chat:scrollUp')
      const down = DEFAULT_KEYBINDS.find((kb) => kb.id === 'chat:scrollDown')
      expect(up).toBeDefined()
      expect(down).toBeDefined()
      expect(up?.accelerator).toBe('CommandOrControl+Up')
      expect(down?.accelerator).toBe('CommandOrControl+Down')
    })

    it('all keybind objects have required fields', () => {
      for (const kb of DEFAULT_KEYBINDS) {
        expect(kb).toHaveProperty('id')
        expect(kb).toHaveProperty('label')
        expect(kb).toHaveProperty('accelerator')
        expect(kb).toHaveProperty('isGlobal')
        expect(kb).toHaveProperty('defaultAccelerator')
      }
    })
  })
})
