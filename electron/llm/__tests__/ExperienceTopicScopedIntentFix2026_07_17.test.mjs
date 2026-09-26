// electron/llm/__tests__/ExperienceTopicScopedIntentFix2026_07_17.test.mjs
//
// Campaign 2 (longsession, 2026-07-17): script-a press A11 ("What's your
// experience mentoring engineers?") got only ~95 chars of candidate context
// in the live [TRACE:LONGCTX] prompt_assembled trace — a compact identity
// block, not the résumé's actual mentoring bullet ("Mentored 4 engineers
// through promotion to senior; authored the team's distributed-systems
// interview rubric...").
//
// Root cause: IntelligenceEngine.ts's toCandidateFraming() rewrites "your" →
// "my" before the question reaches premium/electron/knowledge/
// IntentClassifier.ts ("what's YOUR experience mentoring engineers?" becomes
// "what's MY experience mentoring engineers?"). IDENTITY_DIRECT_PATTERNS
// contains the bare substring "what's my experience" (meant for a truly bare
// identity lookup like "what's my experience?" / "how much experience do you
// have?"), and classifyIntentBody's `q.includes(p)` substring match fired on
// it even with "mentoring engineers?" appended — forcing IntentType.INTRO,
// which triggers KnowledgeOrchestrator's "Direct Identity Fact match" fast
// path (~95-char compact identity block) instead of PROFILE_DETAIL's full
// résumé-detail retrieval.
//
// Fix: a new EXPERIENCE_TOPIC_SCOPED_RE disqualifier (mirroring the existing
// isCompanyIdentityPattern JD_ROLE_FRAME_RE guard for 'what company') detects
// when the experience/background bare patterns are followed by a concrete
// topic word (mentoring/leading/a skill/domain via in/with/on/for/at/as) and
// skips the INTRO fast path for those — letting the question fall through to
// PROFILE_DETAIL's normal scoring instead.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { classifyIntentWithContext } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/IntentClassifier.js')).href
);

const c = (q) => classifyIntentWithContext(q, {});

describe('experience/background patterns disqualify from INTRO when topic-scoped', () => {
  test('the exact live-failing question (post toCandidateFraming rewrite) is NOT intro', () => {
    assert.notEqual(c("understood, thanks for sharing. let's go back to technical topics — what's my experience mentoring engineers?"), 'intro');
  });

  test('"what\'s my experience mentoring engineers?" routes to profile_detail', () => {
    assert.equal(c("what's my experience mentoring engineers?"), 'profile_detail');
  });

  test('"what is my background in machine learning?" is NOT intro (topic-scoped)', () => {
    assert.notEqual(c('what is my background in machine learning?'), 'intro');
  });

  test('a genuinely BARE experience lookup still routes to intro (regression guard)', () => {
    assert.equal(c("what's my experience"), 'intro');
    assert.equal(c('what is my background?'), 'intro');
    assert.equal(c('how much experience?'), 'intro');
  });

  test('other bare identity patterns are untouched (name/role/company)', () => {
    assert.equal(c('what is my name?'), 'intro');
    assert.equal(c('what company do you work for?'), 'intro');
  });
});
