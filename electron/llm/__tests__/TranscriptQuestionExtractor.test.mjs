// electron/llm/__tests__/TranscriptQuestionExtractor.test.mjs
//
// Production-path tests for the deterministic transcript question extractor.
// Loads the REAL compiled module from dist-electron. No LLM, no fixtures baked
// into production logic — every assertion is derived from the transcript input.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/TranscriptQuestionExtractor.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/transcriptQuestionExtractor.js');
const { extractLatestQuestion, toCandidateFraming } = await import(pathToFileURL(modPath).href);

// Helper: build turns with increasing timestamps.
let _t = 1_000_000;
const turn = (role, text) => ({ role, text, timestamp: (_t += 1000) });

describe('transcript question extractor', () => {
  test('interviewer name question → identity, interviewer speaker', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Hi, can you hear me?'),
      turn('user', 'Yes, I can hear you fine.'),
      turn('interviewer', 'Great. What is your name?'),
    ]);
    assert.equal(r.detectedSpeaker, 'interviewer');
    assert.equal(r.questionType, 'identity');
    assert.match(r.latestQuestion, /your name/i);
    assert.ok(r.confidence >= 0.8);
  });

  test('"Tell me about your projects." → profile_detail (imperative, no question mark)', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Tell me about your projects.'),
    ]);
    assert.equal(r.detectedSpeaker, 'interviewer');
    assert.equal(r.questionType, 'profile_detail');
    assert.equal(r.isFollowUp, false);
    assert.ok(r.confidence >= 0.7);
  });

  test('experience question → profile_detail', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Walk me through your work experience.'),
    ]);
    assert.equal(r.questionType, 'profile_detail');
  });

  test('skills question → profile_detail', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What skills do you bring to this role?'),
    ]);
    assert.equal(r.questionType, 'profile_detail');
  });

  test('"why are you a good fit?" → jd_alignment', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'So why are you a good fit for this role?'),
    ]);
    assert.equal(r.questionType, 'jd_alignment');
  });

  test('salary question → negotiation', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What salary are you expecting?'),
    ]);
    assert.equal(r.questionType, 'negotiation');
  });

  test('behavioral question → behavioral', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Tell me about a time you handled a conflict on your team.'),
    ]);
    assert.equal(r.questionType, 'behavioral');
  });

  test('follow-up "can you explain that in more detail?" → follow_up + target resolved', () => {
    const r = extractLatestQuestion([
      turn('user', 'I built LedgerFlow, an event-sourced ledger.'),
      turn('interviewer', 'Can you explain that in more detail?'),
    ]);
    assert.equal(r.questionType, 'follow_up');
    assert.equal(r.isFollowUp, true);
    assert.equal(r.followUpTarget, 'LedgerFlow', 'should resolve the recently-mentioned project noun');
  });

  // Campaign 2 (longsession, 2026-07-16, forensic-report.md H3): a realistic
  // LONG callback question using an explicit STRONG backward-reference marker
  // ("mentioned earlier") must still be flagged isFollowUp=true even though it
  // is well over the old blanket 14-word cap. Live-proven regression: this
  // exact sentence returned isFollowUp:false pre-fix
  // (traces2/golden-longctx-18.txt).
  test('long callback question with "mentioned earlier" → follow_up regardless of length', () => {
    const r = extractLatestQuestion([
      turn('user', 'One time we had a memory leak in a long-running consumer process that took us three days to trace.'),
      turn('interviewer', 'How did you eventually find the root cause?'),
      turn('user', 'We used heap snapshots and eventually found an unbounded cache that never evicted old entries.'),
      turn('interviewer', 'Going back to the memory leak you mentioned earlier — how long did it take your team to ship the fix after finding the root cause?'),
    ]);
    assert.equal(r.isFollowUp, true, 'a 26-word explicit callback ("mentioned earlier") must still be a follow-up');
    assert.equal(r.questionType, 'follow_up');
  });

  // A long turn that merely CONTAINS a weak marker word ("that") but has no
  // strong backward-reference cue is a fresh, self-contained question — the
  // weak-marker word-cap must still gate normally so this is NOT misclassified
  // as a follow-up.
  test('long fresh question merely containing "that" → NOT a follow-up (weak-marker cap still applies)', () => {
    const r = extractLatestQuestion([
      turn('user', 'I optimized slow queries using EXPLAIN ANALYZE.'),
      turn('interviewer', 'What would you do if a query that scans the whole table starts timing out under production load during a traffic spike?'),
    ]);
    assert.equal(r.isFollowUp, false, 'a long fresh question with only a weak marker word must not be misclassified as a follow-up');
  });

  // Skeptic-pass regression suite (Campaign 2, 2026-07-16): the first draft of
  // STRONG_FOLLOW_UP_MARKERS matched bare "earlier" / "the previous" / an
  // open-object "going back to" ANYWHERE in the sentence, misclassifying
  // common, non-callback interview phrasings as follow-ups — which corrupted
  // downstream grounding lookups (a bogus followUpTarget can overwrite an
  // otherwise-correct identity/technical query) and let small talk escape the
  // SOCIAL_PLEASANTRY confidence down-weight. Each case below is a FRESH,
  // self-contained question that must NOT be classified as a follow-up despite
  // containing one of the narrowed marker words in a non-callback shape.
  describe('STRONG follow-up markers must not false-positive on ordinary phrasing', () => {
    test('"graduated earlier than your cohort" (career timeline, not a callback)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'I noticed on your resume that you graduated earlier than most of your cohort, what made you accelerate your degree and how did that shape your early career choices?'),
      ]);
      assert.equal(r.isFollowUp, false);
    });

    test('"in an earlier role" (candidate\'s own history, not a callback)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'In an earlier role at a startup, how did you handle ambiguous requirements when the product spec kept changing week to week?'),
      ]);
      assert.equal(r.isFollowUp, false);
    });

    test('"come in earlier" (scheduling, not a callback)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'Would you be able to come in earlier in the week for the onsite, say Tuesday instead of Thursday, if the team needed that flexibility?'),
      ]);
      assert.equal(r.isFollowUp, false);
    });

    test('"earlier deployment...canary rollout" (technical concept, not a callback)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'Would you agree that earlier deployment in the pipeline reduces the blast radius of a bad release, and how would you design a canary rollout to take advantage of that?'),
      ]);
      assert.equal(r.isFollowUp, false);
    });

    test('"the previous role you held" (career history noun, not a conversation-shaped noun)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'In the previous role you held before this most recent one, what was your biggest technical challenge and how did you resolve it?'),
      ]);
      assert.equal(r.isFollowUp, false);
    });

    test('"you mentioned...on your resume" (references an uploaded document, not a live prior turn)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'You mentioned remote work experience on your resume, can you tell me more about how you stayed productive and collaborative while working remotely full time?'),
      ]);
      assert.equal(r.isFollowUp, false);
    });

    test('"going back to the office" (RTO policy chat, not a conversational callback)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'If we ask everyone to start going back to the office three days a week, how would that affect your ability to focus on deep technical work?'),
      ]);
      assert.equal(r.isFollowUp, false);
    });

    test('genuine callback still fires: "you mentioned the load balancer outage earlier"', () => {
      const r = extractLatestQuestion([
        turn('user', 'We had a load balancer outage last quarter that took down checkout for twenty minutes.'),
        turn('interviewer', 'You mentioned the load balancer outage earlier, can you walk me through how your team responded in the moment?'),
      ]);
      assert.equal(r.isFollowUp, true, 'an explicit "you mentioned X earlier" callback must still be classified as a follow-up');
    });

    test('social-pleasantry with "earlier" stays low-confidence, not a follow-up', () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'Did you have any trouble finding parking or the building earlier today?'),
      ]);
      assert.equal(r.isFollowUp, false);
      assert.ok(r.confidence < 0.75, 'must stay below the live speculative gate (0.75)');
    });
  });

  test('picks the LATEST interviewer question, not an earlier one', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What is your name?'),
      turn('user', 'Jordan.'),
      turn('interviewer', 'And what are your main projects?'),
    ]);
    assert.match(r.latestQuestion, /projects/i);
    assert.doesNotMatch(r.latestQuestion, /name/i);
  });

  test('noise/greetings before the real question are ignored', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'uh um okay'),
      turn('interviewer', 'yeah yeah right'),
      turn('interviewer', 'So, tell me about your experience.'),
    ]);
    assert.equal(r.questionType, 'profile_detail');
    assert.match(r.latestQuestion, /experience/i);
    assert.ok(r.ignoredTranscriptNoise.length >= 1, 'filler turns should be recorded as ignored noise');
  });

  test('greeting-only interviewer turn is skipped in favor of the real question', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Tell me about your background.'),
      turn('user', '...'),
      turn('interviewer', 'Nice to meet you'),
    ]);
    // "Nice to meet you" is greeting-only → skip back to the background question.
    assert.match(r.latestQuestion, /background/i);
  });

  // Long-session harness campaign2 (2026-07-17): a genuine imperative ask with
  // NO question mark and a non-sentence-initial lead ("one more open-source
  // question — tell me about levee.") does not match QUESTION_MARK or
  // INTERROGATIVE_LEAD (the lead word isn't at position 0). The extractor used
  // to treat this as only a "weak candidate" and keep walking backward for an
  // older, more question-shaped turn — inverting recency. Live-proven on 4 real
  // presses: traces2/harness-script-{a,c}-press-{A12,A15,C11,C14}.txt.
  describe('a genuinely LATEST imperative ask (no "?", no sentence-initial lead) must win over an OLDER "?"-shaped turn', () => {
    test('"one more open-source question — tell me about levee." (real A15 repro)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', "good. let's talk about the jd's soc 2 / fedramp requirement — any experience there?"),
        turn('user', "i've worked adjacent to soc 2 controls at stripe, though not as the primary owner."),
        turn('interviewer', 'one more open-source question — tell me about levee.'),
      ]);
      assert.match(r.latestQuestion, /levee/i);
      assert.doesNotMatch(r.latestQuestion, /fedramp/i);
    });

    test('"let\'s talk education — tell me about your degree and school." (real A12 repro)', () => {
      const r = extractLatestQuestion([
        turn('interviewer', "understood, thanks for sharing. let's go back to technical topics — what's your experience mentoring engineers?"),
        turn('user', 'yes, mentored two junior engineers.'),
        turn('interviewer', "let's talk education — tell me about your degree and school."),
      ]);
      assert.match(r.latestQuestion, /degree/i);
      assert.doesNotMatch(r.latestQuestion, /mentoring/i);
    });
  });

  test('no interviewer turn → unknown speaker, empty question, zero confidence', () => {
    const r = extractLatestQuestion([
      turn('user', 'I think I did well.'),
      turn('assistant', 'You answered clearly.'),
    ]);
    assert.equal(r.detectedSpeaker, 'unknown');
    assert.equal(r.latestQuestion, '');
    assert.equal(r.confidence, 0);
  });

  test('empty input → safe empty result', () => {
    const r = extractLatestQuestion([]);
    assert.equal(r.detectedSpeaker, 'unknown');
    assert.equal(r.confidence, 0);
  });

  test('technical question → technical', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'How does a hash map work internally?'),
    ]);
    assert.equal(r.questionType, 'technical');
  });

  test('relevantTranscriptWindow includes recent turns, labeled', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What are your projects?'),
      turn('user', 'I built three things.'),
    ]);
    assert.match(r.relevantTranscriptWindow, /INTERVIEWER/);
    assert.match(r.relevantTranscriptWindow, /ME/);
  });
});

