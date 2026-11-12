// "Didn't get your key? Email it again" (Plans & Billing) — wiring across the
// three layers. Source-level, so it runs the same on macOS and Windows CI and
// needs no Electron: renderer → preload → main → POST /keys/resend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const IPC = read('electron/ipcHandlers.ts');
const PRELOAD = read('electron/preload.ts');
const TYPES = read('src/types/electron.d.ts');
const SETTINGS = read('src/components/settings/NativelyApiSettings.tsx');
const HELP = read('src/components/settings/KeyResendHelp.tsx');

test('main process posts the email to /keys/resend and never needs a key', () => {
  const start = IPC.indexOf("safeHandle('resend-natively-key'");
  assert.ok(start > 0, 'handler registered');
  const h = IPC.slice(start, IPC.indexOf("safeHandle('get-natively-usage'", start));
  assert.match(h, /\$\{NATIVELY_API_BASE\}\/keys\/resend/);
  assert.match(h, /method: 'POST'/);
  assert.match(h, /JSON\.stringify\(\{ email: address \}\)/);
  assert.doesNotMatch(h, /getNativelyApiKey|x-natively-key/, 'the person asking has no key yet');
  assert.match(h, /res\.status === 429\) return \{ ok: false, error: 'rate_limited' \}/);
});

test('preload exposes it and the renderer type matches', () => {
  assert.match(PRELOAD, /resendNativelyKey: \(email: string\) => ipcRenderer\.invoke\('resend-natively-key', email\)/);
  assert.match(PRELOAD, /resendNativelyKey: \(email: string\) => Promise<\{ ok: boolean; message\?: string; error\?: string \}>;/);
  assert.match(TYPES, /resendNativelyKey: \(email: string\) => Promise<\{ ok: boolean; message\?: string; error\?: string \}>/);
});

test('Plans & Billing shows the help only while no key is saved', () => {
  assert.match(SETTINGS, /\{!isSaved && <KeyResendHelp \/>\}/);
  assert.match(HELP, /window\.electronAPI\?\.resendNativelyKey\?\.\(address\)/);
  // Same message whether or not a key exists: the UI must not claim one was found.
  const shown = [...HELP.matchAll(/\bt\((['"])(.*?)\1\)/g)].map((m) => m[2]);
  assert.ok(shown.length >= 5, 'user-facing strings go through t()');
  for (const s of shown) assert.doesNotMatch(s, /no key found|not found|we found/i, s);
});
