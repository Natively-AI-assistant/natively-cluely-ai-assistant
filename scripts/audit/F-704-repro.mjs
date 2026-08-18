// F-704 repro: the credential fallback is NOT machine-bound, and the
// stale-fallback path DELETED the user's current credentials on that false
// premise.
//
// getFallbackKey() derives from a CONSTANT string plus a per-install random
// salt, and SALT_PATH sits in the SAME userData directory as
// credentials.fallback.enc. A whole-profile copy (Time Machine, Migration
// Assistant, synced AppData, support bundle) therefore carries salt and blob
// together and the key re-derives identically. Three code comments asserted
// the opposite, and the mtime guard relied on it: seeing a newer restored
// fallback it called removeKeyringFile() — destroying the CURRENT credentials —
// on the reasoning that the restored blob "cannot decrypt anyway". It can.
//
// Two checks: (1) the destructive delete is gone; (2) no code still ASSERTS
// machine binding, since that claim is what justified the delete.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const mgr = fs.readFileSync(path.join(root, 'electron/services/CredentialsManager.ts'), 'utf8');
const crypto_ = fs.readFileSync(path.join(root, 'electron/services/credentialFallbackCrypto.ts'), 'utf8');

let bad = false;

// (1) the mtime branch must not delete the keyring.
const i = mgr.indexOf('fallbackMtime > keyringMtime');
const branch = i === -1 ? "" : mgr.slice(i, i + 2600);
if (i === -1) { console.error('[F-704] Inconclusive: mtime branch not found'); process.exit(2); }
if (/this\.removeKeyringFile\(\)/.test(branch)) {
  console.error('[F-704] the stale-fallback branch still DELETES the keyring file — a restored profile silently destroys current credentials (F-704 reproduced)');
  bad = true;
} else {
  console.log('[F-704] ok — the stale-fallback branch no longer deletes the keyring');
}
if (!/preferFallbackThisLoad = true/.test(branch)) {
  console.error('[F-704] the branch must still PREFER the newer fallback (behaviour preserved)'); bad = true;
}

// (2) no surviving assertion of machine binding.
const claims = [
  [crypto_, /machine\/install-bound: copying the file to another machine/, 'credentialFallbackCrypto header'],
  [mgr, /SALT_PATH is machine-bound via os\.userInfo\/MachineGuid, so a\s*\n\s*\/\/\s*cross-machine fallback cannot decrypt anyway/, 'CredentialsManager mtime rationale'],
];
for (const [src, re, where] of claims) {
  if (re.test(src)) { console.error(`[F-704] ${where} still asserts machine binding`); bad = true; }
  else console.log(`[F-704] ok — ${where} no longer asserts machine binding`);
}

if (bad) { console.error('[F-704] FAIL'); process.exit(1); }
console.log('[F-704] PASS: no destructive delete on a restored profile, and no code claims a binding it does not have.');
process.exit(0);
