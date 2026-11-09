// The review prompt tells the server each time it is shown, so prompt views can
// be counted against reviews and dismissals. Production opens the prompt through
// the onboarding orchestrator (isOpen prop), which never runs the host's own
// check(), so before this every server row had last_prompted_at = null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('an orchestrator-opened review prompt records the showing once per opening', () => {
  const host = read('src/components/ReviewPromptHost.tsx');
  const effect = host.match(/const shownRef = useRef\(false\)[\s\S]*?\}, \[isOrchestratorControlled, isOpen\]\)/);
  assert.ok(effect, 'shown effect keyed on the orchestrator prop');
  assert.match(effect[0], /if \(!isOrchestratorControlled\) return/, 'self-scheduled path already marks in check()');
  assert.match(effect[0], /if \(!isOpen\) \{ shownRef\.current = false; return \}/, 'a closed card re-arms for the next opening');
  assert.match(effect[0], /if \(shownRef\.current\) return/, 'one mark per opening, not per render');
  assert.match(effect[0], /reviewMarkShown/);
});

test('review:mark-shown reports a "shown" event to the server', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const handler = ipc.match(/safeHandle\('review:mark-shown'[\s\S]*?\n  \}\);/);
  assert.ok(handler);
  assert.match(handler[0], /svc\.markShown\(\)/);
  assert.match(handler[0], /reportEvent\(apiKey, hwid, \{ type: 'shown' \}\)\.catch\(\(\) => \{\}\)/, 'fire-and-forget, never blocks the card');
});

test('the server accepts the "shown" prompt event', (t) => {
  const rel = 'natively-api/reviews.js';
  if (!fs.existsSync(path.join(REPO, rel))) return t.skip('natively-api checkout not present');
  assert.match(read(rel), /const allowed = \[[^\]]*'shown'[^\]]*\]/);
});
