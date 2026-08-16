// F-117 regression pin (audit/autopilot-2026-08-14).
//
// preload's e2eInvoke was an UNCONDITIONAL passthrough:
// (channel, ...args) => ipcRenderer.invoke(channel, ...args). The inline
// comment claimed it was a no-op in shipped apps, but NATIVELY_E2E gates only
// the __e2e__:* HANDLERS — not the channel argument — so any renderer code
// could reach every production channel ('quit-app', 'set-openai-api-key',
// 'delete-meeting', …), defeating the curated bridge's containment.
// Live-reproduced in scripts/audit/F-117-repro.mjs (production channel
// invoked without the env pre-fix; undefined post-fix, still available under
// NATIVELY_E2E=1 for the e2e probes).
//
// Contract pinned here: the e2eInvoke implementation is exposed only behind
// the NATIVELY_E2E === '1' gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.ts'), 'utf8');

test('e2eInvoke is exposed only behind the NATIVELY_E2E gate', () => {
  const impl = preload.lastIndexOf('e2eInvoke: (channel');
  assert.notEqual(impl, -1, 'e2eInvoke implementation not found');
  const before = preload.slice(Math.max(0, impl - 700), impl);
  assert.ok(
    /process\.env\.NATIVELY_E2E === '1'/.test(before),
    'e2eInvoke must sit inside the NATIVELY_E2E conditional spread — an unconditional passthrough reaches every production channel (F-117)'
  );
});
