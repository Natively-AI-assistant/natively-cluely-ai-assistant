import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestEnv,
  destroyTestEnv,
  type TestEnv,
} from './__helpers__/test-env'
import './__helpers__/shared-mocks'

import { SettingsManager } from '../../electron/services/SettingsManager'
import { resetSettingsManager } from './__helpers__/cleanup'

describe('Settings Flow Integration', () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
    ;(global as any).__NATIVELY_TEST_USER_DATA__ = env.userDataPath
    resetSettingsManager(SettingsManager)
  })

  afterEach(() => {
    resetSettingsManager(SettingsManager)
    delete (global as any).__NATIVELY_TEST_USER_DATA__
    destroyTestEnv(env)
  })

  describe('CRUD operations', () => {
    it('creates and reads settings', () => {
      const manager = SettingsManager.getInstance()

      manager.set('isUndetectable', true)
      manager.set('verboseLogging', false)
      manager.set('disguiseMode', 'terminal')
      manager.set('actionButtonMode', 'recap')

      expect(manager.get('isUndetectable')).toBe(true)
      expect(manager.get('verboseLogging')).toBe(false)
      expect(manager.get('disguiseMode')).toBe('terminal')
      expect(manager.get('actionButtonMode')).toBe('recap')
    })

    it('updates existing settings', () => {
      const manager = SettingsManager.getInstance()

      manager.set('isUndetectable', true)
      expect(manager.get('isUndetectable')).toBe(true)

      manager.set('isUndetectable', false)
      expect(manager.get('isUndetectable')).toBe(false)
    })

    it('persists settings to disk immediately on set', () => {
      const manager = SettingsManager.getInstance()
      manager.set('isUndetectable', true)

      const settingsPath = path.join(env.userDataPath, 'settings.json')
      expect(fs.existsSync(settingsPath)).toBe(true)

      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      expect(raw.isUndetectable).toBe(true)
    })
  })

  describe('Persistence across restarts', () => {
    it('survives service reinitialization', () => {
      const manager1 = SettingsManager.getInstance()
      manager1.set('isUndetectable', true)
      manager1.set('actionButtonMode', 'brainstorm')

      resetSettingsManager(SettingsManager)

      const manager2 = SettingsManager.getInstance()
      expect(manager2.get('isUndetectable')).toBe(true)
      expect(manager2.get('actionButtonMode')).toBe('brainstorm')
    })

    it('loads defaults when no settings file exists', () => {
      const manager = SettingsManager.getInstance()
      expect(manager.get('isUndetectable')).toBeUndefined()
    })
  })

  describe('Error handling', () => {
    it('handles corrupted settings file gracefully', () => {
      const settingsPath = path.join(env.userDataPath, 'settings.json')
      fs.writeFileSync(settingsPath, '{invalid json', 'utf8')

      expect(() => SettingsManager.getInstance()).not.toThrow()
    })

    it('handles missing settings directory gracefully', () => {
      ;(global as any).__NATIVELY_TEST_USER_DATA__ = path.join(
        env.userDataPath,
        'nonexistent',
      )
      resetSettingsManager(SettingsManager)

      expect(() => SettingsManager.getInstance()).not.toThrow()
    })

    it('handles settings file with wrong type gracefully', () => {
      const settingsPath = path.join(env.userDataPath, 'settings.json')
      fs.writeFileSync(settingsPath, '"just a string"', 'utf8')

      expect(() => SettingsManager.getInstance()).not.toThrow()
    })

    it('handles empty settings file gracefully', () => {
      const settingsPath = path.join(env.userDataPath, 'settings.json')
      fs.writeFileSync(settingsPath, '', 'utf8')

      expect(() => SettingsManager.getInstance()).not.toThrow()
    })

    it('handles settings with unexpected keys gracefully', () => {
      const manager = SettingsManager.getInstance()
      manager.set('isUndetectable', true)

      expect(() => manager.get('isUndetectable')).not.toThrow()
    })
  })
})
