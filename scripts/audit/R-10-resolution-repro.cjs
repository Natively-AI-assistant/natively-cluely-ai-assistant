#!/usr/bin/env node
/**
 * R-10 resolution repro — the §19.1 exit from the ambiguous two-store state.
 *
 * R-10 made the ambiguous state non-destructive but PERMANENT: each fallback
 * save keeps the fallback newer, so nothing ever ends it and every future key
 * accumulates in the weaker store. This exercises the deliberate exit:
 *
 *   getAmbiguousStoreSummary()  — names + last-4 only, never values
 *   resolveAmbiguousStores(c)   — c in {keyring, fallback, merge}; snapshots
 *                                 BOTH stores first, then persists the winner
 *                                 through the normal keyring path
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-10-resolution-repro.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const REPO = path.resolve(__dirname, '..', '..');
const CM_PATH = path.join(REPO, 'dist-electron', 'electron', 'services', 'CredentialsManager.js');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`[R-10r] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
};

const makeElectron = (userData, keyringAvailable = true) => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => userData, isReady: () => true, on: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => keyringAvailable,
    encryptString: (s) => Buffer.concat([Buffer.from('KEYRING:'), Buffer.from(s, 'utf8')]),
    decryptString: (b) => {
      const s = Buffer.from(b).toString('utf8');
      if (!s.startsWith('KEYRING:')) throw new Error('not a keyring blob');
      return s.slice('KEYRING:'.length);
    },
  },
  ipcMain: { on: () => {}, handle: () => {} },
});

function freshManager(userData, keyringAvailable = true) {
  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return makeElectron(userData, keyringAvailable);
    if (request.endsWith('.node') || request.includes('native-module')) return {};
    return realLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(CM_PATH)];
    for (const k of Object.keys(globalThis)) {
      if (k.toLowerCase().includes('credentialsmanager')) delete globalThis[k];
    }
    const { CredentialsManager } = require(CM_PATH);
    const inst = CredentialsManager.getInstance ? CredentialsManager.getInstance() : new CredentialsManager();
    inst.init();
    return inst;
  } finally {
    Module._load = realLoad;
  }
}

/** Build the ambiguous state exactly as R-10's main repro does. */
function ambiguousSetup() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'r10res-'));
  const keyringPath = path.join(userData, 'credentials.enc');
  const fallbackPath = path.join(userData, 'credentials.fallback.enc');

  const seeder = freshManager(userData, false);        // keyring down -> real fallback written
  seeder.setGeminiApiKey('STALE-FROM-BACKUP-1234');
  fs.writeFileSync(keyringPath, Buffer.concat([Buffer.from('KEYRING:'), Buffer.from(JSON.stringify({
    geminiApiKey: 'CURRENT-REAL-KEY-5678', openaiApiKey: 'CURRENT-OPENAI-9012',
  }), 'utf8')]));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(keyringPath, old, old);
  const now = new Date();
  fs.utimesSync(fallbackPath, now, now);

  const mgr = freshManager(userData, true);
  return { userData, keyringPath, fallbackPath, mgr };
}

const readKeyring = (p) => {
  const raw = fs.readFileSync(p).toString('utf8');
  return raw.startsWith('KEYRING:') ? JSON.parse(raw.slice(8)) : null;
};
const superseded = (dir) => fs.readdirSync(dir).filter((f) => f.includes('.superseded-'));

