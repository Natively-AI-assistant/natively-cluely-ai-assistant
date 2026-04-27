/**
 * LicenseManager integration tests — premium-conditional.
 *
 * Tests the public API of LicenseManager.
 * All module-level mocks (electron, fs, nativeModuleLoader) are handled by
 * tests/premium.setup.ts, which runs BEFORE this file's imports are evaluated.
 * DO NOT add vi.mock() calls here — they would re-mock and undo the setup mock.
 *
 * When premium is unavailable, all tests are skipped via describeIfPremium.
 *
 * Path convention (from tests/premium/license/):
 * - premiumSkip:    ../..                      → tests/helpers/premiumSkip
 * - premium modules: ../../../premium/         → premium/ (sibling of tests/)
 * - electron/audio: ../../../electron/audio/ → electron/audio/ (in root)
 */

import { afterEach, beforeEach, expect, vi } from 'vitest'
import { describeIfPremium, itIfPremium } from '../../helpers/premiumSkip'

// ─── Import after mocking (mocks are in tests/premium.setup.ts) ────────────

import fs from 'node:fs'
import { safeStorage } from 'electron'
import { loadNativeModule } from '../../../../electron/audio/nativeModuleLoader'
import { LicenseManager } from '../../../../premium/electron/services/LicenseManager'

// ─── Test Suite ─────────────────────────────────────────────────────────────

