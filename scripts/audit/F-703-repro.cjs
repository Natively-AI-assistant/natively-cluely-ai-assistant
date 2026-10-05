// F-703 repro: a corrupt settings.json is silently replaced with a one-key file.
//
// loadSettings() caught a parse failure with `this.settings = {}` and no
// degraded flag, leaving the (recoverable) file on disk. The next
// set(key,value) — reachable from ~15 IPC handlers, so the first toggle after
// launch — serialized that empty-plus-one object over settings.json,
// destroying every user setting.
//
// The same codebase treats this as unacceptable for credentials:
// CredentialsManager latches keyringUnreadable and refuses every write for the
// session precisely so "saving would overwrite it with an incomplete set".
//
// Uses the REAL built SettingsManager against a temp userData dir.
// Expected (correct): the corrupt file is left intact → exit 0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f703-'));
const settingsPath = path.join(tmp, 'settings.json');
const CORRUPT = '{"interfaceTheme":"dark","meetingRetention":"forev';  // truncated write
fs.writeFileSync(settingsPath, CORRUPT);

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getPath: () => tmp, isPackaged: false, getAppPath: () => tmp, isReady: () => true, on: () => {} } };
  }
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { SettingsManager } = require(path.resolve(__dirname, '../../dist-electron/electron/services/SettingsManager.js'));
const sm = SettingsManager.getInstance();

// A perfectly ordinary toggle, as any IPC handler would do.
sm.set('interfaceTheme', 'light');

const after = fs.readFileSync(settingsPath, 'utf8');
console.log('[F-703] file on disk after a set() following a corrupt read:');
console.log('   ', JSON.stringify(after));
console.log('[F-703] degraded flag exposed:', typeof sm.isDegraded === 'function' ? sm.isDegraded() : '(not implemented)');

if (after !== CORRUPT) {
  console.error('[F-703] FAIL: the unreadable settings file was OVERWRITTEN — every user setting is gone and the original is unrecoverable (F-703 reproduced).');
  process.exit(1);
}
console.log('[F-703] PASS: writes are refused while degraded; the existing file is preserved for repair.');
process.exit(0);