// ---------------------------------------------------------------------------
// 0. The summary: names + last-4 only.
// ---------------------------------------------------------------------------
{
  const { userData, mgr } = ambiguousSetup();
  const sum = mgr.getAmbiguousStoreSummary();
  check('summary exists while ambiguous       ', sum !== null, true);
  check('  keyring key names                  ', sum.keyring.keys.map((k) => k.name), ['geminiApiKey', 'openaiApiKey']);
  check('  keyring last4 (gemini)             ', sum.keyring.keys[0].last4, '5678');
  check('  fallback key names                 ', sum.fallback.keys.map((k) => k.name), ['geminiApiKey']);
  check('  fallback last4                     ', sum.fallback.keys[0].last4, '1234');
  const flat = JSON.stringify(sum);
  check('  no FULL value leaks into the summary', /CURRENT-REAL-KEY-5678|STALE-FROM-BACKUP-1234|CURRENT-OPENAI-9012/.test(flat), false);
  fs.rmSync(userData, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1..3. Each choice, end-to-end, including a post-resolution save + relaunch.
// ---------------------------------------------------------------------------
const CASES = [
  ['keyring', { geminiApiKey: 'CURRENT-REAL-KEY-5678', openaiApiKey: 'CURRENT-OPENAI-9012', groqApiKey: 'POST-RESOLVE-KEY' }],
  ['fallback', { geminiApiKey: 'STALE-FROM-BACKUP-1234', groqApiKey: 'POST-RESOLVE-KEY' }],
  ['merge', { geminiApiKey: 'STALE-FROM-BACKUP-1234', openaiApiKey: 'CURRENT-OPENAI-9012', groqApiKey: 'POST-RESOLVE-KEY' }],
];
for (const [choice, expectedFinal] of CASES) {
  console.log(`\n[R-10r] --- choice: ${choice} ---`);
  const { userData, keyringPath, mgr } = ambiguousSetup();
  const res = mgr.resolveAmbiguousStores(choice);
  check('resolve ok                           ', res.ok, true);
  check('  BOTH stores snapshotted             ', superseded(userData).length, 2);
  check('  summary now null (state ended)      ', mgr.getAmbiguousStoreSummary(), null);
  // A save after resolution must go to the KEYRING, proving the writes are no
  // longer detoured to the fallback.
  mgr.setGroqApiKey('POST-RESOLVE-KEY');
  const kr = readKeyring(keyringPath);
  check('  post-resolve keyring contents       ', kr, expectedFinal);
  // And a relaunch must NOT re-enter the ambiguous state.
  const reborn = freshManager(userData, true);
  check('  relaunch stays resolved             ', reborn.getAmbiguousStoreSummary(), null);
  check('  relaunch loads the resolved set     ', reborn.getAllCredentials(), expectedFinal);
  fs.rmSync(userData, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 4. Guards.
// ---------------------------------------------------------------------------
{
  console.log('\n[R-10r] --- guards ---');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'r10res-clean-'));
  const mgr = freshManager(userData, true);
  check('resolve refused when not ambiguous   ', mgr.resolveAmbiguousStores('keyring'), { ok: false, error: 'not_ambiguous' });
  check('summary null when not ambiguous      ', mgr.getAmbiguousStoreSummary(), null);
  fs.rmSync(userData, { recursive: true, force: true });

  const amb = ambiguousSetup();
  check('invalid choice refused               ', amb.mgr.resolveAmbiguousStores('everything'), { ok: false, error: 'invalid_choice' });
  check('  and the state survives a bad call  ', amb.mgr.getAmbiguousStoreSummary() !== null, true);
  fs.rmSync(amb.userData, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 5. Adversarial-review fixes (2026-08-19) — each of these FAILED before the fix.
// ---------------------------------------------------------------------------

// A mutable-stub harness: the review's scenarios need safeStorage to change
// behaviour BETWEEN load and resolve (locked keychain), which the fixed stub
// above cannot express.
const ctl = { locked: false };
const makeMutableElectron = (userData) => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => userData, isReady: () => true, on: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (str) => { if (ctl.locked) throw new Error('keychain locked'); return Buffer.concat([Buffer.from('KEYRING:'), Buffer.from(str, 'utf8')]); },
    decryptString: (b) => {
      if (ctl.locked) throw new Error('keychain locked');
      const str = Buffer.from(b).toString('utf8');
      if (!str.startsWith('KEYRING:')) throw new Error('not a keyring blob');
      return str.slice('KEYRING:'.length);
    },
  },
  ipcMain: { on: () => {}, handle: () => {} },
});
function freshMutableManager(userData) {
  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return makeMutableElectron(userData);
    if (request.endsWith('.node') || request.includes('native-module')) return {};
    return realLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(CM_PATH)];
    for (const k of Object.keys(globalThis)) {
      if (k.toLowerCase().includes('credentialsmanager')) delete globalThis[k];
    }
    const { CredentialsManager } = require(CM_PATH);
    const inst = CredentialsManager.getInstance ? CredentialsManager.getInstance() : new CredentialsManager();
    inst.init();
    return inst;
  } finally {
    Module._load = realLoad;
  }
}
function mutableAmbiguousSetup() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'r10res-mut-'));
  const keyringPath = path.join(userData, 'credentials.enc');
  const fallbackPath = path.join(userData, 'credentials.fallback.enc');
  ctl.locked = false;
  const seeder = freshManager(userData, false);
  seeder.setGeminiApiKey('STALE-FROM-BACKUP-1234');
  fs.writeFileSync(keyringPath, Buffer.concat([Buffer.from('KEYRING:'), Buffer.from(JSON.stringify({
    geminiApiKey: 'CURRENT-REAL-KEY-5678', openaiApiKey: 'CURRENT-OPENAI-9012',
  }), 'utf8')]));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(keyringPath, old, old);
  const now = new Date();
  fs.utimesSync(fallbackPath, now, now);
  const mgr = freshMutableManager(userData);
  return { userData, keyringPath, fallbackPath, mgr };
}