describe('toCandidateFraming (interviewer 2nd-person → candidate 1st-person)', () => {
  test('"What are your projects?" → "What are my projects?"', () => {
    const out = toCandidateFraming('What are your projects?');
    assert.match(out, /my projects/i);
    assert.doesNotMatch(out, /\byour\b/i);
  });

  test('possessive yours → mine, reflexive yourself → myself (non-idiom)', () => {
    assert.match(toCandidateFraming('Is that work yours?'), /\bmine\b/i);
    // "describe yourself in detail" is not an intro idiom → rewrites reflexive.
    assert.match(toCandidateFraming('Can you walk through what yourself did there?'), /\bmyself\b/i);
  });

  test('intro idioms are PRESERVED (not rewritten) so the orchestrator still routes them to a self-intro', () => {
    // "introduce yourself" / "tell me about yourself" are matched verbatim by the
    // orchestrator's INTRO_PATTERNS; rewriting "yourself"→"myself" would break
    // intro detection and the name would never ground.
    assert.match(toCandidateFraming('Please introduce yourself'), /introduce yourself/i);
    assert.match(toCandidateFraming('Tell me about yourself'), /about yourself/i);
  });

  test('a generic technical question with no pronouns is unchanged', () => {
    const q = 'How does a hash map work internally?';
    assert.equal(toCandidateFraming(q), q);
  });

  test('does not corrupt words that merely contain the letters of pronouns', () => {
    // "your" must match on word boundaries — "yourself" handled separately,
    // but words like "yours truly" or "neighbour" must not be mangled.
    const out = toCandidateFraming('Describe your favourite project');
    assert.match(out, /favourite/); // untouched
    assert.match(out, /my favourite project/i);
  });

  test('follow-up target false-positive guard: sentence-initial fillers are not picked', () => {
    // "So" / "Right" lead the sentences; the real noun is the CamelCase project.
    const r = extractLatestQuestion([
      turn('user', 'So we shipped it. Right, I built RedisMart last year.'),
      turn('interviewer', 'Can you explain that in more detail?'),
    ]);
    assert.equal(r.isFollowUp, true);
    assert.equal(r.followUpTarget, 'RedisMart', 'must skip "So"/"Right" and pick the CamelCase project');
  });

  // E2E MiniMax campaign, F-DETECT (round-13 p08): question-shaped social
  // pleasantries must NOT clear the live speculative gate (0.75) on their own.
  describe('social-pleasantry down-weight (no small-talk misfire)', () => {
    const smalltalk = [
      'By the way, did you have any trouble finding parking around here?',
      'How was your weekend?',
      'Did you find us okay?',
      "How's the weather out there?",
      'How are you doing today?',
      'How was the traffic on your way in?',
    ];
    for (const text of smalltalk) {
      test(`"${text.slice(0, 40)}…" → confidence below live gate (0.75)`, () => {
        const r = extractLatestQuestion([turn('interviewer', text)]);
        assert.ok(r.confidence < 0.75, `expected < 0.75, got ${r.confidence}`);
      });
    }

    // Substantive questions that merely CONTAIN a pleasantry topic word must
    // still fire — the down-weight is anchored on the social phrase, not the word.
    const realQuestions = [
      'How did you architect the parking-lot allocation service?',
      'Walk me through your most impactful project.',
      'How many years have you worked on distributed systems?',
      'Why are you interested in this role?',
    ];
    for (const text of realQuestions) {
      test(`"${text.slice(0, 40)}…" still clears the live gate`, () => {
        const r = extractLatestQuestion([turn('interviewer', text)]);
        assert.ok(r.confidence >= 0.75, `expected >= 0.75, got ${r.confidence}`);
      });
    }
  });
  // E2E MiniMax campaign (round 13/14, F-VOICE live-path): the LIVE grounding
  // gate keys on classifyType (this extractor), NOT AnswerPlanner. Intro/self-
  // intro openers must classify as 'identity' so the auto-trigger grounds the
  // intro instead of returning "I don't have a resume loaded".
  describe('intro/self-introduction → identity questionType (live grounding gate)', () => {
    const intros = [
      'Great to meet you. To start, could you give us a quick self-introduction?',
      'Could you start by giving a brief introduction of yourself?',
      'Can you start by introducing yourself?',
      'Could you start by giving me a brief self-intro?',
      'Could you start us off with a brief self-introduction?',
    ];
    for (const text of intros) {
      test(`"${text.slice(0, 42)}…" → identity`, () => {
        const r = extractLatestQuestion([turn('interviewer', text)]);
        assert.equal(r.questionType, 'identity');
      });
    }
    // Substantive asks that merely say "brief/quick" must NOT be intro-classified.
    for (const text of [
      'Give me a brief summary of your most impactful project.',
      'Can you give a quick overview of the system architecture?',
    ]) {
      test(`"${text.slice(0, 42)}…" is NOT identity`, () => {
        const r = extractLatestQuestion([turn('interviewer', text)]);
        assert.notEqual(r.questionType, 'identity');
      });
    }
  });
});