describeIfPremium('LicenseManager', () => {
  let manager: LicenseManager
  let nativeMod: ReturnType<typeof loadNativeModule>

  beforeEach(() => {
    vi.clearAllMocks()
    manager = LicenseManager.getInstance()
    manager.clearCache()

    // Get reference to mocked native module for per-test configuration
    nativeMod = loadNativeModule()

    // Reset mocks to default safe state
    fs.existsSync.mockReturnValue(false)
    fs.readFileSync.mockReset()
    fs.writeFileSync.mockReset()
    fs.renameSync.mockReset()
    fs.unlinkSync.mockReset()

    // Default safeStorage decrypt returns a valid license file
    vi.mocked(safeStorage.decryptString).mockImplementation(
      () =>
        '{"key":"TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"gumroad"}',
    )
    vi.mocked(safeStorage.encryptString).mockImplementation(() =>
      Buffer.from('encrypted'),
    )
  })

  afterEach(() => {
    manager.clearCache()
  })

  describeIfPremium('activateLicense', () => {
    itIfPremium(
      'with valid Dodo key returns success and instance_id',
      async () => {
        nativeMod.verifyDodoKey = vi.fn().mockResolvedValue('OK:lki_test123')

        const result = await manager.activateLicense('DODO-KEY-123')

        expect(result.success).toBe(true)
        expect(result.error).toBeUndefined()
      },
    )

    itIfPremium(
      'with valid Gumroad key falls back and returns success',
      async () => {
        // Dodo fails (network error triggers Gumroad fallback)
        nativeMod.verifyDodoKey = vi
          .fn()
          .mockResolvedValue('ERR:dodo:network:timeout')
        // Gumroad succeeds
        nativeMod.verifyGumroadKey = vi.fn().mockResolvedValue('OK')

        const result = await manager.activateLicense('GUMROAD-KEY-456')

        expect(result.success).toBe(true)
      },
    )

    itIfPremium('with invalid Dodo key returns error', async () => {
      nativeMod.verifyDodoKey = vi
        .fn()
        .mockResolvedValue('ERR:dodo:invalid_key')

      const result = await manager.activateLicense('BAD-KEY')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    itIfPremium('with empty key returns error', async () => {
      const result = await manager.activateLicense('')
      expect(result.success).toBe(false)
      expect(result.error).toBe('License key cannot be empty.')
    })

    itIfPremium('with whitespace-only key returns error', async () => {
      const result = await manager.activateLicense('   ')
      expect(result.success).toBe(false)
      expect(result.error).toBe('License key cannot be empty.')
    })

    itIfPremium('race condition guard rejects concurrent calls', async () => {
      nativeMod.verifyDodoKey = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve('OK:lki_concurrent'), 50),
            ),
        )

      const [first, second] = await Promise.allSettled([
        manager.activateLicense('CONCURRENT-KEY'),
        manager.activateLicense('CONCURRENT-KEY'),
      ])

      const successes = [first, second].filter(
        (r) => r.status === 'fulfilled' && (r as any).value.success,
      )
      const failures = [first, second].filter(
        (r) => r.status === 'fulfilled' && !(r as any).value.success,
      )

      expect(successes.length).toBeGreaterThanOrEqual(1)
      expect(failures.length).toBeGreaterThanOrEqual(1)
      expect(failures[0] && (failures[0] as any).value.error).toMatch(
        /in progress/,
      )
    })
  })

  describeIfPremium('isPremium', () => {
    itIfPremium('returns false when no license file exists', () => {
      fs.existsSync.mockReturnValue(false)
      expect(manager.isPremium()).toBe(false)
    })

    itIfPremium('returns cached value on repeated calls', () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"gumroad"}',
      )

      const first = manager.isPremium()
      const second = manager.isPremium()
      const third = manager.isPremium()

      expect(first).toBe(true)
      expect(second).toBe(true)
      expect(third).toBe(true)
      // Should only read once due to caching
      expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    })

    itIfPremium('returns false when HWID does not match', () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"TEST","hwid":"DIFFERENT-HWID","activatedAt":"2024-01-01T00:00:00.000Z","provider":"gumroad"}',
      )

      expect(manager.isPremium()).toBe(false)
    })

    itIfPremium('returns false when native module unavailable', () => {
      manager.clearCache()
      fs.existsSync.mockReturnValue(true)
      expect(manager.isPremium()).toBe(false)
    })
  })

  describeIfPremium('getLicenseDetails', () => {
    itIfPremium('returns isPremium false when no license', () => {
      fs.existsSync.mockReturnValue(false)
      const details = manager.getLicenseDetails()
      expect(details.isPremium).toBe(false)
    })

    itIfPremium('returns plan and provider when license exists', () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"PRO-KEY","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"natively_api","plan":"pro"}',
      )

      const details = manager.getLicenseDetails()
      expect(details.isPremium).toBe(true)
      expect(details.plan).toBe('pro')
      expect(details.provider).toBe('natively_api')
    })
  })

  describeIfPremium('deactivate', () => {
    itIfPremium('removes license file and clears cache', async () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"DEACTIVATE-TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"gumroad"}',
      )
      manager.clearCache()

      expect(manager.isPremium()).toBe(true)
      await manager.deactivate()

      expect(fs.unlinkSync).toHaveBeenCalled()
      manager.clearCache()
      fs.existsSync.mockReturnValue(false)
      expect(manager.isPremium()).toBe(false)
    })

    itIfPremium('handles Dodo deactivation with instance_id', async () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"DODO-DEACT","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"dodo","instanceId":"lki_deact123"}',
      )
      nativeMod.deactivateDodoKey = vi.fn().mockResolvedValue('OK')
      manager.clearCache()

      await manager.deactivate()

      expect(nativeMod.deactivateDodoKey).toHaveBeenCalled()
      expect(fs.unlinkSync).toHaveBeenCalled()
    })

    itIfPremium('removes file even on network error (non-fatal)', async () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"NETWORK-ERR","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"dodo","instanceId":"lki_neterr"}',
      )
      nativeMod.deactivateDodoKey = vi
        .fn()
        .mockResolvedValue('ERR:dodo:network:timeout')
      manager.clearCache()

      await expect(manager.deactivate()).resolves.not.toThrow()
      expect(fs.unlinkSync).toHaveBeenCalled()
    })
  })

  describeIfPremium('getHardwareId', () => {
    itIfPremium('returns hardware ID string', () => {
      const hwid = manager.getHardwareId()
      expect(typeof hwid).toBe('string')
      expect(hwid).toBe('HWID123')
    })

    itIfPremium('returns non-empty string', () => {
      const hwid = manager.getHardwareId()
      expect(hwid).not.toBe('')
    })
  })

  describeIfPremium('clearCache', () => {
    itIfPremium('clears the in-memory premium cache', () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"CACHE-TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"gumroad"}',
      )

      const first = manager.isPremium()
      expect(first).toBe(true)

      manager.clearCache()
      const second = manager.isPremium()

      expect(second).toBe(true)
      expect(fs.readFileSync).toHaveBeenCalledTimes(2)
    })
  })

  describeIfPremium('isPremiumAsync', () => {
    itIfPremium('returns false when not premium (sync check)', async () => {
      manager.clearCache()
      fs.existsSync.mockReturnValue(false)
      const result = await manager.isPremiumAsync()
      expect(result).toBe(false)
    })

    itIfPremium(
      'returns true for valid Dodo license after sync check',
      async () => {
        fs.existsSync.mockReturnValue(true)
        vi.mocked(safeStorage.decryptString).mockImplementation(
          () =>
            '{"key":"ASYNC-TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"dodo"}',
        )
        nativeMod.validateDodoKey = vi.fn().mockResolvedValue('OK')
        manager.clearCache()

        const result = await manager.isPremiumAsync()
        expect(result).toBe(true)
      },
    )

    itIfPremium('revokes locally on REVOKED response', async () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"REVOKED-TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"dodo"}',
      )
      nativeMod.validateDodoKey = vi.fn().mockResolvedValue('REVOKED')
      manager.clearCache()

      const result = await manager.isPremiumAsync()
      expect(result).toBe(false)
      expect(fs.unlinkSync).toHaveBeenCalled()
    })

    itIfPremium('fails open on network error (returns true)', async () => {
      fs.existsSync.mockReturnValue(true)
      vi.mocked(safeStorage.decryptString).mockImplementation(
        () =>
          '{"key":"NET-OPEN","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"dodo"}',
      )
      nativeMod.validateDodoKey = vi
        .fn()
        .mockResolvedValue('ERR:dodo:network:timeout')
      manager.clearCache()

      const result = await manager.isPremiumAsync()
      expect(result).toBe(true)
    })
  })
})
