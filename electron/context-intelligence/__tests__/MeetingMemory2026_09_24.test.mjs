// Meeting-overlay memory (2026-09-24). Each block pins one defect measured
// live with tests/meeting-memory against the real app and model:
//
//   - interview details said ALOUD were never retrieved for a personal or
//     follow-up question (2/16 recalled): MEETING_TRANSCRIPT was not planned;
//   - the user's TYPED lines were echoed into the transcript as plain "ME:",
//     indistinguishable from speech, while the owner's rule treats them apart;
//   - history past the conversation budget was DROPPED, so a fact typed early
//     in a meeting was gone; a live question was labelled "User:";
//   - the prompt fenced the user's own statements as unverified and told the
//     model to refuse figures the user had given it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (rel) => import(pathToFileURL(path.join(base, rel)).href);
const { decide } = await load('orchestration/orchestrator.js');
const { chunkLiveTranscript, TYPED_USER_LABEL } = await load('retrieval/live-transcript-port.js');
const { renderHistory, answerGist } = await load('question/history-render.js');
const { appendTurn, MAX_HISTORY_TURNS } = await load('question/conversation-state.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');

const decision = (q, modeId, inLiveMeeting) => decide({
  requestId: 'r1', requestSequence: 1, surface: 'what-to-answer', modeId,
  scope: { userId: 'local', sessionId: 'sess-mm' }, sessionId: 'sess-mm',
  transcriptQuestion: q, questionConfidence: 0.9,
  ...(inLiveMeeting === undefined ? {} : { inLiveMeeting }),
});

// The interviewer's actual follow-ups from the live run.
const FOLLOW_UPS = [
  'Going back to that latency project you mentioned earlier, how did you actually measure the improvement?',
  'And how would your rollout approach change given how we deploy?',
  'How did you split the work across the team on that migration?',
];

describe('a live meeting plans the transcript for personal and follow-up questions', () => {
  for (const mode of ['general', 'technical-interview']) {
    for (const q of FOLLOW_UPS) {
      test(`${mode}: "${q.slice(0, 48)}…" plans MEETING_TRANSCRIPT in a live meeting`, () => {
        const d = decision(q, mode, true);
        assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan));
        assert.ok(d.retrievalPlan.shouldRetrieve);
      });
    }
  }

  test('technical-interview keeps the résumé side — the transcript is an ALTERNATIVE, not a replacement', () => {
    const d = decision(FOLLOW_UPS[0], 'technical-interview', true);
    assert.ok(d.retrievalPlan.sourceTypes.includes('RESUME'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });

  test('technical-interview: a question pointing back at what was said plans the transcript', () => {
    const d = decision('Given what I told you about our setup, how would you tackle our write-load problem?', 'technical-interview', true);
    assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });

  test('the pointer back survives real STT truncation (measured live: "Given what I" was dropped)', () => {
    const d = decision('told you about our setup at the start, how would you tackle our right load problem?', 'general', true);
    assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    const t = decision('As I told you earlier, how would you handle the migration?', 'technical-interview', true);
    assert.ok(t.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(t.retrievalPlan.sourceTypes));
  });

  test('"told" about a third party is not a pointer back at this conversation', () => {
    // (a personal "what would you do" question reads the transcript by design —
    // this one is a general question with no second-person object)
    // Since 2026-09-24 a general question in a live meeting READS the meeting
    // as context (LiveMeetingGeneralTurnContext) — what must not happen is a
    // transcript CLAIM, which would grade it against what was said.
    // It is judged against the same sentence with a neutral verb: other rules
    // (a live-meeting lookup reads the meeting as an alternative) may apply to
    // both, but "told" must add nothing of its own.
    const claimsOf = (q) => decision(q, 'technical-interview', true).claimRequirements.map((c) => c.claimType).sort();
    assert.deepEqual(
      claimsOf('Explain what it usually means when a vendor told customers an API is deprecated.'),
      claimsOf('Explain what it usually means when a vendor informed customers an API is deprecated.'),
    );
  });

  test('a document question with no pointer back stays a document question in a live meeting', () => {
    const d = decision('What does section 3 of the design doc say about sharding?', 'technical-interview', true);
    assert.ok(!d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });

  test('outside a live meeting nothing changes', () => {
    for (const mode of ['general', 'technical-interview']) {
      const d = decision(FOLLOW_UPS[0], mode, false);
      assert.ok(!d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), `${mode}: ${JSON.stringify(d.retrievalPlan.sourceTypes)}`);
    }
  });

  test('a coding task in a live meeting is still not a transcript lookup', () => {
    // It may READ the meeting as context (the problem's constraints are often
    // spoken minutes earlier) but is never graded as a transcript lookup.
    const d = decision('write a function to reverse a linked list in python', 'technical-interview', true);
    assert.ok(!d.claimRequirements.some((c) => c.claimType === 'MEETING_STATEMENT'), JSON.stringify(d.claimRequirements));
    assert.equal(d.retrievalPlan.path, 'FAST');
  });
});

