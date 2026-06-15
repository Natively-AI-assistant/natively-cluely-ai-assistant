import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

test('public OpenOffer build omits premium knowledge degrade-to-local runtime modules', () => {
  const premiumKnowledgeDir = path.join(repoRoot, 'dist-electron/premium/electron/knowledge');
  assert.equal(fs.existsSync(path.join(premiumKnowledgeDir, 'KnowledgeOrchestrator.js')), false);
});
