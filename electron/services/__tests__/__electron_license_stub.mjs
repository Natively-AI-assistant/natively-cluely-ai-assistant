// Minimal 'electron' stand-in for LicenseManager unit tests.
//
// Provides the two surfaces LicenseManager touches at module load and during a
// license read: app.getPath('userData') (where license.enc lives) and
// safeStorage (the OS-encryption wrapper). Keeps the test runnable under plain
// `node --test`, with no Electron runtime.
//
// getAppPath() deliberately points at a directory that does not exist so
// nativeModuleLoader's candidate paths all miss and loadNativeModule() returns
// null. That is the exact condition under test — a machine where the Rust
// binary fails to load (unbuilt dev checkout, ASAR unpack failure, or AV
// quarantine on Windows) — and pinning it here keeps the test deterministic on
// machines that DO have the binary built.
import os from 'node:os';
import path from 'node:path';

const userData =
  process.env.NATIVELY_TEST_USERDATA || path.join(os.tmpdir(), 'natively-license-test');

export const app = {
  isPackaged: false,
  getAppPath: () => path.join(userData, '__no_native_module_here__'),
  getPath: (name) => (name === 'userData' ? userData : path.join(userData, name)),
};

// Reversible stand-in for the OS keychain/DPAPI round-trip. The prefix makes a
// decrypt of non-stub bytes throw, matching safeStorage's real failure mode.
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`ENC:${s}`, 'utf8'),
  decryptString: (buf) => {
    const s = Buffer.from(buf).toString('utf8');
    if (!s.startsWith('ENC:')) throw new Error('safeStorage: cannot decrypt');
    return s.slice(4);
  },
};

export default { app, safeStorage };
