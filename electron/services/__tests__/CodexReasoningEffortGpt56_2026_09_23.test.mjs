// electron/services/__tests__/CodexReasoningEffortGpt56_2026_09_23.test.mjs
//
// Issue #573: the reasoning-effort table stopped at gpt-5.5, so 'gpt-5.6-terra'
// longest-matched bare 'gpt-5' (low/medium/high) and a user's xhigh was silently
// sent as low. Same for gpt-6-astra. The Settings picker keeps its own copy of the
// table (the renderer cannot import main-process code); the second test keeps the
// two from drifting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { resolveCodexReasoningEffort } = require(path.resolve(repoRoot, 'dist-electron/electron/services/CodexCliService.js'));

test('xhigh is honoured on the gpt-5.6 and gpt-6 lines', () => {
  for (const model of ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra']) {
    assert.equal(resolveCodexReasoningEffort(model, 'xhigh'), 'xhigh', model);
    assert.equal(resolveCodexReasoningEffort(model, 'high'), 'high', model);
  }
  // Unchanged neighbours.
  assert.equal(resolveCodexReasoningEffort('gpt-5.5', 'none'), 'none');
  assert.equal(resolveCodexReasoningEffort('gpt-5-mini', 'xhigh'), 'low');
});

test('the Settings copy of the table matches the service table', () => {
  const tableOf = (rel) => {
    const src = fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');
    const body = src.match(/const CODEX_MODEL_REASONING_SETS[^=]*=\s*\[([\s\S]*?)\n\];/)[1];
    return Object.fromEntries([...body.matchAll(/\['([^']+)',\s*\[([^\]]*)\]\]/g)]
      .map(([, id, efforts]) => [id, efforts.replace(/[\s']/g, '')]));
  };
  assert.deepEqual(
    tableOf('src/components/settings/AIProvidersSettings.tsx'),
    tableOf('electron/services/CodexCliService.ts'),
  );
});
