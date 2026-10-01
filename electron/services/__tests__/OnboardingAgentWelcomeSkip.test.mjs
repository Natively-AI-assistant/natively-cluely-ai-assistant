// The first-launch welcome sits in front of the launcher on a blank profile,
// which is what every dev:agent instance starts with. The flags IPC therefore
// reports it as seen for an agent instance, unless the agent opts back in.
// Source-level: the handler needs a booted Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ipc = fs.readFileSync(path.resolve(here, '../../ipcHandlers.ts'), 'utf8');

function flagsHandler() {
  const i = ipc.indexOf("safeHandle('onboarding:get-flags'");
  assert.notEqual(i, -1);
  return ipc.slice(i, i + 900);
}

test('an agent instance reports the welcome as seen, never a packaged build', () => {
  const h = flagsHandler();
  assert.match(h, /!app\.isPackaged/, 'must never apply to a packaged build');
  assert.match(h, /process\.env\.NATIVELY_AGENT_USER_DATA/, 'must key off the agent launcher');
  assert.match(h, /seenStartup: agentSkipsWelcome \|\|/);
});

test('NATIVELY_AGENT_WELCOME=1 keeps the welcome for the agent testing it', () => {
  assert.match(flagsHandler(), /process\.env\.NATIVELY_AGENT_WELCOME !== '1'/);
});
