// electron/llm/__tests__/AnswerCoverage2026_08_18.test.mjs
//
// WTA audit Part 11: clause-level coverage promoted out of the doc-grounded
// gate (answerCoverage.ts) + its live wiring in IntelligenceEngine:
//   • assessment runs OBSERVE-ONLY on every eligible WTA answer (cheap pure
//     string work, trace/telemetry only);
//   • the focused APPEND-ONLY repair runs behind the default-OFF
//     wtaClauseCoverageRepair flag, mirrors the profile-repair plumbing
//     (raceStreamWithDeadline + acceptRepairedAnswer), and is accepted only
//     if the missing-clause count actually decreased.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { assessAnswerCoverage, shouldAttemptClauseRepair, buildClauseRepairInstruction } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/answerCoverage.js')).href
);

const COMPOUND_Q = 'What was the project, why did you choose Kafka, and what problems did you face with consumer groups?';

describe('assessAnswerCoverage', () => {
  test('a compound answer missing one clause is flagged with that clause', () => {
    const answer = 'The project was a notification fan-out service. We chose Kafka because we needed replayable ordered delivery at high throughput.';
    const a = assessAnswerCoverage(COMPOUND_Q, answer);
    assert.equal(a.multiPart, true);
    assert.equal(a.incomplete, true);
    assert.equal(a.missing.length, 1);
    assert.match(a.missing[0], /consumer groups/i);
  });

  test('a complete compound answer passes', () => {
    const answer = 'The project was a notification service. We chose Kafka for replayable delivery. The main problems were consumer group rebalances during deploys, which we fixed with static membership.';
    const a = assessAnswerCoverage(COMPOUND_Q, answer);
    assert.equal(a.incomplete, false);
    assert.deepEqual(a.missing, []);
  });

  test('a single-part question is always complete by definition', () => {
    const a = assessAnswerCoverage('Why did you choose Kafka?', 'Because of throughput.');
    assert.equal(a.multiPart, false);
    assert.equal(a.incomplete, false);
  });

  test('a refusal answer is never flagged (mirrors the doc-grounded contract)', () => {
    const a = assessAnswerCoverage(COMPOUND_Q, 'I would rather not discuss that.', { answerIsRefusal: true });
    assert.equal(a.incomplete, false);
  });
});

describe('shouldAttemptClauseRepair', () => {
  test('1 missing clause → repair', () => {
    assert.equal(shouldAttemptClauseRepair({ multiPart: true, incomplete: true, missing: ['what problems did you face'] }), true);
  });
  test('3 missing clauses → too broad, no repair', () => {
    assert.equal(shouldAttemptClauseRepair({ multiPart: true, incomplete: true, missing: ['a', 'b', 'c'] }), false);
  });
  test('complete → no repair', () => {
    assert.equal(shouldAttemptClauseRepair({ multiPart: true, incomplete: false, missing: [] }), false);
  });
});

describe('buildClauseRepairInstruction', () => {
  test('names the missing clause and forbids rewriting the draft', () => {
    const s = buildClauseRepairInstruction(['what problems did you face with consumer groups']);
    assert.match(s, /consumer groups/);
    assert.match(s, /Do not rewrite, repeat, or remove/);
    assert.match(s, /ONLY a concise additional section/);
  });
});

describe('live wiring (source pins)', () => {
  const engineSrc = readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
  const flagsSrc = readFileSync(path.resolve(__dirname, '../../intelligence/intelligenceFlags.ts'), 'utf8');

  test('wtaClauseCoverageRepair flag exists and defaults OFF', () => {
    assert.match(flagsSrc, /wtaClauseCoverageRepair: \{ env: 'NATIVELY_WTA_CLAUSE_COVERAGE_REPAIR', setting: 'wtaClauseCoverageRepairEnabled', default: false \}/);
  });

  test('assessment is observed on the live path with the standard skip gates', () => {
    const idx = engineSrc.indexOf('assessAnswerCoverage(');
    assert.ok(idx > 0, 'engine consults assessAnswerCoverage');
    const block = engineSrc.slice(idx - 2500, idx + 3500);
    assert.match(block, /!isSpeculative/);
    assert.match(block, /isCodingAnswerType/);
    assert.match(block, /isDocGroundedAnswerType/);
    assert.match(block, /clause_coverage/);
  });

  test('repair is append-only, flag-gated, and re-checked before accept', () => {
    const idx = engineSrc.indexOf('buildClauseRepairInstruction(');
    assert.ok(idx > 0, 'engine builds the focused repair instruction');
    const block = engineSrc.slice(idx - 2000, idx + 5000);
    assert.match(block, /isIntelligenceFlagEnabled\('wtaClauseCoverageRepair'\)/);
    assert.match(block, /acceptRepairedAnswer/);
    assert.match(block, /\$\{fullAnswer\}\\n\\n\$\{|fullAnswer \+ '\\n\\n' \+|`\$\{fullAnswer\}\n\n/, 'the repair APPENDS to the draft, never rewrites it');
    assert.match(block, /assessAnswerCoverage\(/, 're-assessed after repair before accept');
  });
});
