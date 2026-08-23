// F-708 repro: isRealUpgrade blocked the legitimate prerelease -> stable upgrade.
//
// stripPre is applied to BOTH operands, so isRealUpgrade('2.1.0-beta.2','2.1.0')
// compares [2,1,0,0] vs [2,1,0,0] → equal → false. electron-updater emits
// update-available (semver gt is true), the app's gate rejects it, and the user
// is told "update not available" — stuck until the next minor. Prereleases DO
// ship here (tags v2.1.0-beta.1/.2, generateUpdatesFilesForAllChannels: true).
//
// Loads the REAL AppState.isRealUpgrade from the built bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// Extract the REAL static from main.ts and evaluate it. main.ts cannot be
// required standalone (it binds electron at module scope), and a hand-copied
// re-implementation can silently drift from the shipped code — which is
// exactly the failure mode this finding is about.
const src = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const start = src.indexOf('static isRealUpgrade(current: string, remote: string): boolean {');
if (start === -1) { console.error('[F-708] Inconclusive: isRealUpgrade not found'); process.exit(2); }
let i = src.indexOf('{', start), depth = 0, end = -1;
for (let j = i; j < src.length; j++) {
  if (src[j] === '{') depth++;
  else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
}
const body = src.slice(i + 1, end)
  .replace(/:\s*string/g, '').replace(/:\s*number\[\]\s*\|\s*null/g, '')
  .replace(/:\s*number\[\]/g, '').replace(/const out: \[\]/g, 'const out = []');
const isRealUpgrade = new Function('current', 'remote', body);
const AppState = { isRealUpgrade };

const cases = [
  ['2.1.0-beta.2', '2.1.0',        true,  'prerelease -> matching stable IS an upgrade'],
  ['2.1.0',        '2.1.0',        false, 'stable -> same stable is not'],
  ['2.1.0',        '2.1.0-beta.2', false, 'stable -> prerelease must stay blocked'],
  ['2.1.0-beta.1', '2.1.0-beta.1', false, 'same prerelease is not an upgrade'],
  ['2.1.0',        '2.2.0',        true,  'normal upgrade still works'],
  ['2.2.0',        '2.1.0',        false, 'downgrade still blocked'],
];

let bad = false;
for (const [cur, rem, want, why] of cases) {
  const got = AppState.isRealUpgrade(cur, rem);
  const ok = got === want;
  console.log(`[F-708] ${ok ? 'ok ' : 'BAD'} ${cur} -> ${rem} = ${got} (want ${want})`);
  if (!ok) { console.error(`        ${why}`); bad = true; }
}
if (bad) { console.error('[F-708] FAIL (F-708 reproduced).'); process.exit(1); }
console.log('[F-708] PASS: beta users can take the matching stable; downgrade protection intact.');
process.exit(0);
