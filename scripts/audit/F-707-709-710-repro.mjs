// F-707 / F-709 / F-710 repro — three latent integrity defects.
//
// F-707: electron-updater's `channel` SETTER ends with allowDowngrade = true
//        (verified against the installed copy), so setting channel='latest'
//        silently disabled the library-side downgrade filter that the app's own
//        comment claims to be belt-and-bracing. Nothing user-visible today only
//        because AppState.isRealUpgrade catches downgrades — which makes that
//        hand-rolled gate load-bearing rather than redundant.
// F-709: will-quit recorded 'user-quit' unguarded, and Electron fires it AFTER
//        before-quit (which deliberately preserves a specific reason) — so
//        'updater-quit-install' and its version metadata were always lost.
// F-710: the unsigned-macOS fallback ignored the public update path it had
//        captured on update-downloaded, depending solely on two undocumented
//        electron-updater internals.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const require_ = createRequire(import.meta.url);
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const lifecycle = fs.readFileSync(path.join(root, 'electron/utils/lifecycleTracker.ts'), 'utf8');

let bad = false;

// F-707 — first confirm the library really does what the finding claims.
const updaterSrc = fs.readFileSync(
  require_.resolve('electron-updater/out/AppUpdater.js'), 'utf8');
const setterClobbers = /set channel\([\s\S]{0,900}?allowDowngrade = true/.test(updaterSrc);
console.log('[F-707] electron-updater channel setter sets allowDowngrade=true:', setterClobbers);
if (setterClobbers) {
  const ch = main.indexOf("autoUpdater.channel = 'latest'");
  const after = ch === -1 ? '' : main.slice(ch, ch + 900);
  if (!/autoUpdater\.allowDowngrade\s*=\s*false/.test(after)) {
    console.error('[F-707] channel is set without restoring allowDowngrade=false (F-707 reproduced)'); bad = true;
  } else console.log('[F-707] ok — allowDowngrade restored after the channel setter');
} else {
  console.log('[F-707] SKIPPED — this electron-updater build does not clobber the flag');
}

// F-709
// Bound the slice to the will-quit handler ONLY. The before-quit handler a few
// lines below carries the same guard, so a wide window silently passes.
const wq = lifecycle.indexOf("app.on('will-quit'");
const wqEnd = lifecycle.indexOf("app.on('window-all-closed'", wq);
const wqBody = wq === -1 ? '' : lifecycle.slice(wq, wqEnd === -1 ? wq + 400 : wqEnd);
if (!/if \(!this\.marker\.quitReason\)/.test(wqBody)) {
  console.error('[F-709] will-quit still overwrites a more specific quit reason (F-709 reproduced)'); bad = true;
} else console.log('[F-709] ok — will-quit preserves a specific reason');

// F-710
const uf = main.indexOf('const updateFile =');
const ufBody = uf === -1 ? '' : main.slice(uf, uf + 400);
if (!/this\.downloadedUpdateInfo\?\.updateFile/.test(ufBody)) {
  console.error('[F-710] the fallback still ignores the captured public path (F-710 reproduced)'); bad = true;
} else console.log('[F-710] ok — the captured public path is preferred');

if (bad) { console.error('FAIL'); process.exit(1); }
console.log('PASS: downgrade protection restored, quit reason preserved, public update path used.');
process.exit(0);
