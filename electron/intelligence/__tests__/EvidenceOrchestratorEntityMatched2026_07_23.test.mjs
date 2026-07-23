// Regression tests for the entityMatched fix in EvidenceOrchestrator.ts
// (root-cause fix, 2026-07-23).
//
// Root cause: EvidencePack.coverage.entityMatched used to be computed as
// `factual.length > 0` — a no-op alias of hasDirectEvidence that never
// actually checked whether the QUESTION's target entity was present in the
// retrieved evidence. This is exactly the "entity present vs property
// present" confusion described in the investigation: a document mentioning
// "ROS" and "Mercury X1" generically should not make entityMatched=true for
// EVERY question regardless of what entity the question actually asks about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const distDir = (() => {
  const bundled = path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/EvidenceOrchestrator.js');
  if (fs.existsSync(bundled)) return path.resolve(repoRoot, 'dist-electron');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'entitymatched-dist-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  try { execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* expected partial */ }
  return target;
})();

const cjsRequire = createRequire(import.meta.url);
const { EvidenceOrchestrator } = cjsRequire(path.resolve(distDir, 'electron/intelligence/context-os/EvidenceOrchestrator.js'));
const { SourceAuthorityKernel } = cjsRequire(path.resolve(distDir, 'electron/intelligence/context-os/SourceAuthorityKernel.js'));

const orchestrator = new EvidenceOrchestrator();
const kernel = new SourceAuthorityKernel();

function contractFor(question, overrides = {}) {
  return kernel.build({
    surface: 'manual_chat',
    question,
    activeModeId: 'mode-1',
    sourceAuthority: 'reference_files_only',
    answerShape: 'general',
    voicePerspective: 'assistant_explanation',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: false,
    hasLiveTranscript: false,
    ...overrides,
  });
}

const ROS_BLOCK = [
  '<active_mode_retrieved_context>',
  '  <snippet>',
  '    <source>{"sourceId":"doc-1","fileName":"thesis.pdf","chunkIndex":1,"score":0.9}</source>',
  '    <text>The Mercury X1 platform runs ROS for its middleware layer, coordinating sensor and actuator nodes.</text>',
  '  </snippet>',
  '</active_mode_retrieved_context>',
].join('\n');

test('entityMatched: true when the question target entity IS present in evidence', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'What perception systems does the Mercury X1 support?',
    contract: contractFor('What perception systems does the Mercury X1 support?'),
    retrievers: { retrieveModeContext: () => ROS_BLOCK },
  });
  assert.equal(pack.coverage.entityMatched, true, 'Mercury X1 is both asked about and present in the evidence');
});

test('entityMatched: false when the question target entity is NOT present in evidence (root-cause fix)', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'What ROS distribution and version was used for the AtlasBot experiments?',
    contract: contractFor('What ROS distribution and version was used for the AtlasBot experiments?'),
    retrievers: { retrieveModeContext: () => ROS_BLOCK },
  });
  // "AtlasBot" is not in the evidence at all — before the fix, entityMatched
  // was `factual.length > 0`, which would incorrectly be TRUE here purely
  // because SOME evidence was retrieved, regardless of whether it actually
  // discusses the entity the question asks about.
  assert.equal(pack.coverage.entityMatched, false, 'entityMatched must not be true for an entity absent from the evidence');
});

test('entityMatched: falls back to hasDirectEvidence when no target entity is extracted (permissive, no new rejections)', async () => {
  const pack = await orchestrator.buildEvidencePack({
    question: 'Summarize the middleware architecture.',
    contract: contractFor('Summarize the middleware architecture.'),
    retrievers: { retrieveModeContext: () => ROS_BLOCK },
  });
  assert.equal(pack.coverage.entityMatched, pack.coverage.hasDirectEvidence, 'with no extractable target entity, entityMatched preserves the prior permissive behavior');
});
