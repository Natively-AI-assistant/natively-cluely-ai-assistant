// F-BND-03 (live-pipeline forensics, 2026-11-13): the core/premium boundary
// was untyped. Core's contract (electron/premium/contracts.ts) lacked fields
// core reads (systemPromptInjection, isBareGreeting — the latter read through
// `as any`), and nothing noticed when the two sides drifted. This test fails
// when premium's PromptAssemblyResult or KnowledgeOrchestrator surface and
// core's contract disagree on a name.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Field names of `export interface <name> { ... }` (top-level members only). */
function interfaceFields(src, name) {
  const start = src.indexOf(`export interface ${name}`);
  assert.ok(start >= 0, `interface ${name} not found`);
  let i = src.indexOf('{', start) + 1;
  let depth = 1; let body = '';
  for (; depth > 0 && i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth > 0) body += ch;
  }
  const noComments = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...noComments.matchAll(/^\s*([A-Za-z_]\w*)\??\s*[:(]/gm)].map((m) => m[1]).sort();
}

const core = read('electron/premium/contracts.ts');
const premiumPath = 'premium/electron/knowledge/ContextAssembler.ts';
const hasPremium = fs.existsSync(path.join(root, premiumPath));

describe('core/premium boundary contract (F-BND-03)', () => {
  test('PromptAssemblyResult: same field names on both sides', { skip: !hasPremium && 'premium absent (OSS build)' }, () => {
    assert.deepEqual(interfaceFields(core, 'PromptAssemblyResult'), interfaceFields(read(premiumPath), 'PromptAssemblyResult'));
  });
  test('KnowledgeOrchestrator implements every boundary method', { skip: !hasPremium && 'premium absent (OSS build)' }, () => {
    const ko = read('premium/electron/knowledge/KnowledgeOrchestrator.ts');
    for (const m of interfaceFields(core, 'KnowledgeOrchestratorBoundary')) {
      assert.match(ko, new RegExp(`^\\s+(?:public\\s+)?(?:async\\s+)?${m}\\(`, 'm'), `KnowledgeOrchestrator lost ${m}()`);
    }
  });
  test('core reads the premium result through the contract, not `as any`', () => {
    const llm = read('electron/LLMHelper.ts');
    assert.doesNotMatch(llm, /\(knowledgeResult as any\)/);
    assert.equal((llm.match(/const knowledgeResult: PromptAssemblyResult \| null = await this\.knowledgeOrchestrator\.processQuestion\(/g) || []).length, 2);
    const ie = read('electron/IntelligenceEngine.ts');
    assert.match(ie, /const orchestrator: \(KnowledgeOrchestratorBoundary & Record<string, any>\) \| undefined = this\.llmHelper\.getKnowledgeOrchestrator\?\.\(\);/);
  });
});
