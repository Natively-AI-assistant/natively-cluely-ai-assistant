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

console.log('');
if (failures) {
  console.error(`[R-10r] FAIL: ${failures} assertion(s) failed — the resolution flow is not safe to ship.`);
  process.exit(1);
}
console.log('[R-10r] PASS: all three choices resolve safely, nothing is destroyed, the state actually ends.');
