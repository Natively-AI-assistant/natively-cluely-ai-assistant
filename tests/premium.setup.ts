/**
 * Premium project test setup — runs before test files are evaluated.
 *
 * Installs all mocks that must be active during module evaluation.
 * Since LicenseManager.ts calls loadNativeModule() at module top level (during
 * require(), before any test file body runs), these mocks must be registered
 * BEFORE any test file code executes.
 *
 * This setup file is referenced by the `premium` project in vitest.config.ts.
 *

 */

import { vi } from 'vitest'

// ─── Mock helpers (plain functions so validateNativeModule() typeof checks pass) ─

function mkSync<T>(v: T) {
  return (): T => v
}
function mkAsync<T>(v: T) {
  return async (): Promise<T> => v
}

const electronStub = {
  app: {
    getPath: () => '/tmp/natively-test',
    getAppPath: () => '/fake/app/path',
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: () => Buffer.from('encrypted'),
    decryptString: () =>
      '{"key":"TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"gumroad"}',
  },
}

// ─── Register mocks at module level ────────────────────────────────────────────

vi.mock('electron', () => ({
  default: electronStub,
  ...electronStub,
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('path', () => ({
  default: { join: (...args: string[]) => args.join('/') },
  join: (...args: string[]) => args.join('/'),
}))

// The nativeModuleLoader mock provides a fully-populated NativeModule AND
// mocks 'electron' at the nested level so loadNativeModule()'s own internal
// require() (from a different module graph path) also resolves to our mock.
vi.mock('../../electron/audio/nativeModuleLoader', () => ({
  loadNativeModule: () => ({
    getHardwareId: mkSync('HWID123'),
    verifyGumroadKey: mkAsync('OK'),
    verifyDodoKey: mkAsync('ERR:dodo:not_configured'),
    validateDodoKey: mkAsync('ERR:dodo:not_configured'),
    deactivateDodoKey: mkAsync('ERR:dodo:not_configured'),
    getInputDevices: () => [] as any[], // biome-ignore lint/suspicious/noExplicitAny: stub return type
    getOutputDevices: () => [] as any[], // biome-ignore lint/suspicious/noExplicitAny: stub return type
    SystemAudioCapture: class {
      getSampleRate() {
        return 44100
      }
      start() {}
      stop() {}
    },
    MicrophoneCapture: class {
      getSampleRate() {
        return 44100
      }
      start() {}
      stop() {}
    },
  }),
  // Nest 'electron' so loadNativeModule()'s own require('electron') resolves to our mock
  electron: electronStub,
}))

// ─── Verify mocks ──────────────────────────────────────────────────────────────

try {
  const req = require('electron')
  const keys = Object.keys(req)
  const _allKeys = Object.keys(req).concat(
    Object.keys((req as any).default || {}), // biome-ignore lint/suspicious/noExplicitAny: dynamic require()
  )
  console.log('[premium.setup] require(electron) keys:', keys)
  console.log(
    '[premium.setup] require(electron).default keys:',
    Object.keys((req as any).default || {}), // biome-ignore lint/suspicious/noExplicitAny: dynamic require()
  )
  console.log(
    '[premium.setup] check (req as any).default?.app:', // biome-ignore lint/suspicious/noExplicitAny: dynamic require()
    typeof (req as any).default?.app,
  )
  console.log(
    '[premium.setup] check (req as any).app:', // biome-ignore lint/suspicious/noExplicitAny: dynamic require()
    typeof (req as any).app,
  )
  console.log(
    '[premium.setup] check (req as any).app?.getAppPath:', // biome-ignore lint/suspicious/noExplicitAny: dynamic require()
    typeof (req as any).app?.getAppPath,
  )
} catch (e) {
  console.log('[premium.setup] require(electron) error:', (e as Error).message)
}
