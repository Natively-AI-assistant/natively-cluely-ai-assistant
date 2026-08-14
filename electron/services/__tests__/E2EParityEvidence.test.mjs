import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('parity-gaps-evidence.spec.ts exists and is opt-in via ELECTRON_E2E', () => {
  const spec = read('tests/e2e/parity-gaps-evidence.spec.ts');

  assert.match(spec, /ELECTRON_E2E === '1'/);
  assert.match(spec, /test\.skip\(true, 'Set ELECTRON_E2E=1/);
  assert.match(spec, /providerDataScopes round-trips through real IPC/);
  assert.match(spec, /meetingRetention round-trips through real IPC/);
  assert.match(spec, /renderer exposes the gap-related preload APIs/);
});

test('parity-gaps spec exercises the real IPC contracts via window.electronAPI', () => {
  const spec = read('tests/e2e/parity-gaps-evidence.spec.ts');

  assert.match(spec, /electronAPI\.getProviderDataScopes/);
  assert.match(spec, /electronAPI\.setProviderDataScopes/);
  assert.match(spec, /electronAPI\.getMeetingRetention/);
  assert.match(spec, /electronAPI\.setMeetingRetention/);
  assert.match(spec, /generateWhatToSay: typeof api\.generateWhatToSay/);
  assert.match(spec, /acceptDynamicAction: typeof api\.acceptDynamicAction/);
});

test('package.json exposes opt-in test:e2e:parity script gated by ELECTRON_E2E env', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = pkg.scripts['test:e2e:parity'];

  assert.ok(script, 'expected scripts["test:e2e:parity"] to exist');
  assert.match(script, /ELECTRON_E2E=1/);
  assert.match(script, /tests\/e2e\/parity-gaps-evidence\.spec\.ts/);
  assert.match(script, /ELECTRON_APP_PORT/);
});
