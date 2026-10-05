// electron/services/__tests__/ProfileIntelligenceGate.test.mjs
//
// Verifies the Profile Intelligence IPC handlers enforce the Pro/trial gate.
// We test this at the source level (matching the existing ModeBleeding.test
// pattern) because the IPC handlers themselves require an Electron app
// runtime to instantiate.
//
// The contract is: every premium handler that ingests user data must call
// isProOrTrialActive() before doing any work, and short-circuit to the
// "Pro license required" error message otherwise.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../ipcHandlers.ts');

const GUARDED_HANDLERS = [
  'profile:upload-resume',
  'profile:set-mode',
  'profile:upload-jd',
  'profile:research-company',
  'profile:generate-negotiation',
];

describe('Profile Intelligence IPC: Pro/trial gate', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  for (const handler of GUARDED_HANDLERS) {
    test(`handler "${handler}" calls isProOrTrialActive() before doing work`, () => {
      // Find the handler body — start at safeHandle("name", and run until the
      // matching });
      const idx = findSafeHandle(source, handler);
      assert.ok(idx >= 0, `Handler ${handler} not found in ipcHandlers.ts`);

      const slice = sliceSafeHandleBlock(source, handler).slice(0, 3000);

      // The gate call must appear before the orchestrator is invoked. We
      // assert presence; ordering is verified by a separate index check.
      assert.ok(
        slice.includes('isProOrTrialActive()'),
        `Handler ${handler} must invoke isProOrTrialActive() to enforce the gate`
      );
      assert.ok(
        slice.includes('Pro license required'),
        `Handler ${handler} must return the "Pro license required" error when gated out`
      );

      const gateIdx = slice.indexOf('isProOrTrialActive()');
      const ingestIdx = Math.min(
        ...['ingestDocument', 'getKnowledgeOrchestrator', 'setKnowledgeMode', 'generateNegotiation', 'getCompanyResearchEngine']
          .map(s => {
            const i = slice.indexOf(s);
            return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
          })
      );
      assert.ok(
        gateIdx < ingestIdx,
        `Handler ${handler}: gate check (idx ${gateIdx}) must precede premium work (idx ${ingestIdx})`
      );
    });
  }

  test('profile:get-status returns safe defaults when premium is unavailable (does not call ingest)', () => {
    const idx = findSafeHandle(source, 'profile:get-status');
    assert.ok(idx >= 0);
    const slice = sliceSafeHandleBlock(source, 'profile:get-status').slice(0, 1500);
    // get-status is intentionally NOT gated (it just reports status) — it
    // should return a falsy hasProfile when the orchestrator is missing.
    assert.ok(slice.includes('hasProfile: false'), 'profile:get-status must default to hasProfile=false when orchestrator missing');
  });
});

describe('Profile Intelligence: resume + JD storage tables exist in the schema', () => {
  const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
  const dbSource = fs.readFileSync(dbPath, 'utf8');

  test('user_profile table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS user_profile'));
  });

  test('resume_nodes table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS resume_nodes'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile Intelligence ELIGIBILITY (2026-09-30).
//
// PI (résumé + target JD) belongs to the Looking-for-work and Technical
// Interview templates only. V3 always held that (mode-policy-registry
// profileSources); the legacy/fallback paths did not — phone chat, follow-up
// email, LLMHelper.chat, the AnswerLLM fallback, the V3-error fallthrough and
// legacy WTA injected PI in General/Sales/Recruiting and with no mode at all.
// One function, derived from the registry, now answers for every path.
// ─────────────────────────────────────────────────────────────────────────────

const registryPath = path.resolve(__dirname, '../../../dist-electron/electron/context-intelligence/policies/mode-policy-registry.js');
const { createRequire } = await import('node:module');
const requireDist = createRequire(import.meta.url);
const {
  MODE_IDS, MODE_POLICIES, isProfileIntelligenceAllowed, profileIntelligenceEligibility,
} = requireDist(registryPath);

describe('Profile Intelligence eligibility (one rule, from the registry)', () => {
  const EXPECTED = {
    general: false, sales: false, recruiting: false, 'team-meet': false,
    'looking-for-work': true, 'technical-interview': true,
    lecture: false, seminar: false, 'call-center': false,
  };

  test('covers all nine built-in templates', () => {
    assert.deepEqual([...MODE_IDS].sort(), Object.keys(EXPECTED).sort(),
      'a new built-in mode must be classified here on purpose');
    for (const id of MODE_IDS) {
      assert.equal(isProfileIntelligenceAllowed(id), EXPECTED[id], id);
    }
  });

  test('is DERIVED from profileSources, not a second list', () => {
    for (const id of MODE_IDS) {
      assert.equal(isProfileIntelligenceAllowed(id), MODE_POLICIES[id].profileSources.length > 0, id);
    }
  });

  test('custom modes inherit by TEMPLATE type', () => {
    // A custom mode is stored with templateType = the template it was built from.
    const customFromLfw = { name: 'Sales pitch practice', templateType: 'looking-for-work' };
    const customFromGeneral = { name: 'My Interview Prep', templateType: 'general' };
    assert.equal(isProfileIntelligenceAllowed(customFromLfw.templateType), true);
    assert.equal(isProfileIntelligenceAllowed(customFromGeneral.templateType), false);
  });

  test('no active mode and unknown templates FAIL CLOSED, with a reason', () => {
    for (const none of [null, undefined, '']) {
      assert.deepEqual(profileIntelligenceEligibility(none), { allowed: false, modeId: null, reason: 'no_active_mode' });
    }
    for (const bad of ['coding-interview', 'thesis', '__reserved__', 'Looking-For-Work', 42, {}]) {
      assert.deepEqual(profileIntelligenceEligibility(bad), { allowed: false, modeId: null, reason: 'unknown_mode' }, String(bad));
    }
    assert.deepEqual(profileIntelligenceEligibility('sales'), { allowed: false, modeId: 'sales', reason: 'mode_excludes_profile' });
    assert.deepEqual(profileIntelligenceEligibility('looking-for-work'), { allowed: true, modeId: 'looking-for-work', reason: 'mode_hydrates_profile' });
  });
});

// ── wiring: every legacy/fallback PI injection site consults the gate ───────
//
// Source-level, like the rest of this file. Two halves:
//  1. COUNT: each file's PI entry points (the premium processQuestion intercept,
//     the evidence JIT, the coordinator profile arm, OKF profile cards) are
//     enumerated. A NEW call site fails here until it is gated and listed.
//  2. GATE: each listed site's governing condition carries the eligibility flag.

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
/** Source with whole-line // comments blanked (keeps indexes stable). */
const code = (src) => src.replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length));
const countOf = (src, re) => (code(src).match(re) ?? []).length;
/** Condition text of the nearest `marker` before `callIdx`, up to its `) {`. */
function governingCondition(src, callIdx, marker) {
  const at = src.lastIndexOf(marker, callIdx);
  assert.ok(at >= 0, `no "${marker}" before the call site`);
  const end = src.indexOf(') {', at);
  assert.ok(end > at && end < callIdx, `"${marker}" does not open the block holding the call site`);
  return src.slice(at, end);
}
/** Text of `const name = …;` */
function definition(src, name) {
  const at = src.indexOf(`const ${name} =`);
  assert.ok(at >= 0, `const ${name} not found`);
  return src.slice(at, src.indexOf(';', at));
}

