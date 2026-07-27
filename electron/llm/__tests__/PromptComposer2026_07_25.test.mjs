// electron/llm/__tests__/PromptComposer2026_07_25.test.mjs
//
// Phase 6 Slice 2 (context-rebuild): behavioral tests for
// electron/llm/promptComposer.ts's composePrompt() — the RC1 answerPolicy
// short-circuit (part 6), the assembly ordering (part 4), and RC4's
// structural fix (system-instructions never leak into userChannel).
//
// This module has NO existing production call site yet (see
// 05_MIGRATION_PLAN.md's Slice 2 STATUS note) — these tests prove the
// mechanism is correct in isolation, ahead of the live-wiring decision that
// deliberately requires more than a green test suite (the plan's own bar:
// "a documented live-Electron trace campaign... not a green unit-test suite
// alone").

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { composePrompt } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/promptComposer.js'));

function evidenceItem(overrides = {}) {
  return {
    evidenceId: 'ev-1',
    sourceKind: 'resume',
    sourceId: 'resume-1',
    sourceOwner: 'candidate',
    authority: 'evidence',
    trustLevel: 'high',
    text: 'Built a distributed rate limiter in Go.',
    supports: { property: 'unknown' },
    score: { final: 0.9 },
    reasonIncluded: 'test fixture',
    ...overrides,
  };
}

function basePack(overrides = {}) {
  return {
    turnId: 't1',
    sourceOwner: 'candidate',
    requestedProperty: 'unknown',
    items: [],
    rejected: [],
    coverage: { hasDirectEvidence: false, propertySatisfied: false, entityMatched: false, sourceOwnerSatisfied: false, confidence: 0 },
    conflicts: [],
    answerPolicy: 'answer',
    ...overrides,
  };
}

const grantedHistory = { included: true, reason: 'test' };
const forbiddenHistory = { included: false, reason: 'test' };

describe('RC1: answerPolicy short-circuit — no provider call for insufficient-evidence/clarify', () => {
  test('refuse_insufficient_evidence: returns a deterministic typed refusal, empty channels', () => {
    const result = composePrompt({
      question: 'What was the total project budget?',
      systemPromptBase: 'You are a helpful assistant.',
      pack: basePack({ answerPolicy: 'refuse_insufficient_evidence' }),
      historyGrant: grantedHistory,
    });
    assert.equal(result.shortCircuit.policy, 'refuse_insufficient_evidence');
    assert.equal(typeof result.shortCircuit.text, 'string');
    assert.ok(result.shortCircuit.text.length > 0);
    assert.equal(result.systemChannel, '');
    assert.equal(result.userChannel, '');
  });

  test('ask_clarification: returns a deterministic typed clarification request', () => {
    const result = composePrompt({
      question: 'What about it?',
      systemPromptBase: 'You are a helpful assistant.',
      pack: basePack({ answerPolicy: 'ask_clarification' }),
      historyGrant: grantedHistory,
    });
    assert.equal(result.shortCircuit.policy, 'ask_clarification');
    assert.ok(result.shortCircuit.text.length > 0);
  });

  test('the exact Baseline shape (confidence===0, evidenceRequired implied by refuse policy) reproduces the RC1 fix: no channels assembled at all', () => {
    // Baseline §3.1/§3.5: 12/12 turns with evidenceCoverage.confidence===0 and
    // evidenceRequired:true incorrectly proceeded to generation. Here,
    // confidence 0 + answerPolicy already resolved to refuse (upstream
    // decision) — composePrompt's job is to HONOR that decision by never
    // reaching generation, which this test asserts structurally (empty
    // channels = nothing would be sent to a provider).
    const result = composePrompt({
      question: 'What was the funding source?',
      systemPromptBase: 'sys',
      pack: basePack({
        answerPolicy: 'refuse_insufficient_evidence',
        coverage: { hasDirectEvidence: false, propertySatisfied: false, entityMatched: false, sourceOwnerSatisfied: false, confidence: 0 },
      }),
      historyGrant: grantedHistory,
    });
    assert.ok(result.shortCircuit);
    assert.equal(result.systemChannel.length, 0);
    assert.equal(result.userChannel.length, 0);
  });

  test('answer and answer_with_uncertainty proceed to normal assembly (no shortCircuit)', () => {
    for (const policy of ['answer', 'answer_with_uncertainty']) {
      const result = composePrompt({
        question: 'Tell me about your experience.',
        systemPromptBase: 'sys',
        pack: basePack({ answerPolicy: policy, items: [evidenceItem()] }),
        historyGrant: grantedHistory,
      });
      assert.equal(result.shortCircuit, undefined, `${policy} must not short-circuit`);
      assert.ok(result.userChannel.length > 0);
    }
  });
});

