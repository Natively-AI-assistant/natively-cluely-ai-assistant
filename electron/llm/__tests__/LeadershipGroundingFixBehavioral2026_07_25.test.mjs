// electron/llm/__tests__/LeadershipGroundingFixBehavioral2026_07_25.test.mjs
//
// Phase 6 Slice 3/4 prep (context-rebuild, 2026-07-25): behavioral
// conversion of LeadershipGroundingFix2026_07_06.test.mjs's 4
// KnowledgeOrchestrator-source-pinned assertions, which the migration plan
// requires converted or deleted BEFORE Slice 4's KnowledgeOrchestrator
// refactor starts (they source-pin buildStructuredCategoryPack/
// buildExperienceFallbackPack/namesLeadershipOrg — exactly the injection-
// decision logic Slice 4 rewrites).
//
// Uses the SAME mock-KnowledgeDatabaseManager pattern already established
// and passing in this exact suite
// (electron/services/__tests__/InterviewerPerspectiveGrounding.test.mjs) —
// a plain object implementing only the db methods the constructor/
// processQuestion() path actually calls, NOT a real better-sqlite3-backed
// KnowledgeDatabaseManager. This sidesteps the environment's
// better-sqlite3/Node ABI mismatch (NODE_MODULE_VERSION 148 vs 141,
// documented in 05_MIGRATION_PLAN.md's test-harness-prerequisites) entirely
// — no native module is touched.
//
// RC6 recap (docs/context-rebuild): "Tell me about your role at SEDS
// CUSAT." fabricated a denial of real resume content because the
// deterministic category pack only emitted leadership nodes when the
// question literally contained "leadership"/"led"/"managed" — the word
// "role" routes to the `experience` category keyword instead. The fix:
// leadership ALSO emits when the question names a leadership org by
// string/token match, dynamically read off the resume (no hardcoded org
// names).
//
// The remaining 3 assertions in the original file (candidate_leadership as
// a KnowledgeCardType; ProfileCardTemplates' card-building; OkfMarkdownExporter's
// label) are about main-repo files (types.ts/ProfileCardTemplates.ts/
// OkfMarkdownExporter.ts), NOT the premium submodule Slice 4 touches — they
// stay in the original file, source-pinned (one of them, the KnowledgeCardType
// union-membership check, has no runtime equivalent at all: TS union types
// don't exist at runtime).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');

function resumeWithLeadership(leadership) {
  return {
    id: 1,
    type: 'resume',
    structured_data: {
      identity: { name: 'Priya Nair', email: '', location: '', phone: '', links: [] },
      summary: '',
      skills: ['Python', 'ROS'],
      experience: [
        { company: 'Acme Robotics', role: 'Software Engineer', start_date: '2022-01', end_date: null, bullets: ['Built perception pipeline'] },
      ],
      projects: [],
      education: [],
      achievements: [],
      certifications: [],
      leadership,
    },
  };
}

function makeOrchestrator(resume) {
  const db = {
    initializeSchema() {},
    getDocumentByType(t) { return t === 'resume' ? resume : null; },
    getAllNodes() { return []; },
    getNodeCount() { return 0; },
    getIntro() { return null; },
    getGapAnalysis() { return null; },
    getNegotiationScript() { return null; },
    getMockQuestions() { return null; },
    getCultureMappings() { return null; },
  };
  const o = new KnowledgeOrchestrator(db);
  o.setKnowledgeMode(true);
  return o;
}

const LEADERSHIP_ENTRY = { role: 'Technical Head', organization: 'SEDS CUSAT', description: 'Led the avionics subsystem team.' };

describe('RC6 behavioral: leadership content surfaces for an org-NAMED question with no category keyword', () => {
  test('"Tell me about your role at SEDS CUSAT." (no "leadership"/"led"/"managed" keyword) surfaces the leadership entry, not a denial', async () => {
    const o = makeOrchestrator(resumeWithLeadership([LEADERSHIP_ENTRY]));
    const result = await o.processQuestion('Tell me about your role at SEDS CUSAT.');
    assert.ok(result, 'processQuestion must return a result, not null');
    const block = result.contextBlock || '';
    assert.match(block, /SEDS CUSAT/, 'the org must appear in the assembled context — this is the exact RC6 real-session repro');
    assert.match(block, /Technical Head/, 'the role must appear alongside the org');
  });

  test('the SAME question with NO leadership entries on the resume does not fabricate one (negative control)', async () => {
    const o = makeOrchestrator(resumeWithLeadership([]));
    const result = await o.processQuestion('Tell me about your role at SEDS CUSAT.');
    const block = result?.contextBlock || '';
    assert.doesNotMatch(block, /Technical Head/, 'no leadership entry exists — nothing should be fabricated');
  });

  test('a question using the "leadership" keyword directly also surfaces the entry (the pre-existing, always-worked path)', async () => {
    const o = makeOrchestrator(resumeWithLeadership([LEADERSHIP_ENTRY]));
    const result = await o.processQuestion('What leadership experience do you have?');
    const block = result?.contextBlock || '';
    assert.match(block, /SEDS CUSAT/);
  });
});

describe('RC6 behavioral: org matching is dynamic — a DIFFERENT resume\'s org still matches by name, no hardcoding', () => {
  test('a completely different, synthetic org name (not SEDS/TEDx) still surfaces via the same mechanism', async () => {
    const entry = { role: 'President', organization: 'Quantum Robotics Guild', description: 'Ran weekly build sessions.' };
    const o = makeOrchestrator(resumeWithLeadership([entry]));
    const result = await o.processQuestion('What did you do for Quantum Robotics Guild?');
    const block = result?.contextBlock || '';
    assert.match(block, /Quantum Robotics Guild/, 'org matching must be dynamic (from the resume itself), not a hardcoded SEDS/TEDx-only pattern');
    assert.match(block, /President/);
  });

  test('a candidate-directed question naming an org NOT on the resume still surfaces the real leadership entry — via buildExperienceFallbackPack\'s deliberate defensive seeding, not an org-match false positive', async () => {
    // Initially expected this to prove "no false match" — it does not. The
    // real, documented behavior (the original source-pinned test's third
    // assertion: "buildExperienceFallbackPack seeds leadership so a
    // zero-keyword org question still grounds") is that the FALLBACK pack
    // deliberately seeds leadership content for ANY candidate-directed
    // question with otherwise-thin structured-pack results, specifically to
    // prevent a fabricated denial — it is not scoped to matching the named
    // org. This is a genuine, intentional safety-net design, not a bug: the
    // system errs on the side of surfacing real leadership content rather
    // than risking another RC6-shaped fabrication.
    const o = makeOrchestrator(resumeWithLeadership([LEADERSHIP_ENTRY]));
    const result = await o.processQuestion('What did you do for the Debate Society?');
    const block = result?.contextBlock || '';
    assert.match(block, /Technical Head/, 'the fallback pack seeds real leadership content defensively, regardless of the specific org named');
  });
});
