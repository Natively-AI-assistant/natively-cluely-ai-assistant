// electron/llm/__tests__/ContextRoute.test.mjs
//
// Unified context-routing contract coverage (Phase 6 / Phase 14). Proves the
// deterministic include/exclude rules hold for every answer type, with the
// hard leak rules (coding excludes resume/JD/negotiation; identity excludes
// JD/negotiation; negotiation gated to salary; JD-fit uses JD+resume) enforced
// in ONE place (buildContextRoute / isLayerAllowed over planAnswer).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  planAnswer,
  buildContextRoute,
  isLayerAllowed,
  summarizeContextRoute,
} from '../../../dist-electron/electron/llm/index.js';

const planFor = (question, source = 'what_to_answer', extra = {}) => planAnswer({
  question,
  source,
  speakerPerspective: source === 'what_to_answer' ? 'interviewer' : 'user',
  ...extra,
});

const routeFor = (q, source) => buildContextRoute(planFor(q, source));

// ── Coding isolation (the headline leak rule) ────────────────────────────────
describe('coding/DSA/system-design/debugging exclude profile+sensitive context', () => {
  const codingQs = [
    'what is the code for odd even',
    'can you solve two sum',
    'reverse a linked list',
    'implement binary search',
    'valid parentheses',
    'design a url shortener',
    'debug this null pointer exception',
    'write a function for fibonacci',
  ];
  for (const q of codingQs) {
    test(`"${q}" excludes resume/jd/negotiation/custom_context/reference_files`, () => {
      const route = routeFor(q, 'what_to_answer');
      for (const layer of ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files']) {
        assert.ok(route.excludedLayers.includes(layer), `"${q}" must exclude ${layer}`);
        assert.equal(isLayerAllowed(planFor(q), layer), false, `isLayerAllowed("${q}", ${layer}) must be false`);
      }
    });
  }
});

// ── Identity ────────────────────────────────────────────────────────────────
describe('identity uses stable_identity + resume, excludes jd/negotiation/reference', () => {
  for (const q of ['what is my name?', 'who am i', 'introduce yourself']) {
    test(`"${q}"`, () => {
      const route = routeFor(q, 'manual_input');
      assert.ok(route.selectedLayers.includes('stable_identity'), 'identity must use stable_identity');
      assert.ok(route.selectedLayers.includes('resume'), 'identity may use resume');
      for (const layer of ['jd', 'negotiation', 'reference_files']) {
        assert.ok(route.excludedLayers.includes(layer), `identity must exclude ${layer}`);
      }
    });
  }
});

// ── JD fit ───────────────────────────────────────────────────────────────────
describe('JD-fit uses resume + jd, excludes negotiation', () => {
  for (const q of ['why are you a good fit for this role', 'how does your experience match the job']) {
    test(`"${q}"`, () => {
      const route = routeFor(q, 'what_to_answer');
      assert.ok(route.selectedLayers.includes('resume'), 'jd-fit needs resume');
      assert.ok(route.selectedLayers.includes('jd'), 'jd-fit needs jd');
      assert.ok(route.excludedLayers.includes('negotiation'), 'jd-fit excludes negotiation');
    });
  }
});

// ── Negotiation ──────────────────────────────────────────────────────────────
describe('negotiation uses negotiation context, excludes reference_files', () => {
  for (const q of ['what salary should I ask for', 'they offered 120k, how do I counter', 'what compensation is fair']) {
    test(`"${q}"`, () => {
      const plan = planFor(q, 'what_to_answer');
      assert.equal(plan.answerType, 'negotiation_answer', `"${q}" → ${plan.answerType}`);
      const route = buildContextRoute(plan);
      assert.ok(route.selectedLayers.includes('negotiation'), 'negotiation must use negotiation layer');
      assert.ok(route.excludedLayers.includes('reference_files'), 'negotiation excludes reference_files');
    });
  }
  test('a coding question does NOT route to negotiation', () => {
    assert.notEqual(planFor('write code for two sum').answerType, 'negotiation_answer');
  });
});

// ── Profile detail / projects / skills / experience ──────────────────────────
describe('profile questions use resume, never negotiation', () => {
  for (const q of ['tell me about your projects', 'what skills do you have', 'walk me through your experience']) {
    test(`"${q}"`, () => {
      const route = routeFor(q, 'what_to_answer');
      assert.ok(route.selectedLayers.includes('resume'), `"${q}" should use resume`);
      assert.ok(!route.selectedLayers.includes('negotiation'), `"${q}" must not use negotiation`);
    });
  }
});

// ── Route completeness & invariants ──────────────────────────────────────────
describe('route invariants', () => {
  test('selected and excluded together cover all known layers, no overlap', () => {
    const route = routeFor('two sum', 'what_to_answer');
    const all = [...route.selectedLayers, ...route.excludedLayers];
    const set = new Set(all);
    assert.equal(set.size, all.length, 'no layer appears in both selected and excluded');
    // Every layers[] entry is classified
    for (const l of route.layers) {
      assert.equal(l.selected, route.selectedLayers.includes(l.layer));
      assert.ok(typeof l.reason === 'string' && l.reason.length > 0, 'every layer has a reason');
    }
  });
  test('forbidden layers always have tokenBudget 0', () => {
    const route = routeFor('odd even', 'what_to_answer');
    for (const l of route.layers) {
      if (!l.selected) assert.equal(l.tokenBudget, 0, `${l.layer} excluded → 0 budget`);
    }
  });
  test('maxTotalPromptTokens is a positive ceiling', () => {
    const route = routeFor('why do I fit this role', 'what_to_answer');
    assert.ok(route.maxTotalPromptTokens >= 1200);
  });
  test('summarizeContextRoute is PII-free (names + counts only)', () => {
    const route = routeFor('two sum', 'what_to_answer');
    const summary = summarizeContextRoute(route);
    assert.equal(summary.answerType, route.answerType);
    assert.ok(Array.isArray(summary.selected));
    assert.ok(Array.isArray(summary.excluded));
    // The summary carries only layer NAMES (e.g. "live_transcript"), counts, and
    // the answerType — never raw content. Assert there are no free-text/content
    // VALUES: every selected/excluded entry must be a known layer identifier.
    const KNOWN = new Set([
      'stable_identity', 'resume', 'jd', 'custom_context', 'ai_persona', 'negotiation',
      'reference_files', 'live_transcript', 'prior_assistant_responses', 'active_mode',
      'screen_context', 'preferred_language',
    ]);
    for (const l of [...summary.selected, ...summary.excluded]) {
      assert.ok(KNOWN.has(l), `summary leaked a non-layer value: ${l}`);
    }
  });
  test('isLayerAllowed mirrors the plan forbidden list', () => {
    const plan = planFor('two sum');
    for (const layer of plan.forbiddenContextLayers) {
      assert.equal(isLayerAllowed(plan, layer), false);
    }
    assert.equal(isLayerAllowed(plan, 'live_transcript'), true, 'non-forbidden layer allowed');
  });
});
