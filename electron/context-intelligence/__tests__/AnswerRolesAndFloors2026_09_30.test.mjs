// Roles and floors (2026-09-30).
//
// 1. Every mode's transcript labelled the other side THEM / INTERVIEWER, and the
//    heard-question note said "the other person", so in Recruiting a
//    candidate's "what does growth look like here?" read as the interviewer's
//    own question. The note now names who spoke in each mode.
// 2. When what-to-answer picks the USER's own newer spoken line, that line got
//    the heard-question note ("we" = the other speaker). It now gets its own.
// 3. The "give the value plainly first" rule listed "a floor" and outranked the
//    Sales / Looking-for-work confidentiality lines (owner decision: floors are
//    never stated).
// 4. Recruiting had no branch for the candidate asking the recruiter; Call
//    Center stated an escalation path the context never gave.
//
// Platform: pure string composition — identical on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const ci = path.join(base, 'context-intelligence');
const composer = await import(pathToFileURL(path.join(ci, 'generation/prompt-composer.js')).href);
const { decide } = await import(pathToFileURL(path.join(ci, 'orchestration/orchestrator.js')).href);
const { MODE_POLICIES, MODE_IDS } = await import(pathToFileURL(path.join(ci, 'policies/mode-policy-registry.js')).href);
const v2 = await import(pathToFileURL(path.join(base, 'llm/promptSystemV2.js')).href);

const heard = (q, modeId) => decide({
  requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId,
  scope: { userId: 'u1', sessionId: 's' }, sessionId: 's', transcriptQuestion: q,
});
const compose = (d, modeId, extra = {}) => composer.composePrompt({
  decision: d, policy: MODE_POLICIES[modeId], evidence: [], attachedSourceCount: 0, profileSourceCount: 0, ...extra,
});

describe('heard-question perspective names the speaker per mode', () => {
  const expected = {
    recruiting: 'the candidate', sales: 'the prospect', 'call-center': 'the customer',
    'looking-for-work': 'the interviewer', 'technical-interview': 'the interviewer',
    seminar: 'an examiner or audience member', 'team-meet': 'a colleague in the meeting', lecture: 'the lecturer',
  };
  for (const id of MODE_IDS) {
    test(id, () => {
      const p = compose(heard('What does growth look like for this role?', id), id, { heardQuestion: true });
      if (expected[id]) {
        assert.ok(p.user.includes(`Said aloud by ${expected[id]}, not by the user`), p.user.slice(0, 400));
        assert.ok(!p.user.includes(composer.HEARD_QUESTION_PERSPECTIVE));
      } else {
        // general (and any unknown id) keep the neutral wording
        assert.ok(p.user.includes(composer.HEARD_QUESTION_PERSPECTIVE));
      }
    });
  }
  test('recruiting names the recruiter as the user', () => {
    assert.match(composer.heardQuestionPerspective('recruiting'), /"you" and "your" mean the recruiter/);
  });
  test('unknown ids fall back to the neutral note', () => {
    assert.equal(composer.heardQuestionPerspective('nope'), composer.HEARD_QUESTION_PERSPECTIVE);
    assert.equal(composer.heardQuestionPerspective(undefined), composer.HEARD_QUESTION_PERSPECTIVE);
  });
});

describe("the user's own spoken question", () => {
  test('gets the user note, never the heard note', () => {
    const p = compose(heard('what are we actually scoring on and what weights', 'recruiting'), 'recruiting', { questionSpokenByUser: true });
    assert.ok(p.user.includes(composer.USER_SPOKEN_QUESTION_PERSPECTIVE));
    assert.ok(!p.user.includes('Said aloud by the candidate'));
  });
  test('the bridge maps questionSpeaker to the composer flags', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/context-intelligence/orchestration/engine-bridge.ts'), 'utf8');
    assert.match(src, /heardQuestion: input\.surface === 'what-to-answer' && input\.questionSpeaker !== 'user'/);
    assert.match(src, /questionSpokenByUser: input\.surface === 'what-to-answer' && input\.questionSpeaker === 'user'/);
    const eng = fs.readFileSync(path.resolve(process.cwd(), 'electron/IntelligenceEngine.ts'), 'utf8');
    assert.match(eng, /questionSpeaker: questionSpokenByUser && !question\?\.trim\(\) \? 'user' : 'other'/);
  });
});

describe('floors are never stated', () => {
  test('the value rule no longer lists a floor and forbids it', () => {
    const p = compose(heard("What's the lowest you can go?", 'sales'), 'sales', { heardQuestion: true });
    assert.ok(!/a target, a floor/.test(p.system));
    assert.match(p.system, /private floor, walk-away number, lowest acceptable price or BATNA is the exception: never state it/);
  });
});

describe('persona branches', () => {
  test('recruiting answers the candidate\'s question as the recruiter', () => {
    for (const action of ['what_to_say', 'answer']) {
      const p = v2.buildSystemPromptV2({ mode: 'recruiting', action, tier: 'cloud', surface: 'live' });
      assert.match(p, /When the CANDIDATE asks the interviewer something/);
      assert.match(p, /Never turn the candidate's question into a probe/);
    }
  });
  test('call center escalates only as far as the context states', () => {
    const p = v2.buildSystemPromptV2({ mode: 'call-center', action: 'what_to_say', tier: 'cloud', surface: 'live' });
    assert.ok(!p.includes('state the escalation path'));
    assert.match(p, /naming tiers, teams or callback times only when the context states them/);
  });
});
