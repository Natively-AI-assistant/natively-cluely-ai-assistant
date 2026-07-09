// electron/services/__tests__/ModeGenerator.test.mjs
//
// Deterministic unit tests for the ModeGenerator pipeline. These use a STUB
// `complete` (allowed — this is plumbing/logic verification, not a scored answer
// test). The real MiniMax generation is exercised in the Phase 2/4 E2E runs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMetaPromptSystem,
  buildMetaPromptUser,
  extractJsonObject,
  ensureGroundingPhrases,
  normalizeDraft,
  validateDraft,
  promptSimilarity,
  checkDistinctiveness,
  generateMode,
} from '../../../dist-electron/electron/services/ModeGenerator.js';

import { detectCustomModeDocumentGrounding } from '../../../dist-electron/electron/services/ModesManager.js';

describe('ModeGenerator — JSON extraction', () => {
  test('parses a bare JSON object', () => {
    const obj = extractJsonObject('{"name":"X","templateType":"general","customContext":"hi"}');
    assert.equal(obj.name, 'X');
  });
  test('parses JSON inside a code fence', () => {
    const obj = extractJsonObject('```json\n{"name":"Y","templateType":"sales","customContext":"z"}\n```');
    assert.equal(obj.templateType, 'sales');
  });
  test('parses JSON after leading prose / think residue', () => {
    const obj = extractJsonObject('Sure, here it is: {"name":"Z","templateType":"lecture","customContext":"body"} done');
    assert.equal(obj.name, 'Z');
  });
  test('handles braces inside string values', () => {
    const obj = extractJsonObject('{"name":"A","templateType":"general","customContext":"use {STAR} format"}');
    assert.equal(obj.customContext, 'use {STAR} format');
  });
  test('throws on no object', () => {
    assert.throws(() => extractJsonObject('no json here'));
  });
});

describe('ModeGenerator — grounding backstop', () => {
  test('ensureGroundingPhrases makes a non-grounded prompt grounded', () => {
    const before = 'Answer questions confidently in a warm tone.';
    assert.equal(detectCustomModeDocumentGrounding(before), false);
    const after = ensureGroundingPhrases(before);
    assert.equal(detectCustomModeDocumentGrounding(after), true);
  });
  test('ensureGroundingPhrases is idempotent when already grounded', () => {
    const grounded = 'Only use the uploaded reference documents; answer from the provided files.';
    assert.equal(detectCustomModeDocumentGrounding(grounded), true);
    assert.equal(ensureGroundingPhrases(grounded), grounded);
  });
});

describe('ModeGenerator — normalizeDraft', () => {
  const brief = (over = {}) => ({ key: 'k', brief: 'test brief', requiresGrounding: false, ...over });

  test('maps invalid templateType to general', () => {
    const d = normalizeDraft(brief(), { name: 'Backend Interview', templateType: 'nonsense', customContext: 'Be concise and technical about API design and tradeoffs.' }, 'raw');
    assert.equal(d.templateType, 'general');
  });
  test('honors templateHint when model returns garbage type', () => {
    const d = normalizeDraft(brief({ templateHint: 'sales' }), { name: 'Sales', templateType: '???', customContext: 'Sell with value framing and discovery questions throughout the call.' }, 'raw');
    assert.equal(d.templateType, 'sales');
  });
  test('renames a mode that collides with reserved General', () => {
    const d = normalizeDraft(brief(), { name: 'General', templateType: 'general', customContext: 'Some real instructions about being helpful and concise here.' }, 'raw');
    assert.notEqual(d.name.toLowerCase(), 'general');
  });
  test('grounding-required brief always yields a grounded draft', () => {
    const d = normalizeDraft(brief({ requiresGrounding: true }), { name: 'Thesis Defense', templateType: 'general', customContext: 'Defend the claims with academic rigor and cite sections precisely.' }, 'raw');
    assert.equal(d.documentGrounded, true);
    assert.equal(detectCustomModeDocumentGrounding(d.customContext), true);
  });
  test('clamps overlong customContext under the 1200 cap', () => {
    const long = 'word '.repeat(500);
    const d = normalizeDraft(brief(), { name: 'Long', templateType: 'general', customContext: long }, 'raw');
    assert.ok(d.customContext.length <= 1200, `len ${d.customContext.length}`);
  });
  test('throws on missing name', () => {
    assert.throws(() => normalizeDraft(brief(), { templateType: 'general', customContext: 'x' }, 'raw'));
  });
});

