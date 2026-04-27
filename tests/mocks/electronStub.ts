/**
 * Test stub for electron module — used by premium tests to avoid real Electron in Node environment.
 *
 * Provide a fake app + safeStorage so nativeModuleLoader.loadNativeModule() can resolve
 * app.getAppPath() without crashing, and LicenseManager can read/write license data.
 *
 * IMPORTANT: This stub MUST be resolvable before the real 'electron' module.
 * Load it via vi.mock() in test files before any import that triggers loadNativeModule().
 */

export const app = {
  getPath: () => '/tmp/natively-test',
  getAppPath: () => '/fake/app/path',
}

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: () => Buffer.from('encrypted'),
  decryptString: () =>
    '{"key":"TEST","hwid":"HWID123","activatedAt":"2024-01-01T00:00:00.000Z","provider":"gumroad"}',
}
