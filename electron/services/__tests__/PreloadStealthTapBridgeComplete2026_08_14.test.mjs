// F-116 regression pin (audit/autopilot-2026-08-14).
//
// Three-way contract drift: main registered 'stealth-tap:refresh-ime' on all
// platform branches, the renderer called
// window.electronAPI?.stealthTapRefreshIme?.() on every window focus, and
// electron.d.ts declared it — but preload never exposed it, so the optional
// call silently no-op'd and the stale mount-time auto-engage value swallowed
// CJK composition keystrokes. The two existing source-regex tests each
// verified one END (main handler / renderer call site); this pins the MIDDLE
// link generically: every stealthTap* method the renderer invokes must be
// exposed by preload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..', '..');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.ts'), 'utf8');
const renderer = fs.readFileSync(
  path.join(root, 'src', 'components', 'NativelyInterface.tsx'),
  'utf8'
);

test('every renderer-invoked stealthTap* method is exposed by preload', () => {
  const used = new Set(
    [...renderer.matchAll(/electronAPI\??\.(stealthTap\w+)/g)].map((m) => m[1])
  );
  assert.ok(used.size > 0, 'expected renderer stealthTap usages');
  for (const name of used) {
    assert.ok(
      new RegExp(`${name}\\s*:\\s*\\(`).test(preload),
      `renderer calls electronAPI.${name} but preload does not expose it — the optional call silently no-ops (F-116 class)`
    );
  }
});

test('stealthTapRefreshIme wires to the stealth-tap:refresh-ime channel', () => {
  assert.ok(
    /stealthTapRefreshIme:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('stealth-tap:refresh-ime'\)/.test(preload),
    'stealthTapRefreshIme must invoke stealth-tap:refresh-ime (F-116)'
  );
});
