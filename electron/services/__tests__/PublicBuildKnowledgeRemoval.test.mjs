import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

test('public build omits premium knowledge bundle entrypoints', () => {
  const premiumTargets = [
    'dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js',
    'dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js',
    'dist-electron/premium/electron/knowledge/types.js',
  ];

  for (const relPath of premiumTargets) {
    assert.equal(fs.existsSync(path.join(repoRoot, relPath)), false, `${relPath} should be absent from the public build`);
  }
});

test('profile settings renderer no longer contains premium click-gate UI', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/components/ProfileIntelligenceSettings.tsx'), 'utf8');
  assert.doesNotMatch(source, /PremiumUpgradeModal|hasProfileAccess|setIsPremiumModalOpen/);
  assert.match(source, /profileSelectFile/);
  assert.match(source, /profileUploadResume/);
  assert.match(source, /profileUploadJD/);
});