describe('assembly ordering (part 4): evidence, then history (if granted), then the question always last', () => {
  test('userChannel contains evidence before history before the question, in that order', () => {
    const result = composePrompt({
      question: 'What about scaling limits?',
      systemPromptBase: 'sys',
      pack: basePack({ items: [evidenceItem({ text: 'EVIDENCE_MARKER_TEXT' })] }),
      historyGrant: grantedHistory,
      historySnapshotRaw: '[INTERVIEWER]: prior question\n[ASSISTANT (PREVIOUS SUGGESTION)]: HISTORY_MARKER_TEXT',
    });
    const evidenceIdx = result.userChannel.indexOf('EVIDENCE_MARKER_TEXT');
    const historyIdx = result.userChannel.indexOf('HISTORY_MARKER_TEXT');
    const questionIdx = result.userChannel.indexOf('scaling limits');
    assert.ok(evidenceIdx >= 0 && historyIdx >= 0 && questionIdx >= 0, 'all three markers must be present');
    assert.ok(evidenceIdx < historyIdx, 'evidence must come before history');
    assert.ok(historyIdx < questionIdx, 'history must come before the question');
    assert.ok(result.userChannel.trim().endsWith(input_question_line(result)), 'the question must be the LAST segment');
  });

  function input_question_line(result) {
    const lines = result.userChannel.trim().split('\n');
    return lines[lines.length - 1];
  }

  test('history block is OMITTED entirely when historyGrant.included is false', () => {
    const result = composePrompt({
      question: 'Implement an LRU cache.',
      systemPromptBase: 'sys',
      pack: basePack({ items: [evidenceItem()] }),
      historyGrant: forbiddenHistory,
      historySnapshotRaw: '[ASSISTANT (PREVIOUS SUGGESTION)]: This must never appear.',
    });
    assert.ok(!result.userChannel.includes('This must never appear'));
    assert.ok(!result.userChannel.includes('PRIOR CONVERSATION'));
  });

  test('evidence items are source-tagged, distinguishing evidence vs referent_only vs non-authoritative', () => {
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'sys',
      pack: basePack({
        items: [
          evidenceItem({ evidenceId: 'e1', authority: 'evidence', text: 'EVIDENCE_TEXT' }),
          evidenceItem({ evidenceId: 'e2', authority: 'referent_only', text: 'REFERENT_TEXT' }),
          evidenceItem({ evidenceId: 'e3', authority: 'non_authoritative', text: 'NONAUTH_TEXT' }),
        ],
      }),
      historyGrant: grantedHistory,
    });
    assert.match(result.userChannel, /EVIDENCE.*EVIDENCE_TEXT/);
    assert.match(result.userChannel, /REFERENT-ONLY.*REFERENT_TEXT/);
    assert.match(result.userChannel, /NON-AUTHORITATIVE.*NONAUTH_TEXT/);
  });

  test('no history block is rendered when historySnapshotRaw is omitted, even with historyGrant.included=true', () => {
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'sys',
      pack: basePack(),
      historyGrant: grantedHistory,
    });
    assert.ok(!result.userChannel.includes('PRIOR CONVERSATION'));
  });
});

