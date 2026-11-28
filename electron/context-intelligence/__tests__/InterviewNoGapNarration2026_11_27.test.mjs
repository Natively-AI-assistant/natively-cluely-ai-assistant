// Interview answers never narrate what the résumé leaves out (2026-11-27, owner decision (b)).
//
// Autopilot baseline (deepseek-flash via the Natively API, 3 résumés × 3 JDs): with the résumé loaded the candidate said
// "The résumé doesn't say why I built it", "the exact threshold isn't documented in what I have in front of me, so I'd
// rather pull the runbook", "I don't have the root cause written down". Three prompt lines asked for exactly that in the
// interview modes: the USER_MOTIVATION grounding ("say so explicitly before offering any rationale"), the exact-value
// section ("the exact base isn't in my notes") and nothing on follow-ups that ask past the record. The owner's rule:
// answer around a missing fact with general knowledge, no disclaimer, no invented personal facts.
// String work only: no platform branches, same on macOS and Windows.
//
// Run: npm run build:electron && node --test electron/context-intelligence/__tests__/InterviewNoGapNarration2026_11_27.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { decide } = await load('orchestration/orchestrator.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { adaptLegacyChunks } = await load('retrieval/legacy-adapter.js');

const ADAPT = {
  scope: { userId: 'u1' },
  sourceTypes: new Map([['resume-1', 'RESUME']]),
  activeVersions: new Map([['resume-1', 'v1']]),
  chunkVersions: new Map([['resume-1', 'v1']]),
  assumeInScopeWhenUnknown: true,
};
const evidence = adaptLegacyChunks([{ sourceId: 'resume-1', chunkIndex: 0, score: 0.9, text: 'Led the RabbitMQ to Kafka migration for order events: six weeks of dual publishing, zero lost orders. Led the postmortem for a consumer-lag spike that delayed confirmation emails by 47 minutes.' }], ADAPT).evidence;
const compose = (modeId, q) => composePrompt({
  decision: decide({ requestId: 'r', requestSequence: 1, surface: 'what_to_answer', modeId, scope: { userId: 'u1' }, sessionId: 's', manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: ['resume.md'] }),
  policy: MODE_POLICIES[modeId], evidence, heardQuestion: true,
});
const all = (c) => `${c.system}\n${c.user}`;
// The permanent reason rule still says "state plainly that it does not give the reason" for a question about what a
// document says; that branch is right and stays.
const NARRATION = /say so explicitly before offering|isn't in my notes/;

