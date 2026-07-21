// electron/llm/__tests__/EvidenceRepairLive.test.mjs
//
// PI v3 (W6a): the LIVE WTA path now validates profile answers against the
// EVIDENCE that grounded them (validateProfileEvidence — fabricated metrics)
// and repairs critical violations, instead of the output-only check.
// Invariants:
//   1. A fabricated metric in a profile-REQUIRED answer is an error violation.
//   2. A metric PRESENT in the evidence is not flagged.
//   3. Engine wiring: the live path calls validateProfileEvidence with the
//      candidateProfile as evidence; unsupported_metric is in the critical set
//      gated on profileContextPolicy === 'required'; the repair re-check also
//      rejects newly-invented metrics.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { validateProfileEvidence } = await import(pathToFileURL(path.join(distRoot, 'llm/profileEvidenceValidator.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distRoot, 'llm/AnswerPlanner.js')).href);

const engineSrc = readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

const EVIDENCE = `<candidate_projects>
SQL-Copilot — a query assistant built with Python and Postgres; reduced query review time by 40%.
</candidate_projects>`;

const plan = planAnswer({
    question: 'tell me about your projects',
    source: 'what_to_answer',
    speakerPerspective: 'interviewer',
});

describe('W6a: evidence validation semantics', () => {
    test('fabricated metric → error violation', () => {
        const r = validateProfileEvidence({
            answer: 'I built SQL-Copilot, which improved customer retention by 25%.',
            plan, evidence: EVIDENCE, profileAvailable: true, candidateDirected: true,
        });
        assert.ok(r.violations.some(v => v.code === 'unsupported_metric' && v.severity === 'error'),
            `codes=${r.violations.map(v => v.code)}`);
        assert.match(r.repairInstruction, /Remove or soften/);
    });

    test('grounded metric (in evidence) → no metric violation', () => {
        const r = validateProfileEvidence({
            answer: 'I built SQL-Copilot, which reduced query review time by 40%.',
            plan, evidence: EVIDENCE, profileAvailable: true, candidateDirected: true,
        });
        assert.ok(!r.violations.some(v => v.code === 'unsupported_metric'),
            `codes=${r.violations.map(v => v.code)}`);
    });
});

describe('W6a: live-path wiring (source pins)', () => {
    test('the live WTA validation uses validateProfileEvidence with candidateProfile as evidence', () => {
        assert.match(engineSrc, /const pv = validateProfileEvidence\(\{[\s\S]{0,200}evidence: candidateProfile/);
    });

    test('unsupported_metric is critical for profile-REQUIRED answers', () => {
        assert.match(engineSrc, /unsupported_metric'\s*&&\s*answerPlan\.profileContextPolicy === 'required'/);
    });

    test('the repair re-check also uses evidence validation and rejects new fabricated metrics', () => {
        assert.match(engineSrc, /const reCheck = validateProfileEvidence\(/);
        assert.match(engineSrc, /'unsupported_metric'\]\)/);
    });
});