describe('ModeGenerator — validateDraft', () => {
  const brief = (over = {}) => ({ key: 'k', brief: 'b', requiresGrounding: false, ...over });
  const draft = (over = {}) => ({ key: 'k', name: 'Backend Interview', templateType: 'general', customContext: 'Answer concisely with senior-level API design tradeoffs and system design depth throughout the interview; lead with the decision, then justify it with concrete scalability and reliability reasoning.', documentGrounded: false, raw: '', ...over });

  test('clean draft has no errors', () => {
    const issues = validateDraft(draft(), brief());
    assert.equal(issues.filter(i => i.severity === 'error').length, 0);
  });
  test('flags placeholder text', () => {
    const issues = validateDraft(draft({ customContext: 'Answer as [insert role] with [your company] tone and details here for real.' }), brief());
    assert.ok(issues.some(i => i.message.includes('placeholder')));
  });
  test('flags too-short customContext', () => {
    const issues = validateDraft(draft({ customContext: 'short' }), brief());
    assert.ok(issues.some(i => i.message.includes('too short')));
  });
  test('grounding-required but ungrounded is an error', () => {
    const issues = validateDraft(draft({ documentGrounded: false }), brief({ requiresGrounding: true }));
    assert.ok(issues.some(i => i.field === 'customContext' && i.message.includes('grounding required')));
  });
});

describe('ModeGenerator — distinctiveness', () => {
  test('identical prompts have similarity 1', () => {
    assert.equal(promptSimilarity('alpha beta gamma delta', 'alpha beta gamma delta'), 1);
  });
  test('disjoint prompts have similarity 0', () => {
    assert.equal(promptSimilarity('alpha beta gamma', 'delta epsilon zeta'), 0);
  });
  test('checkDistinctiveness flags near-duplicates', () => {
    const mk = (key, cc) => ({ key, name: key, templateType: 'general', customContext: cc, documentGrounded: false, raw: '' });
    const drafts = [
      mk('a', 'concise senior backend engineering answers about api design tradeoffs scalability'),
      mk('b', 'concise senior backend engineering answers about api design tradeoffs scalability'),
      mk('c', 'warm behavioral star format storytelling about teamwork leadership conflict resolution'),
    ];
    const r = checkDistinctiveness(drafts, 0.6);
    assert.ok(r.nearDuplicates.some(nd => (nd.a === 'a' && nd.b === 'b')));
    assert.ok(r.maxPairSimilarity >= 0.6);
  });
});

describe('ModeGenerator — generateMode with stub LLM', () => {
  test('returns a valid draft on first good response', async () => {
    const stub = async () => JSON.stringify({ name: 'Backend Eng Interview', templateType: 'technical-interview', customContext: 'Give concise, senior-level answers on distributed system design and API tradeoffs; lead with the decision, then justify with scalability, consistency, and failure-mode reasoning grounded in real production experience.' });
    const { draft, attempts } = await generateMode({ key: 'be', brief: 'backend eng interview', requiresGrounding: false }, stub);
    assert.equal(attempts, 1);
    assert.equal(draft.templateType, 'technical-interview');
    assert.ok(draft.name.length > 3);
  });

  test('retries on a bad response then succeeds', async () => {
    let n = 0;
    const stub = async () => {
      n++;
      if (n === 1) return 'garbage no json';
      return JSON.stringify({ name: 'HR Behavioral', templateType: 'general', customContext: 'Answer in STAR structure (Situation, Task, Action, Result) with a warm, confident tone; keep to two crisp examples with measurable outcomes and reflect briefly on what you learned each time.' });
    };
    const { draft, attempts } = await generateMode({ key: 'hr', brief: 'behavioral', requiresGrounding: false }, stub);
    assert.equal(attempts, 2);
    assert.ok(draft.customContext.includes('STAR'));
  });

  test('grounding-required brief yields grounded draft even if model forgets', async () => {
    const stub = async () => JSON.stringify({ name: 'Thesis Defense', templateType: 'lecture', customContext: 'Defend your thesis claims rigorously and cite specific sections when answering committee questions.' });
    const { draft } = await generateMode({ key: 'th', brief: 'thesis defense', requiresGrounding: true }, stub);
    assert.equal(draft.documentGrounded, true);
  });

  test('throws after max attempts of bad output', async () => {
    const stub = async () => 'never valid';
    await assert.rejects(() => generateMode({ key: 'x', brief: 'x brief here', requiresGrounding: false }, stub, { maxAttempts: 2 }));
  });
});

describe('ModeGenerator — meta-prompt', () => {
  test('system prompt names the JSON contract and template types', () => {
    const s = buildMetaPromptSystem();
    assert.ok(s.includes('technical-interview'));
    assert.ok(s.includes('customContext'));
    assert.ok(/only.*json/i.test(s));
  });
  test('grounding-required user prompt demands both phrase families', () => {
    const u = buildMetaPromptUser({ key: 'k', brief: 'legal q&a', requiresGrounding: true });
    assert.ok(/source of truth|uploaded/i.test(u));
    assert.ok(/only use|do not use outside/i.test(u));
  });
});
