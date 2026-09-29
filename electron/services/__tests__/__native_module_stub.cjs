// Minimal stand-in for the Rust native module (natively-audio .node binary).
//
// nativeModuleLoader loads the binary with `require(<absolute>.node)`, and
// Module._resolveFilename is consulted for absolute requests too — so a test
// can redirect that request here and run LicenseManager with the native module
// PRESENT and a KNOWN hardware id. Without this seam the HWID-mismatch branch
// and the whole activateLicense() (Gumroad/Dodo) path are unreachable from this
// repo's tests: `getHardwareId` and the verifiers are module-level bindings in
// LicenseManager, seeded once at import from loadNativeModule().
//
// Must satisfy validateNativeModule(): every REQUIRED_METHODS entry, both
// REQUIRED_CONSTRUCTORS, and a getHardwareId() that returns a non-empty string
// (the loader's functional smoke-test calls it).
//
// CJS on purpose — it is loaded through require(), not import.

/** The fingerprint this fake machine reports. Tests bind licenses to it. */
const HWID = 'a'.repeat(64);

/**
 * Programmable behaviour + call log. Tests mutate `dodo`/`gumroad` to choose a
 * response and read `calls` to assert what the manager asked the native layer
 * to do. require() caches this module, so the object a test mutates is the one
 * LicenseManager holds.
 */
const control = {
  // "OK:<instance_id>" | "ERR:dodo:duplicate[:<id>]" | "ERR:dodo:limit_reached" | "ERR:dodo:..."
  verifyDodo: 'ERR:dodo:invalid',
  // "OK" | "REVOKED" | "ERR:dodo:..."
  validateDodo: 'OK',
  // "OK" | "ERR:dodo:..."  — or an Error instance to model a NAPI binding failure.
  deactivateDodo: 'OK',
  // "OK" | "ERR:gumroad:..."
  verifyGumroad: 'ERR:gumroad:invalid',
  calls: { verifyDodo: [], validateDodo: [], deactivateDodo: [], verifyGumroad: [] },
  reset() {
    this.verifyDodo = 'ERR:dodo:invalid';
    this.validateDodo = 'OK';
    this.deactivateDodo = 'OK';
    this.verifyGumroad = 'ERR:gumroad:invalid';
    this.calls = { verifyDodo: [], validateDodo: [], deactivateDodo: [], verifyGumroad: [] };
  },
};

function answer(kind, args) {
  control.calls[kind].push(args);
  const value = control[kind];
  if (value instanceof Error) return Promise.reject(value);
  return Promise.resolve(value);
}

class FakeCapture {
  getSampleRate() {
    return 16000;
  }
  start() {}
  stop() {}
}

module.exports = {
  HWID,
  control,
  getHardwareId: () => HWID,
  verifyGumroadKey: (key) => answer('verifyGumroad', { key }),
  verifyDodoKey: (key, deviceLabel) => answer('verifyDodo', { key, deviceLabel }),
  validateDodoKey: (key) => answer('validateDodo', { key }),
  deactivateDodoKey: (key, instanceId) => answer('deactivateDodo', { key, instanceId }),
  getInputDevices: () => [],
  getOutputDevices: () => [],
  SystemAudioCapture: FakeCapture,
  MicrophoneCapture: FakeCapture,
};