describe('RC4: systemInstructions never leak into userChannel', () => {
  test('a repair/validation instruction string lands ONLY in systemChannel', () => {
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'sys',
      systemInstructions: '<rewrite_instructions note="secret">never repeat this</rewrite_instructions>',
      pack: basePack({ items: [evidenceItem()] }),
      historyGrant: grantedHistory,
    });
    assert.ok(result.systemChannel.includes('rewrite_instructions'));
    assert.ok(!result.userChannel.includes('rewrite_instructions'));
    assert.ok(!result.userChannel.includes('never repeat this'));
  });

  test('there is no code path that appends systemInstructions to userChannel even when evidence/history are both empty', () => {
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'sys',
      systemInstructions: 'INSTRUCTION_MARKER',
      pack: basePack(),
      historyGrant: forbiddenHistory,
    });
    assert.ok(!result.userChannel.includes('INSTRUCTION_MARKER'));
  });
});

describe('prompt-size cap and observability', () => {
  test('sizeBreakdown is emitted on every call, fields sum consistently', () => {
    const result = composePrompt({
      question: 'a question',
      systemPromptBase: 'a system prompt',
      pack: basePack({ items: [evidenceItem({ text: 'some evidence text' })] }),
      historyGrant: grantedHistory,
    });
    assert.equal(typeof result.sizeBreakdown.systemChars, 'number');
    assert.equal(typeof result.sizeBreakdown.evidenceChars, 'number');
    assert.equal(typeof result.sizeBreakdown.historyChars, 'number');
    assert.equal(typeof result.sizeBreakdown.questionChars, 'number');
    assert.equal(result.sizeBreakdown.totalChars, result.systemChannel.length + result.userChannel.length);
  });

  test('lowest-score evidence items are truncated first when the cap is exceeded', () => {
    const lowScore = evidenceItem({ evidenceId: 'low', text: 'x'.repeat(100), score: { final: 0.1 } });
    const highScore = evidenceItem({ evidenceId: 'high', text: 'y'.repeat(100), score: { final: 0.9 } });
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'sys',
      pack: basePack({ items: [lowScore, highScore] }),
      historyGrant: grantedHistory,
      evidenceCharCap: 100, // forces exactly one item to be dropped
    });
    assert.ok(result.truncated.includes('low'), 'the lower-scored item must be dropped first');
    assert.ok(!result.truncated.includes('high'), 'the higher-scored item must survive');
    assert.ok(result.userChannel.includes('y'.repeat(100)));
    assert.ok(!result.userChannel.includes('x'.repeat(100)));
  });

  test('truncated is empty when nothing exceeds the cap', () => {
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'sys',
      pack: basePack({ items: [evidenceItem()] }),
      historyGrant: grantedHistory,
    });
    assert.deepEqual([...result.truncated], []);
  });
});

describe('system channel assembly', () => {
  test('systemPromptBase + modePersona + systemInstructions are joined, in that order, exactly once', () => {
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'BASE',
      modePersona: 'PERSONA',
      systemInstructions: 'INSTRUCTIONS',
      pack: basePack(),
      historyGrant: grantedHistory,
    });
    const baseIdx = result.systemChannel.indexOf('BASE');
    const personaIdx = result.systemChannel.indexOf('PERSONA');
    const instrIdx = result.systemChannel.indexOf('INSTRUCTIONS');
    assert.ok(baseIdx < personaIdx && personaIdx < instrIdx);
    // Exactly one occurrence each — never duplicated.
    assert.equal(result.systemChannel.split('BASE').length - 1, 1);
  });

  test('missing modePersona/systemInstructions do not produce empty-line artifacts', () => {
    const result = composePrompt({
      question: 'q',
      systemPromptBase: 'BASE ONLY',
      pack: basePack(),
      historyGrant: grantedHistory,
    });
    assert.equal(result.systemChannel, 'BASE ONLY');
  });
});