// 5a. merge with the keychain LOCKED at resolve time: the keyring-only key must
//     survive via the in-memory load-time union (pre-fix: silently dropped).
{
  console.log('\n[R-10r] --- merge with keychain locked at resolve time ---');
  const { userData, keyringPath, mgr } = mutableAmbiguousSetup();
  ctl.locked = true;                       // lock BETWEEN load and resolve
  const res = mgr.resolveAmbiguousStores('merge');
  ctl.locked = false;
  // Persisting may have detoured to the fallback while locked — what matters is
  // that no key vanished from the ACTIVE set.
  const active = mgr.getAllCredentials();
  check('merge keeps keyring-only openai      ', active.openaiApiKey, 'CURRENT-OPENAI-9012');
  check('merge keeps the fallback gemini      ', active.geminiApiKey, 'STALE-FROM-BACKUP-1234');
  void res; void keyringPath;
  fs.rmSync(userData, { recursive: true, force: true });
}

// 5b. merge with credentials.enc CORRUPTED on disk after load: same guarantee.
{
  console.log('\n[R-10r] --- merge with keyring corrupted after load ---');
  const { userData, keyringPath, mgr } = mutableAmbiguousSetup();
  fs.writeFileSync(keyringPath, Buffer.from('GARBAGE-CORRUPTION'));
  const res = mgr.resolveAmbiguousStores('merge');
  check('resolve ok                           ', res.ok, true);
  const active = mgr.getAllCredentials();
  check('merge keeps keyring-only openai      ', active.openaiApiKey, 'CURRENT-OPENAI-9012');
  check('  and persists it to the keyring     ', readKeyring(keyringPath).openaiApiKey, 'CURRENT-OPENAI-9012');
  fs.rmSync(userData, { recursive: true, force: true });
}

// 5c. persist failure rolls the resolution BACK (pre-fix: flag cleared + memory
//     swapped while disk stayed ambiguous, and the UI said "Nothing was changed").
{
  console.log('\n[R-10r] --- persist failure rolls back ---');
  const { userData, mgr } = mutableAmbiguousSetup();
  const unionBefore = mgr.getAllCredentials();
  // Make BOTH write branches fail: .tmp targets pre-created as directories.
  fs.mkdirSync(path.join(userData, 'credentials.enc.tmp'));
  fs.mkdirSync(path.join(userData, 'credentials.fallback.enc.tmp'));
  const res = mgr.resolveAmbiguousStores('keyring');
  check('resolve reports persist_failed       ', res, { ok: false, error: 'persist_failed' });
  check('  memory rolled back to the union    ', mgr.getAllCredentials(), unionBefore);
  check('  state is STILL ambiguous           ', mgr.getAmbiguousStoreSummary() !== null, true);
  fs.rmSync(userData, { recursive: true, force: true });
}

