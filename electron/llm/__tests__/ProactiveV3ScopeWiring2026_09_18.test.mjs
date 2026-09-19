// Scope-provenance wiring for V3 proactive/code-hint surfaces.
//
// This is intentionally source-level: buildV3ForTranscriptSurface is a private
// method on the large Electron IntelligenceEngine, while the regression was a
// boundary shape loss (the helper reconstructed {system,user} and discarded the
// bridge's scope arrays). The wrapper behavior itself is covered at runtime by
// ProactiveV3PromptSubstitution and CodeHintV3Adoption after the Electron build.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('transcript-surface helper preserves bridge scopes and adds pinned provenance', () => {
  const engine = read('electron/IntelligenceEngine.ts');
  const start = engine.indexOf('private async buildV3ForTranscriptSurface(');
  const end = engine.indexOf('\n    async runFollowUp(', start);
  assert.ok(start >= 0 && end > start, 'buildV3ForTranscriptSurface body not found');
  const helper = engine.slice(start, end);

  assert.match(helper, /Promise<V3TransportPrompt\s*\|\s*null>/,
    'the helper contract must carry transport scope metadata');
  assert.match(helper, /new Set<ProviderDataScope>\(_v3\.packedDataScopes \?\? \[\]\)/);
  assert.match(helper, /new Set<ProviderDataScope>\(_v3\.messageDataScopes \?\? \[\]\)/);
  assert.match(helper, /pinned\?\.source === 'screenshot'[\s\S]*?\? 'screenshots'[\s\S]*?pinned\?\.source === 'transcript'[\s\S]*?\? 'transcript'/,
    'only screenshot/transcript pinned questions should add provider scopes');
  assert.match(helper, /packedDataScopes\.add\(pinnedDataScope\)/);
  assert.match(helper, /messageDataScopes\.add\(pinnedDataScope\)/);
  assert.match(helper, /packedDataScopes:\s*\[\.\.\.packedDataScopes\]/);
  assert.match(helper, /messageDataScopes:\s*\[\.\.\.messageDataScopes\]/);
});

test('code hint keeps raw source provenance for V3 and still passes image paths', () => {
  const engine = read('electron/IntelligenceEngine.ts');
  assert.match(engine, /buildV3ForTranscriptSurface\('code-hint',[\s\S]*?source:\s*questionSource \?\? 'transcript'/,
    'manual/screenshot/transcript provenance must reach the helper without lossy remapping');

  const codeHint = read('electron/llm/CodeHintLLM.ts');
  assert.match(codeHint, /streamChat\(\s*fittedMessage,\s*imagePaths,/,
    'actual images must remain on streamChat arg 2 so LLMHelper tags them as screenshots');
  assert.match(codeHint, /v3\?\.packedDataScopes \? \[\.\.\.v3\.packedDataScopes\] : \[\]/);
  assert.match(codeHint, /messageDataScopes:\s*\[\.\.\.v3\.messageDataScopes\]/);
});

test('all four wrappers accept the shared V3 transport shape', () => {
  for (const file of ['AssistLLM.ts', 'ClarifyLLM.ts', 'BrainstormLLM.ts', 'CodeHintLLM.ts']) {
    const source = read(`electron/llm/${file}`);
    assert.match(source, /V3TransportPrompt/, `${file} must accept the transport-aware V3 shape`);
    assert.match(source, /v3\?\.packedDataScopes/, `${file} must forward packed scopes`);
    assert.match(source, /v3\.messageDataScopes/, `${file} must forward message scopes`);
  }
});
