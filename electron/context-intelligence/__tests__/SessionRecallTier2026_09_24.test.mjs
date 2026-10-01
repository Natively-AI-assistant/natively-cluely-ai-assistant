// A follow-up about ANY earlier exchange of the session reaches the prompt
// (2026-09-24).
//
// The meeting index holds speech only. Typed chat, manual questions, what-to-
// answer suggestions and screenshot analyses live in the conversation ring,
// which kept 40 turns — about 15-20 minutes of an interview — and rendered only
// the newest few in full (screen text only there). The ring now keeps the
// session and renderHistory's RECALL tier brings back, in full, the older
// exchanges the current question is about.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (rel) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence', rel)).href);
const { renderHistory, rankRelatedTurns } = await load('question/history-render.js');
const { appendTurn, MAX_HISTORY_TURNS } = await load('question/conversation-state.js');

const SCREEN = 'CI Build #4471 FAILED. reconcileLedgerV3() raised ERR-7Q41: balance drift 0.0031 on shard kestrel-09, at ledger/sync.go:88.';
const FILLER = ['What is a mutex?', 'How does a B-tree index speed up a query?', 'What is MVCC?', 'Explain the CAP theorem.',
  'What is consistent hashing?', 'What is a write-ahead log?', 'How does TCP differ from UDP?', 'What is a deadlock?',
  'What is sharding?', 'How does a CDN work?', 'What is a bloom filter?', 'What is a circuit breaker?'];

/** A session: five early exchanges of every kind, then `n` unrelated ones. */
function session(n) {
  let t = [];
  t = appendTurn(t, 'Quick note for later: the recruiter told me the offer band tops out at 212k base.', 'Noted: the band tops out at 212k base.');
  t = appendTurn(t, "What's the error on my screen?", 'The build failed: reconcileLedgerV3() raised ERR-7Q41 on shard kestrel-09.', SCREEN);
  t = appendTurn(t, 'Give me a one-line way to explain backpressure.', 'Backpressure is the consumer telling the producer to slow down. [[GIST]] consumer tells producer to slow down');
  t = appendTurn(t, 'How would you design a URL shortener for our marketing team?', 'A counter encoded in base62, a Postgres table keyed by slug, and Redis in front for hot redirects.', undefined, 'meeting');
  t = appendTurn(t, 'Which algorithm would you use to find the top ten most frequent search terms in a day of logs?', 'Count with a hash map, then keep a min-heap of size ten: O(n log 10).');
  for (let i = 0; i < n; i++) t = appendTurn(t, FILLER[i % FILLER.length], `Answer ${i} about ${FILLER[i % FILLER.length].toLowerCase()} with some detail on trade-offs.`, undefined, i % 2 ? 'meeting' : undefined);
  return t;
}
const opts = (query) => ({ budgetChars: 2400, digestBudgetChars: 2400, screenBudgetChars: 16000, screensDenied: false, query, recallBudgetChars: 4000 });

describe('the ring keeps an hour-long session', () => {
  test('120 exchanges are all retained', () => {
    assert.ok(MAX_HISTORY_TURNS >= 120);
    assert.equal(session(115).length, 120);
  });
});

