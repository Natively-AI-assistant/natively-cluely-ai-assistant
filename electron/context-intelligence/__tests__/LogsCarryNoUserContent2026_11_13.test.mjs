// F-PRV-02 (live-pipeline forensics, 2026-11-13): the candidate's name, the
// target employer, project names, the interviewer's question and the model's
// answer were written into logs (natively_debug.log on disk). They now log as
// a length unless the Context-Intelligence content gate is open (dev build +
// verbose + NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT=1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const dbg = require(path.join(root, 'dist-electron/electron/context-intelligence/debug/debug-config.js'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('logSafeText', () => {
  test('gate closed (production / unbound): only the length', () => {
    delete process.env.NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT;
    assert.equal(dbg.logSafeText('Jordan Rivera'), '<13 chars>');
    assert.equal(dbg.logSafeText(null), '<0 chars>');
  });
  test('gate open (dev build + verbose + env): the text', () => {
    dbg.bindContextDebugConfig({ isProductionBuild: false, readStoredLevel: () => 'verbose' });
    process.env.NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT = '1';
    try {
      assert.equal(dbg.logSafeText('Jordan Rivera'), 'Jordan Rivera');
    } finally {
      delete process.env.NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT;
      dbg.bindContextDebugConfig({ isProductionBuild: true, readStoredLevel: () => null });
    }
  });
});

describe('content log sites use logSafeText (source pins)', () => {
  test('IntelligenceEngine [TRACE:LONGCTX] question / answer fields', () => {
    const ie = read('electron/IntelligenceEngine.ts');
    assert.match(ie, /question_extracted', JSON\.stringify\(\{[\s\S]{0,400}?latestQuestion: logSafeText\(extractedQuestion\.latestQuestion\)/);
    assert.doesNotMatch(ie, /rawAnswer: fullAnswer,/);
    assert.doesNotMatch(ie, /question: question \|\| extractedQuestion\.latestQuestion \|\| lastInterviewerTurn \|\| null,/);
  });
  const premium = (rel) => path.join(root, 'premium/electron/knowledge', rel);
  const hasPremium = fs.existsSync(premium('KnowledgeOrchestrator.ts'));
  test('premium extractor / orchestrator / AOT / company research', { skip: !hasPremium && 'premium absent (OSS build)' }, () => {
    const se = fs.readFileSync(premium('StructuredExtractor.ts'), 'utf8');
    assert.doesNotMatch(se, /parsed resume for: \$\{resume\.identity\.name\}/);
    assert.doesNotMatch(se, /parsed JD for: \$\{jd\.title\}/);
    const ko = fs.readFileSync(premium('KnowledgeOrchestrator.ts'), 'utf8');
    assert.doesNotMatch(ko, /Direct Project match for: \$\{proj\.name\}/);
    assert.doesNotMatch(ko, /Direct Skill match for: \$\{skillMatch\}/);
    assert.doesNotMatch(ko, /mock\.question\.substring\(0, 60\)/);
    assert.doesNotMatch(ko, /from: \$\{filePath\}/);
    assert.doesNotMatch(ko, /alignment\(s\) for \$\{jd\.company\}/);
    const aot = fs.readFileSync(premium('AOTPipeline.ts'), 'utf8');
    assert.doesNotMatch(aot, /for \$\{jd\.company\}/);
    const cr = fs.readFileSync(premium('CompanyResearchEngine.ts'), 'utf8');
    assert.doesNotMatch(cr, /Dossier generated for \$\{companyName\}/);
  });
});
