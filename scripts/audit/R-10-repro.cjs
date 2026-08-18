#!/usr/bin/env node
/**
 * R-10 repro — F-704: a restored `credentials.fallback.enc` destroys the user's
 * CURRENT credentials.
 *
 * The original code's "KNOWN MIS-FIRE" note argued a restored fallback was
 * harmless because it "decrypts with THIS machine's salt and key material, so
 * decryption would fail". That is wrong whenever the restore is whole-profile
 * (Time Machine, Migration Assistant, synced AppData, a support bundle):
 * getFallbackKey() derives from a CONSTANT string plus a salt stored in the SAME
 * userData directory as the ciphertext, so salt and blob travel together and the
 * key re-derives identically. Decryption SUCCEEDS.
 *
 * Two things then had to be fixed, and the FIRST fix alone was a no-op:
 *   - the staleness guard deleted credentials.enc outright;
 *   - after that was changed to merely "prefer" the fallback, the migrate-up
 *     branch still fired (skipping the keyring READ leaves keyringReadFailed
 *     false), so saveCredentials() re-encrypted the restored fallback straight
 *     over credentials.enc and deleted the fallback — byte-identical data loss.
 *
 * Blocker 1b: if the restored fallback does NOT decrypt (salt not carried),
 * credentials became {} with no write-refusal, so the first ordinary save wrote
 * a near-empty set over an intact keyring.
 *
 * This harness ENCRYPTS A REAL FALLBACK with the manager's own derived key, so
 * the destructive path is genuinely exercised. An earlier version passed
 * vacuously because the fallback never decrypted.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-10-repro.cjs
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
  console.log(`[R-10] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
};

// A safeStorage stub that is a REAL round-trip, so credentials.enc holds
// recoverable content and we can read it back to prove survival.
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
    const mod = require(CM_PATH);
    const CM = mod.CredentialsManager;
    const inst = CM.getInstance ? CM.getInstance() : new CM();
    // The constructor is intentionally empty ("load on construction after app
    // ready"); loadCredentials() runs from init(). Without this the harness
    // observes a pristine object and every assertion is vacuous — which is
    // exactly how the first version of this repro passed while the fix was a no-op.
    inst.init();
    return inst;
  } finally {
    Module._load = realLoad;
  }
}

function scenario(label, { fallbackDecrypts }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'r10-creds-'));
  const keyringPath = path.join(userData, 'credentials.enc');
  const fallbackPath = path.join(userData, 'credentials.fallback.enc');

  const CURRENT = { geminiApiKey: 'CURRENT-REAL-KEY', openaiApiKey: 'CURRENT-OPENAI', claudeApiKey: 'CURRENT-CLAUDE' };
  const STALE = { geminiApiKey: 'STALE-FROM-BACKUP' };

  // Build a REAL fallback the way the app itself would: boot once with the
  // keyring UNAVAILABLE and save, so the manager writes credentials.fallback.enc
  // with its own derived key and its own salt in this userData dir. This is the
  // whole-profile-restore case — salt and blob travel together, so the key
  // re-derives identically and decryption SUCCEEDS. (No private crypto helper is
  // needed, and nothing here can drift from what the app actually writes.)
  if (fallbackDecrypts) {
    const seeder = freshManager(userData, /* keyringAvailable */ false);
    seeder.setGeminiApiKey(STALE.geminiApiKey);
    if (!fs.existsSync(fallbackPath)) {
      console.error('[R-10] FAIL: seeding did not produce a fallback file; harness cannot exercise the path.');
      process.exit(1);
    }
  } else {
    // Salt did NOT travel with the blob — decryption fails (blocker 1b).
    freshManager(userData, false);   // create the salt file so the dir is realistic
    fs.writeFileSync(fallbackPath, Buffer.from('NOT-DECRYPTABLE-GARBAGE'));
  }

  // Current credentials, in the keyring, encrypted the way the app would.
  fs.writeFileSync(keyringPath, Buffer.concat([Buffer.from('KEYRING:'), Buffer.from(JSON.stringify(CURRENT), 'utf8')]));

  // Restore makes the fallback NEWER than the keyring — the trigger condition.
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(keyringPath, old, old);
  const now = new Date();
  fs.utimesSync(fallbackPath, now, now);

  const mgr = freshManager(userData, /* keyringAvailable */ true);
  const loaded = mgr.getAllCredentials ? mgr.getAllCredentials() : {};

  console.log(`\n[R-10] --- ${label} ---`);
  console.log(`[R-10] loaded into memory : ${JSON.stringify(loaded)}`);

  if (fallbackDecrypts) {
    // The destructive path must actually have been reachable.
    check('  fallback DID decrypt (path exercised)', loaded, STALE);
  }

  // Simulate the user saving one key, as any settings toggle would.
  const saveResult = mgr.setGroqApiKey('NEW-GROQ-KEY');

  const keyringStillThere = fs.existsSync(keyringPath);
  let keyringContents = null;
  if (keyringStillThere) {
    const raw = fs.readFileSync(keyringPath).toString('utf8');
    keyringContents = raw.startsWith('KEYRING:') ? JSON.parse(raw.slice(8)) : raw;
  }
  console.log(`[R-10] keyring file exists: ${keyringStillThere}`);
  console.log(`[R-10] keyring contents   : ${JSON.stringify(keyringContents)}`);

  check('  keyring file survives                ', keyringStillThere, true);
  check('  CURRENT gemini key survives          ', keyringContents && keyringContents.geminiApiKey, 'CURRENT-REAL-KEY');
  check('  CURRENT openai key survives          ', keyringContents && keyringContents.openaiApiKey, 'CURRENT-OPENAI');
  check('  CURRENT claude key survives          ', keyringContents && keyringContents.claudeApiKey, 'CURRENT-CLAUDE');

  fs.rmSync(userData, { recursive: true, force: true });
  void saveResult;
}

scenario('restored fallback DECRYPTS (whole-profile restore)', { fallbackDecrypts: true });
scenario('restored fallback does NOT decrypt (blocker 1b)', { fallbackDecrypts: false });

console.log('');
if (failures) {
  console.error(`[R-10] FAIL: ${failures} assertion(s) failed — a restored fallback destroyed current credentials.`);
  process.exit(1);
}
console.log('[R-10] PASS: current credentials survive a restored fallback, decryptable or not.');