describe('job modes: no instruction to narrate a missing reason, figure or detail', () => {
  for (const modeId of ['technical-interview', 'looking-for-work']) {
    test(`${modeId}: motivation question gets the merit-of-the-choice guidance`, () => {
      const c = compose(modeId, 'Why did you decide to migrate from RabbitMQ to Kafka?');
      const text = all(c);
      if (c.sections.includes('grounding') && /REASON or motivation/.test(text)) {
        assert.match(text, /give the merit of the choice itself/);
        assert.match(text, /never say\s+the reason is not written down/);
      }
      assert.doesNotMatch(text, /say so explicitly before offering any rationale/);
    });
    test(`${modeId}: exact-value ask never tells the model to mention its notes`, () => {
      const c = compose(modeId, 'What exactly was the consumer-lag alert threshold?');
      assert.ok(c.sections.includes('exact_value'), c.sections.join(','));
      const text = all(c);
      assert.match(text, /Never supply a plausible-sounding constant/);
      assert.match(text, /never mention notes, documents or the résumé/);
      assert.doesNotMatch(text, /isn't in my notes/);
    });
    test(`${modeId}: a follow-up past the record gets the stated-facts-then-method line`, () => {
      const c = compose(modeId, 'Tell me about the postmortem you led. What was the root cause?');
      if (c.sections.includes('evidence_story')) {
        const text = all(c);
        assert.match(text, /give the stated facts first, then\s+answer the rest as method/);
        assert.match(text, /Add no event, finding, number, person, tool or anecdote/);
      }
    });
  }
});

describe('other modes keep their existing wording', () => {
  for (const modeId of ['general', 'team-meet', 'sales']) {
    test(`${modeId}: exact-value section keeps the short-clause line`, () => {
      const c = compose(modeId, 'What exactly was the consumer-lag alert threshold?');
      if (c.sections.includes('exact_value')) assert.match(all(c), /isn't in my notes/);
      assert.doesNotMatch(all(c), /give the stated facts first, then\s+answer the rest as method/);
    });
  }
});

test('the new lines name no benchmark person, employer or project', () => {
  for (const modeId of ['technical-interview', 'looking-for-work']) {
    for (const q of ['Why did you decide that?', 'What exactly was the threshold?', 'How did you verify it worked?']) {
      const text = all(compose(modeId, q));
      assert.doesNotMatch(text.replace(/RabbitMQ|Kafka|47 minutes|consumer-lag|order events|confirmation emails|postmortem|dual publishing|zero lost orders/g, ''), /Floodgate|Brindle|Tessa|Marcus|Anton|focusfence|Tidewell|Haulwise|Pennant|Calyx/);
      assert.doesNotMatch(text, NARRATION);
    }
  }
});

describe('typed job-mode asks about the user\'s own logistics get options, not an invented answer', async () => {
  const { personalCommitmentNotice, TYPED_COMMITMENT_NOTICE } = await load('generation/prompt-composer.js');
  for (const q of [
    "recruiter asked if I'm authorized to work in the US. not on my resume. what's a clean answer?",
    'she asked current comp + notice, neither on my resume. what do I say',
    'what should I say for salary expectations',
    'he asked if I have other offers, help',
  ]) {
    test(q, () => {
      for (const mode of ['looking-for-work', 'technical-interview']) assert.equal(personalCommitmentNotice(q, mode, false), TYPED_COMMITMENT_NOTICE, mode);
    });
  }
  test('not outside the job modes, and not for an ordinary typed question', () => {
    assert.equal(personalCommitmentNotice('what should I say for salary expectations', 'general', false), '');
    assert.equal(personalCommitmentNotice('explain consistent hashing', 'technical-interview', false), '');
  });
  test('the notice never names a benchmark person or company', () => {
    assert.doesNotMatch(TYPED_COMMITMENT_NOTICE, /Brindle|Haulwise|Pennant|Calyx|Marcus|Tessa|Anton/);
  });
});

describe('job-search status is a commitment question in the job modes only', async () => {
  const { personalCommitmentNotice } = await load('generation/prompt-composer.js');
  const own = /asks for the user's own preference, commitment or reason/;
  test('heard in Looking for work and Technical Interview', () => {
    for (const q of ['Are you interviewing anywhere else right now?', 'Do you have other offers I should know about?', 'Are you talking to other companies?']) {
      for (const mode of ['looking-for-work', 'technical-interview']) assert.match(personalCommitmentNotice(q, mode, true), own, `${mode}: ${q}`);
    }
  });
  test('work authorisation and visas, but not a payments question about Visa', () => {
    for (const q of ["We can't sponsor visas. Will that be an issue for you, now or later?", 'Are you authorized to work in the US?', 'Will you need sponsorship?']) {
      assert.match(personalCommitmentNotice(q, 'looking-for-work', true), own, q);
    }
    assert.equal(personalCommitmentNotice('How does a Visa authorization hold work on a card payment?', 'technical-interview', true), '');
    assert.equal(personalCommitmentNotice('Did you notice the latency spike after the deploy? What would you check first?', 'technical-interview', true), '');
  });
  test('a Sales prospect asking for other offers (discounts) gets no notice', () => {
    assert.equal(personalCommitmentNotice('Do you have any other offers running this month?', 'sales', true), '');
    assert.equal(personalCommitmentNotice('Do you have any other offers?', 'call-center', true), '');
  });
});

// Cycle 1 (2026-11-27): a JD's "must already be authorized; no sponsorship" came back as the user's own status, and
// the saved-answer sentence must stay in the job modes only (the other modes' prompts are byte-identical to main).
const { personalCommitmentNotice, TYPED_COMMITMENT_NOTICE } = await load('generation/prompt-composer.js');
describe('commitment notices: JD requirements are not the user\'s status; job modes only', () => {
  for (const modeId of ['technical-interview', 'looking-for-work']) {
    test(`${modeId}: heard and typed notices say a JD requirement is never the user's status`, () => {
      const heard = personalCommitmentNotice('Are you authorized to work in the US?', modeId, true);
      assert.match(heard, /never the user's own status or answer/);
      assert.match(heard, /say that answer as written/);
      assert.equal(personalCommitmentNotice('recruiter asked if I need sponsorship, what do I say', modeId, false), TYPED_COMMITMENT_NOTICE);
      assert.match(TYPED_COMMITMENT_NOTICE, /never the user's own status or answer/);
    });
  }
  for (const modeId of ['sales', 'team-meet', 'general', 'seminar', 'call-center']) {
    test(`${modeId}: heard commitment notice is unchanged (no job-mode sentences)`, () => {
      const n = personalCommitmentNotice('Would you relocate?', modeId, true);
      assert.ok(n, 'notice still applies');
      assert.doesNotMatch(n, /say that answer as written|never the user's own status/);
      assert.match(n, /may be acknowledged\.\)$/);
    });
  }
});

// Review of PR #825 (2026-11-28): the typed notice reached transcript surfaces (Assist, Code hint), and in Technical
// Interview the commitment patterns matched technical wording. String work only: same on macOS and Windows.
describe('the typed notice is for questions the user typed, about themselves', async () => {
  const { personalCommitmentNotice, TYPED_COMMITMENT_NOTICE } = await load('generation/prompt-composer.js');
  const own = /asks for the user's own preference, commitment or reason/;
  test('not on a surface that is neither heard nor typed (Assist, Code hint, Recap)', () => {
    for (const mode of ['looking-for-work', 'technical-interview']) {
      assert.equal(personalCommitmentNotice('what are your salary expectations?', mode, false, false, false), '', mode);
      assert.equal(personalCommitmentNotice('she asked current comp + notice, neither on my resume. what do I say', mode, false, false, false), '', mode);
    }
  });
  test('typed technical questions in Technical Interview get no notice', () => {
    for (const q of ['Explain hybrid search versus pure vector search', 'How does a remote procedure call differ from REST?',
      'traveling salesman with bitmask DP', 'design a hybrid cloud failover, bullets']) {
      assert.equal(personalCommitmentNotice(q, 'technical-interview', false), '', q);
    }
    assert.equal(personalCommitmentNotice('what notice period did I put in my notes?', 'technical-interview', false), TYPED_COMMITMENT_NOTICE);
  });
  test('heard: a technical "current base" is not a pay question; "your current base" is', () => {
    assert.equal(personalCommitmentNotice('What is the current base case of this recursion?', 'technical-interview', true), '');
    assert.match(personalCommitmentNotice("What's your current base right now?", 'technical-interview', true), own);
    assert.match(personalCommitmentNotice('What is the current base case of this recursion?', 'looking-for-work', true), own, 'Looking for work keeps the judged gate');
  });
  test('the bridge marks only manual chat as typed', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/context-intelligence/orchestration/engine-bridge.ts'), 'utf8');
    assert.match(src, /typedByUser: input\.surface === 'manual-chat',/);
  });
});
