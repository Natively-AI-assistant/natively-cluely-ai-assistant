import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

vi.mock('electron', () =>
  createElectronMock({
    app: {
      getPath: vi.fn(() => '/tmp/userdata'),
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

import { SettingsManager } from '../../../electron/services/SettingsManager'

describe('SettingsManager', () => {
  let settingsManager: SettingsManager

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(SettingsManager as any).instance = undefined
    settingsManager = SettingsManager.getInstance()
  })

  afterEach(() => {
    vi.mocked(console.error).mockRestore()
    vi.mocked(console.log).mockRestore()
    vi.clearAllMocks()
  })

  describe('getInstance', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = SettingsManager.getInstance()
      const instance2 = SettingsManager.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('get and set', () => {
    it('should get and set a boolean setting', () => {
      settingsManager.set('isUndetectable', true)
      expect(settingsManager.get('isUndetectable')).toBe(true)
    })

    it('should get and set a string setting', () => {
      settingsManager.set('disguiseMode', 'terminal')
      expect(settingsManager.get('disguiseMode')).toBe('terminal')
    })

    it('should get undefined for a key that has not been set', () => {
      expect(settingsManager.get('isUndetectable')).toBeUndefined()
    })
  })

  describe('persistence', () => {
    it('should save settings to file when set is called', () => {
      settingsManager.set('verboseLogging', true)
      expect(vi.mocked(fs).writeFileSync).toHaveBeenCalled()
      const writeCall = vi.mocked(fs).writeFileSync.mock.calls[0]
      expect(writeCall[0]).toBe('/tmp/userdata/settings.json.tmp')
      expect(writeCall[1]).toBe('{\n  "verboseLogging": true\n}')
    })

    it('should load settings from file on initialization', () => {
      vi.mocked(fs).existsSync.mockReturnValueOnce(true)
      vi.mocked(fs).readFileSync.mockReturnValueOnce('{"isUndetectable":true}')

      ;(SettingsManager as any).instance = undefined
      const settingsManager = SettingsManager.getInstance()

      expect(settingsManager.get('isUndetectable')).toBe(true)
      expect(vi.mocked(fs).readFileSync).toHaveBeenCalledWith(
        '/tmp/userdata/settings.json',
        'utf8',
      )
    })

    it('should handle malformed JSON in settings file', () => {
      vi.mocked(fs).existsSync.mockReturnValueOnce(true)
      vi.mocked(fs).readFileSync.mockReturnValueOnce('invalid json')

      ;(SettingsManager as any).instance = undefined
      const settingsManager = SettingsManager.getInstance()

      expect(settingsManager.get('isUndetectable')).toBeUndefined()
      expect(console.error).toHaveBeenCalled()
    })

    it('should handle missing settings file', () => {
      vi.mocked(fs).existsSync.mockReturnValueOnce(false)

      ;(SettingsManager as any).instance = undefined
      const settingsManager = SettingsManager.getInstance()

      expect(settingsManager.get('isUndetectable')).toBeUndefined()
    })
  })

  describe('save failures', () => {
    it('should handle writeFileSync failure gracefully', () => {
      vi.mocked(fs).writeFileSync.mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device')
      })

      expect(() => {
        settingsManager.set('verboseLogging', true)
      }).not.toThrow()
      expect(console.error).toHaveBeenCalled()
    })

    it('should handle renameSync failure after successful write', () => {
      vi.mocked(fs).renameSync.mockImplementationOnce(() => {
        throw new Error('ENOENT: no such file or directory')
      })

      expect(() => {
        settingsManager.set('verboseLogging', true)
      }).not.toThrow()
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('load edge cases', () => {
    it.each([
      { json: '[1,2,3]', desc: 'array' },
      { json: 'null', desc: 'null' },
      { json: '{}', desc: 'empty object' },
    ])('returns undefined when settings file contains $desc', ({ json }) => {
      vi.mocked(fs).existsSync.mockReturnValueOnce(true)
      vi.mocked(fs).readFileSync.mockReturnValueOnce(json)

      ;(SettingsManager as any).instance = undefined
      const sm = SettingsManager.getInstance()
      expect(sm.get('isUndetectable')).toBeUndefined()
    })

    it.each([
      { error: 'EACCES: permission denied', desc: 'permission denied' },
      { error: 'EIO: I/O error', desc: 'I/O error' },
    ])('returns undefined when file read fails with $desc', ({ error }) => {
      vi.mocked(fs).existsSync.mockImplementationOnce(() => {
        throw new Error(error)
      })

      ;(SettingsManager as any).instance = undefined
      const sm = SettingsManager.getInstance()
      expect(sm.get('isUndetectable')).toBeUndefined()
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('edge case values', () => {
    it('should handle setting actionButtonMode', () => {
      settingsManager.set('actionButtonMode', 'recap')
      expect(settingsManager.get('actionButtonMode')).toBe('recap')

      settingsManager.set('actionButtonMode', 'brainstorm')
      expect(settingsManager.get('actionButtonMode')).toBe('brainstorm')
    })

    it('should serialize settings correctly in save file', () => {
      vi.mocked(fs).writeFileSync.mockClear()

      settingsManager.set('disguiseMode', 'terminal')
      settingsManager.set('verboseLogging', true)

      const lastCallIndex = vi.mocked(fs).writeFileSync.mock.calls.length - 1
      const writeCall = vi.mocked(fs).writeFileSync.mock.calls[lastCallIndex]
      const savedSettings = JSON.parse(writeCall[1] as string)
      expect(savedSettings).toHaveProperty('disguiseMode', 'terminal')
      expect(savedSettings).toHaveProperty('verboseLogging', true)
    })
  })
})