describe('a follow-up 100+ exchanges later brings the exchange back in full', () => {
  const t = session(110);
  for (const [query, must] of [
    ['What was the error code on the screenshot I showed you earlier?', /ERR-7Q41/],
    ['Which function failed in the build you had up on your screen earlier?', /reconcileLedgerV3/],
    ['What one-liner did you give me for backpressure earlier?', /consumer telling the producer to slow down/],
    ['Going back to the URL shortener you described earlier, what did you say you would use for storage?', /Postgres table keyed by slug/],
    ['Why did you pick that approach for the top ten search terms earlier?', /min-heap of size ten/],
    ['What did I tell you the offer band tops out at?', /212k/],
  ]) {
    test(query, () => {
      const r = renderHistory(t, opts(query));
      assert.match(r.text, must);
      assert.ok(r.recalledCount >= 1);
      assert.match(r.text, /^Earlier in this session, related to this question/m);
    });
  }
  test('the screenshot comes back WITH its screen text, labelled as the screen', () => {
    const r = renderHistory(t, opts('What was the error code on the screenshot I showed you earlier?'));
    assert.match(r.text, /\[screen attached that turn\] CI Build #4471 FAILED/);
    assert.equal(r.carriesScreen, true);
  });
  test('a denied screenshots scope still withholds recalled screen text', () => {
    const r = renderHistory(t, { ...opts('What was the error code on the screenshot I showed you earlier?'), screensDenied: true });
    assert.doesNotMatch(r.text, /\[screen attached that turn\]/);
    assert.equal(r.screenWithheld, true);
  });
});

describe('recall is bounded and quiet when nothing matches', () => {
  const t = session(110);
  test('a question about nothing earlier recalls nothing', () => {
    const r = renderHistory(t, opts('How would you rate your Kotlin?'));
    assert.equal(r.recalledCount, 0);
    assert.doesNotMatch(r.text, /related to this question/);
  });
  test('at most three exchanges, within the allowance', () => {
    const r = renderHistory(t, opts('mutex deadlock sharding bloom filter circuit breaker CDN'));
    assert.ok(r.recalledCount <= 3);
  });
  test('without a query (or allowance) the renderer is unchanged', () => {
    const a = renderHistory(t, { budgetChars: 2400, digestBudgetChars: 2400, screenBudgetChars: 16000, screensDenied: false });
    assert.equal(a.recalledCount, 0);
  });
  test('a recalled exchange is not also carried condensed', () => {
    const short = session(8);
    const r = renderHistory(short, opts('What one-liner did you give me for backpressure earlier?'));
    const n = (r.text.match(/one-line way to explain backpressure/g) ?? []).length;
    assert.equal(n, 1, r.text);
  });
});

describe('fast', () => {
  test('ranking 400 exchanges (with screens) takes a few milliseconds', () => {
    let t = [];
    for (let i = 0; i < 400; i++) t = appendTurn(t, `Question ${i}: ${FILLER[i % FILLER.length]}`, `Answer ${i} `.repeat(60), i % 10 ? undefined : SCREEN.repeat(20));
    rankRelatedTurns(t, 'warm the per-turn term cache');
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) rankRelatedTurns(t, 'What was the error code on the screenshot I showed you earlier?');
    const per = (performance.now() - t0) / 10;
    assert.ok(per < 20, `${per.toFixed(1)} ms per question`);
  });
});

describe('the history header lets the model quote its own earlier answers', () => {
  test('"what did you suggest" is answered from the Assistant lines, faithfully', async () => {
    const { composePrompt } = await load('generation/prompt-composer.js');
    const { decide } = await load('orchestration/orchestrator.js');
    const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
    const d = decide({ requestId: 'r', requestSequence: 1, surface: 'manual-chat', modeId: 'general',
      scope: { userId: 'local', sessionId: 's' }, sessionId: 's', manualQuestion: 'What did you suggest I say about my team earlier?' });
    const c = composePrompt({ decision: d, policy: MODE_POLICIES.general, evidence: [],
      conversationSummary: 'Question heard in the meeting: What does your team work on?\nAssistant: I work on the ledger service.' });
    const all = `${c.system}\n${c.user}`;
    // The referent-only rule is kept…
    assert.match(all, /for resolving references only, never a source of facts/);
    // …with the one thing assistant lines ARE a record of.
    assert.match(all, /the record of what YOU said/);
    assert.match(all, /not from what was later said aloud in the meeting/);
    assert.match(all, /if they did not specify something, say so/);
  });
});

describe('a heard question says whose "I" it is', () => {
  test('what-to-answer: "did I say… our team" is the speaker\'s; typed chat is unchanged', async () => {
    const { composePrompt } = await load('generation/prompt-composer.js');
    const { decide } = await load('orchestration/orchestrator.js');
    const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
    const q = 'How many engineers did I say are on our team?';
    const base = { requestId: 'r', requestSequence: 1, modeId: 'general', scope: { userId: 'local', sessionId: 's' }, sessionId: 's', questionConfidence: 0.9 };
    const wta = composePrompt({ decision: decide({ ...base, surface: 'what-to-answer', transcriptQuestion: q }), policy: MODE_POLICIES.general, evidence: [], heardQuestion: true });
    assert.match(wta.user, /# Question\nHow many engineers did I say are on our team\?\n\(Asked aloud by the other person in the meeting: in it, "I", "me", "my", "we" and "our" mean that speaker/);
    const typed = composePrompt({ decision: decide({ ...base, surface: 'manual-chat', manualQuestion: q }), policy: MODE_POLICIES.general, evidence: [] });
    assert.doesNotMatch(typed.user, /Asked aloud by the other person/);
  });
});
