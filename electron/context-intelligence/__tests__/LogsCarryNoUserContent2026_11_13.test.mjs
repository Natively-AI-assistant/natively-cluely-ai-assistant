// F-PRV-02 (live-pipeline forensics, 2026-11-13), narrowed by the owner on
// 2026-11-14: logs must keep the facts a later debugger needs (the question,
// the answer in the env-only LONGCTX trace, employer, JD title, matched
// projects / skills, mock-question hint). Only what identifies the user and
// never explains a bug stays out: the résumé holder's name (a length unless
// the dev content gate is open) and the folders of an ingested file's path
// (the file name is kept).
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
  test('IntelligenceEngine [TRACE:LONGCTX] keeps the question and answer (debugging facts)', () => {
    const ie = read('electron/IntelligenceEngine.ts');
    assert.doesNotMatch(ie, /logSafeText\(/);
    assert.match(ie, /question_extracted', JSON\.stringify\(\{[\s\S]{0,400}?latestQuestion: extractedQuestion\.latestQuestion,/);
    assert.match(ie, /rawAnswer: fullAnswer,/);
  });
  const premium = (rel) => path.join(root, 'premium/electron/knowledge', rel);
  const hasPremium = fs.existsSync(premium('KnowledgeOrchestrator.ts'));
  test('premium logs keep the facts, not the name or the home folder', { skip: !hasPremium && 'premium absent (OSS build)' }, () => {
    const se = fs.readFileSync(premium('StructuredExtractor.ts'), 'utf8');
    assert.match(se, /parsed resume for: \$\{logSafeText\(resume\.identity\.name\)\}/);
    assert.match(se, /parsed JD for: \$\{jd\.title\} at \$\{jd\.company/);
    const ko = fs.readFileSync(premium('KnowledgeOrchestrator.ts'), 'utf8');
    assert.match(ko, /Direct Project match for: \$\{proj\.name\}/);
    assert.match(ko, /Direct Skill match for: \$\{skillMatch\}/);
    assert.match(ko, /from: \$\{logSafeFileName\(filePath\)\}/);
    assert.match(ko, /alignment\(s\) for \$\{jd\.company\}/);
    const aot = fs.readFileSync(premium('AOTPipeline.ts'), 'utf8');
    assert.match(aot, /Company research complete for \$\{jd\.company\}/);
    const cr = fs.readFileSync(premium('CompanyResearchEngine.ts'), 'utf8');
    assert.match(cr, /Dossier generated for \$\{companyName\}/);
  });
});

describe('logSafeFileName', () => {
  test('keeps only the file name, for macOS and Windows paths', () => {
    assert.equal(dbg.logSafeFileName('/Users/someone/Documents/Resume 2026.pdf'), 'Resume 2026.pdf');
    assert.equal(dbg.logSafeFileName('C:\\Users\\someone\\Documents\\Résumé.docx'), 'Résumé.docx');
    assert.equal(dbg.logSafeFileName('notes.md'), 'notes.md');
    assert.equal(dbg.logSafeFileName(null), '');
  });
});