// 5d. prefer-path + BOTH stores undecryptable: the re-entry escape hatch must
//     still be reachable (pre-fix: the counter never bumped → locked out forever).
{
  console.log('\n[R-10r] --- both stores undecryptable: escape hatch ---');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'r10res-dead-'));
  const keyringPath = path.join(userData, 'credentials.enc');
  const fallbackPath = path.join(userData, 'credentials.fallback.enc');
  fs.writeFileSync(keyringPath, Buffer.from('NOT-A-KEYRING-BLOB'));
  fs.writeFileSync(fallbackPath, Buffer.from('NOT-DECRYPTABLE-EITHER'));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(keyringPath, old, old);
  fs.utimesSync(fallbackPath, new Date(), new Date());
  let mgr;
  for (let boot = 1; boot <= 3; boot++) mgr = freshManager(userData, true);
  check('re-entry latched by the 3rd cold boot', mgr.needsCredentialReentry?.(), true);
  mgr.setGeminiApiKey('REENTERED-KEY');
  check('  re-entered key persists            ', readKeyring(keyringPath)?.geminiApiKey ?? fs.existsSync(fallbackPath), 'REENTERED-KEY');
  fs.rmSync(userData, { recursive: true, force: true });
}

// 5e. blocker-1b recovery proves the keyring readable → failure history cleared
//     (pre-fix: a stale count made the NEXT transient failure latch at 1 strike).
{
  console.log('\n[R-10r] --- recovery clears the failure history ---');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'r10res-clear-'));
  const keyringPath = path.join(userData, 'credentials.enc');
  const fallbackPath = path.join(userData, 'credentials.fallback.enc');
  const failPath = path.join(userData, 'credentials.decryptfail');
  fs.writeFileSync(keyringPath, Buffer.from('NOT-A-KEYRING-BLOB'));
  fs.writeFileSync(fallbackPath, Buffer.from('NOT-DECRYPTABLE-EITHER'));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(keyringPath, old, old);
  fs.utimesSync(fallbackPath, new Date(), new Date());
  freshManager(userData, true);            // boot 1: both unreadable → count 1
  check('failure recorded after boot 1        ', fs.existsSync(failPath), true);
  // Repair the keyring; the garbage fallback stays newer.
  fs.writeFileSync(keyringPath, Buffer.concat([Buffer.from('KEYRING:'), Buffer.from(JSON.stringify({ geminiApiKey: 'HEALED' }), 'utf8')]));
  fs.utimesSync(keyringPath, old, old);
  const mgr = freshManager(userData, true); // boot 2: blocker-1b recovers from the keyring
  check('recovery loaded the keyring          ', mgr.getAllCredentials().geminiApiKey, 'HEALED');
  check('  failure history cleared            ', fs.existsSync(failPath), false);
  fs.rmSync(userData, { recursive: true, force: true });
}

// 5f. a short credential value must be masked, not disclosed via last4.
{
  console.log('\n[R-10r] --- short values are masked ---');
  const { userData, mgr } = (() => {
    const r = mutableAmbiguousSetup();
    return r;
  })();
  // Overwrite the keyring with a 4-char value; the summary must not disclose it.
  fs.writeFileSync(path.join(userData, 'credentials.enc'),
    Buffer.concat([Buffer.from('KEYRING:'), Buffer.from(JSON.stringify({ geminiApiKey: 'abcd' }), 'utf8')]));
  const sum = mgr.getAmbiguousStoreSummary();
  const entry = sum.keyring.keys.find((k) => k.name === 'geminiApiKey');
  check('short value masked in summary        ', entry.last4, '····');
  check('  long value still shows last4       ', sum.fallback.keys[0].last4, '1234');
  fs.rmSync(userData, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.error(`[R-10r] FAIL: ${failures} assertion(s) failed — the resolution flow is not safe to ship.`);
  process.exit(1);
}
console.log('[R-10r] PASS: all three choices resolve safely, nothing is destroyed, the state actually ends.');