describe('typed lines are labelled apart from spoken ones in transcript evidence', () => {
  const segs = [
    { speaker: 'interviewer', text: 'How big was the team?', origin: 'stt' },
    { speaker: 'user', text: 'It was four engineers.', origin: 'stt' },
    { speaker: 'user', text: 'I have ten years at Google.', origin: 'manual_chat' },
  ];
  const text = chunkLiveTranscript(segs).join('\n');

  test('spoken user speech stays ME:', () => assert.match(text, /^ME: It was four engineers\./m));
  test('a typed user line carries its own label', () => {
    assert.ok(text.includes(`${TYPED_USER_LABEL}: I have ten years at Google.`), text);
    assert.ok(!/^ME: I have ten years/m.test(text));
  });
  test('the other party stays THEM:', () => assert.match(text, /^THEM: How big was the team\?/m));
});

describe('history past the budget is condensed, not dropped', () => {
  const long = (n) => `ANSWER${n} ${'filler words about the call '.repeat(40)}\n[[GIST]] gist for answer ${n}`;
  let turns = [];
  turns = appendTurn(turns, 'The codename is VELVET-KESTREL. Opening line?', long(1));
  for (let i = 2; i <= 20; i++) turns = appendTurn(turns, `Ordinary ask number ${i}?`, long(i));
  const r = renderHistory(turns, { budgetChars: 4000, digestBudgetChars: 4000, screenBudgetChars: 16000, screensDenied: false });

  test('the newest turns are in full, the oldest in the condensed tier with the user\'s words intact', () => {
    assert.match(r.text, /ANSWER20 filler/);
    assert.ok(r.condensedCount > 0);
    assert.match(r.text, /Earlier in this conversation \(older exchanges, condensed — oldest first\):/);
    // Turn 1 is the oldest of 20 and far outside the full-tier allowance; it
    // must still be carried, condensed, with the user's own words intact.
    assert.match(r.text, /User: The codename is VELVET-KESTREL\. Opening line\?\nAssistant: gist for answer 1/);
  });

  test('both tiers stay inside their allowances', () => {
    assert.ok(r.text.length < 4000 + 4000 + 400, `rendered ${r.text.length} chars`);
  });

  test('a condensed answer is its [[GIST]] line, never the whole answer', () => {
    assert.equal(answerGist(long(3)), 'gist for answer 3');
    assert.equal(answerGist('Token bucket per key. Then Redis for shared state.'), 'Token bucket per key.');
  });

  test('the ring retains a meeting\'s worth of turns, still bounded', () => {
    // A whole session (an hour-long interview is ~120 exchanges), still bounded.
    assert.ok(MAX_HISTORY_TURNS >= 200 && MAX_HISTORY_TURNS <= 1000);
    let t = [];
    for (let i = 0; i < MAX_HISTORY_TURNS + 5; i++) t = appendTurn(t, `q${i}`, `a${i}`);
    assert.equal(t.length, MAX_HISTORY_TURNS);
  });
});