describe('PI gate wiring: LLMHelper knowledge intercept (phone chat, LLMHelper.chat, AnswerLLM, follow-up email, V3 fallthrough)', () => {
  const src = read('LLMHelper.ts');

  test('exactly two processQuestion intercepts exist — any transport reaches one of them', () => {
    assert.equal(countOf(src, /\.processQuestion\(/g), 2,
      'a new knowledge-intercept site must be gated on isProfileIntelligenceAllowedForTurn and added here');
  });

  test('the non-streaming intercept (chatWithGemini: follow-up email, gemini-chat) is gated', () => {
    const call = src.indexOf('this.knowledgeOrchestrator.processQuestion(message)');
    const cond = governingCondition(src, call, 'if (this.knowledgeOrchestrator?.isKnowledgeMode()');
    assert.match(cond, /this\.isProfileIntelligenceAllowedForTurn\(routeOptions\?\.pinnedModeId\)/);
  });

  test('the streaming intercept (streamChat: phone chat, chat(), AnswerLLM, legacy manual/WTA) is gated', () => {
    const call = src.lastIndexOf('this.knowledgeOrchestrator.processQuestion(message)');
    governingCondition(src, call, 'if (shouldRunKnowledge');
    assert.match(definition(src, 'shouldRunKnowledge'), /this\.isProfileIntelligenceAllowedForTurn\(routeOptions\?\.pinnedModeId\)/);
  });

  test('the gate reads ModesManager (pinned mode) and fails CLOSED', () => {
    const at = src.indexOf('private isProfileIntelligenceAllowedForTurn(');
    assert.ok(at >= 0);
    const body = src.slice(at, src.indexOf('\n  }\n', at));
    assert.match(body, /isProfileIntelligenceAllowedForMode\(pinnedModeId \?\? undefined\)/);
    assert.match(body, /catch[^{]*\{\s*return false;/);
  });

  test('LLMHelper.chat() and the transports route through streamChat / chatWithGemini', () => {
    const chatAt = src.indexOf('public async chat(message: string');
    assert.match(src.slice(chatAt, chatAt + 1500), /this\.streamChatWithOutcome\(/);
    assert.match(read('llm/AnswerLLM.ts'), /this\.llmHelper\.streamChat\(/);
    const ipc = read('ipcHandlers.ts');
    assert.match(ipc, /const emailBody = await llmHelper\.chatWithGemini\(/, 'follow-up email');
    assert.match(ipc, /const stream = llmHelper\.streamChat\(message, phoneImagePaths/, 'phone chat');
  });
});

describe('PI gate wiring: ModesManager + main.ts', () => {
  const mm = read('services/ModesManager.ts');
  test('isProfileIntelligenceAllowedForMode delegates to the registry rule', () => {
    const at = mm.indexOf('public isProfileIntelligenceAllowedForMode(');
    assert.match(mm.slice(at, at + 400), /isProfileIntelligenceAllowed\(mode\?\.templateType \?\? null\)/);
  });
  test('the premium intercept predicate (company research, negotiation tracker) is bounded by it', () => {
    const at = mm.indexOf('public isPremiumKnowledgeInterceptAllowed(');
    const body = mm.slice(at, mm.indexOf('\n    }\n', at));
    assert.match(body, /if \(!isProfileIntelligenceAllowed\(mode\?\.templateType \?\? null\)\) return false;/);
    const main = read('main.ts');
    assert.ok((main.match(/isPremiumKnowledgeInterceptAllowed\(\)/g) ?? []).length >= 2);
  });
});

describe('PI gate wiring: legacy manual chat (ipcHandlers, incl. the V3-error fallthrough)', () => {
  const src = read('ipcHandlers.ts');
  const c = code(src);

  test('every PI entry point in ipcHandlers is enumerated', () => {
    assert.equal(countOf(src, /buildManualProfileEvidenceRoute\(\{/g), 1, 'JIT evidence route');
    assert.equal(countOf(src, /profileSvc\.retrieveEvidence\(/g), 1, 'coordinator profile arm');
    assert.equal(countOf(src, /retrieveProfileEvidence\(\{/g), 1, 'OKF profile cards');
    assert.equal(countOf(src, /processQuestion\?*\.?\(/g), 1, 'profile repair');
  });

  test('the flag is the registry rule on the active mode template', () => {
    assert.match(definition(c, 'manualProfileIntelligenceAllowed'),
      /isProfileIntelligenceAllowed\(manualActiveMode\?\.templateType \?\? null\)/);
  });

  test('JIT route: profileEvidenceEligible ⇐ sourceOwnershipAllowsProfile ⇐ gate', () => {
    const call = c.indexOf('buildManualProfileEvidenceRoute({');
    governingCondition(c, call, 'if (profileEvidenceEligible');
    assert.match(definition(c, 'profileEvidenceEligible'), /sourceOwnershipAllowsProfile/);
    assert.match(definition(c, 'sourceOwnershipAllowsProfile'), /manualProfileIntelligenceAllowed/);
  });

  test('coordinator pack and OKF cards: ownershipAllowsProfileEvidence ⇐ gate', () => {
    assert.match(definition(c, 'ownershipAllowsProfileEvidence'), /manualProfileIntelligenceAllowed/);
    const coord = c.indexOf('profileSvc.retrieveEvidence(');
    assert.match(governingCondition(c, coord, 'if (!isCodingChat\n            && !selectedProfileEvidence'), /ownershipAllowsProfileEvidence/);
    const okf = c.indexOf('retrieveProfileEvidence({');
    assert.match(governingCondition(c, okf, 'if (!isCodingChat && !selectedProfileEvidence && !coordinatorGovernedProfileEvidence'), /ownershipAllowsProfileEvidence/);
  });

  test('knowledge intercept flag and profile repair: gated', () => {
    assert.match(definition(c, 'ignoreKnowledge'), /!manualProfileIntelligenceAllowed/);
    assert.match(definition(c, 'profileAvailable'), /^const profileAvailable = manualProfileIntelligenceAllowed && /);
    const repair = c.indexOf('processQuestion?.(message)');
    assert.match(governingCondition(c, repair, 'if (critical'), /critical/);
    assert.match(definition(c, 'critical'), /profileAvailable/);
  });
});

describe('PI gate wiring: legacy WTA (IntelligenceEngine)', () => {
  const src = read('IntelligenceEngine.ts');
  const c = code(src);

  test('every PI entry point in IntelligenceEngine is enumerated', () => {
    assert.equal(countOf(src, /\.processQuestion\(/g), 1, 'orchestrator grounding');
    assert.equal(countOf(src, /selectManualProfileEvidence\(\{/g), 1, 'evidence JIT');
    assert.equal(countOf(src, /profileService\.retrieveEvidence\(/g), 1, 'coordinator profile arm');
  });

  test('the flag is the registry rule on the t0 mode snapshot', () => {
    assert.match(definition(c, 'snapshotProfileIntelligenceAllowed'),
      /isProfileIntelligenceAllowed\(snapshotModeInfo\?\.templateType \?\? null\)/);
  });

  test('grounding, JIT and coordinator conditions carry the flag', () => {
    const ground = c.indexOf('orchestrator.processQuestion(lookupQ)');
    assert.match(governingCondition(c, ground, 'if (orchestrator?.isKnowledgeMode?.()'), /snapshotProfileIntelligenceAllowed/);
    const jit = c.indexOf('selectManualProfileEvidence({');
    assert.match(governingCondition(c, jit, 'if (!candidateProfile && wtaDecisionAllowsCandidateProfile'), /snapshotProfileIntelligenceAllowed/);
    const coord = c.indexOf('profileService.retrieveEvidence(');
    assert.match(governingCondition(c, coord, 'if (!isSpeculative\n                && !isCodingAnswerType'), /snapshotProfileIntelligenceAllowed/);
  });
});