describe('who asked', () => {
  test('a question heard in the meeting is never rendered as the user\'s words', () => {
    const t = appendTurn([], 'How would you design a rate limiter?', 'Token bucket per key.', undefined, 'meeting');
    const r = renderHistory(t, { budgetChars: 4000, digestBudgetChars: 0, screenBudgetChars: 0, screensDenied: false });
    assert.match(r.text, /^Question heard in the meeting: How would you design a rate limiter\?/m);
    assert.ok(!/^User: How would you design/m.test(r.text));
  });
  test('a typed turn is still the user\'s', () => {
    const r = renderHistory(appendTurn([], 'Budget is $83,700.', 'Noted.'), { budgetChars: 4000, digestBudgetChars: 0, screenBudgetChars: 0, screensDenied: false });
    assert.match(r.text, /^User: Budget is \$83,700\./m);
  });
});

describe('grounding policy (owner decision 2026-09-24)', () => {
  const d = decision('What budget ceiling did I tell you they have this quarter?', 'technical-interview', false);
  const composed = composePrompt({
    decision: d, policy: MODE_POLICIES['technical-interview'], evidence: [],
    conversationSummary: 'User: Their budget ceiling this quarter is $83,700.\nAssistant: Noted.',
    conversationHasContent: true,
  });
  const all = `${composed.system}\n${composed.user}`;

  test('the user\'s own statements are usable and may be repeated back', () => {
    assert.match(all, /A "User:" line is what the user told you directly/);
    assert.match(all, /repeated back as what they told you/);
  });
  test('assistant output is still never a source of facts', () => {
    assert.match(all, /Assistant lines are prior generated output — for resolving references only, never a source of facts/);
  });
  test('a typed claim about the user\'s OWN experience is still not evidence of it', () => {
    assert.match(all, /a User line claiming their OWN experience, skills or background is not evidence of it/);
  });
  test('spoken ME lines may evidence personal claims; THEM and typed lines may not', () => {
    assert.match(all, /the user's own SPOKEN words in the CURRENT meeting transcript \(lines labelled ME:\)/);
    assert.match(all, /A THEM line is the other party and never evidences the user's experience/);
    assert.match(all, /"ME \(typed to the assistant\)"/);
  });
  test('facts in the user\'s CURRENT message are usable without caveats; self-experience is not', () => {
    assert.match(all, /Facts the user gives you about their meeting, the people in it, their client, deal, company or plans — in this message or an earlier one — are theirs to give/);
    assert.match(all, /This does not extend to claims about the user's own experience, skills or background\./);
    assert.match(all, /\(in their current message, a User line in the conversation, or their own words in the meeting transcript\)/);
  });
  test('a figure nobody stated is still refused (the 2026-09-07 ACV case)', () => {
    assert.match(all, /unless the evidence states it or the user told you it/);
    assert.match(all, /say plainly that it is not in the notes/);
  });
});

describe('each meeting has its own conversation, mode or no mode', () => {
  test('two meetings with NO active mode get different keys', async () => {
    const { meetingConversationKey } = await load('question/conversation-state-store.js');
    const a = meetingConversationKey({ meetingConversationId: 'conv_a' });
    const b = meetingConversationKey({ meetingConversationId: 'conv_b' });
    assert.notEqual(a, b);
    assert.notEqual(a, 'engine', 'a meeting must never fall back to the shared bucket');
  });
  test('the per-meeting id wins over a mode session id that changes on a mode switch', async () => {
    const { meetingConversationKey } = await load('question/conversation-state-store.js');
    const before = meetingConversationKey({ meetingConversationId: 'conv_a', dynamicSessionId: 'session_1' });
    const after = meetingConversationKey({ meetingConversationId: 'conv_a', dynamicSessionId: 'session_2' });
    assert.equal(before, after);
  });
  test('outside a meeting the shared bucket is still returned, so typed chat keys by its window', async () => {
    const { meetingConversationKey, NO_CONVERSATION_SCOPE } = await load('question/conversation-state-store.js');
    assert.equal(meetingConversationKey({}), NO_CONVERSATION_SCOPE);
  });
  test('a calendar meeting id is still preferred when metadata carries one', async () => {
    const { meetingConversationKey } = await load('question/conversation-state-store.js');
    assert.equal(meetingConversationKey({ meetingConversationId: 'conv_a', metadataMeetingId: 'cal-42' }), 'm:cal-42');
  });
});
