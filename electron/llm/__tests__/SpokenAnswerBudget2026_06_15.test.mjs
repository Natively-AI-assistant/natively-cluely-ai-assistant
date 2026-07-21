// electron/llm/__tests__/SpokenAnswerBudget2026_06_15.test.mjs
//
// Property tests for the speakability budget (spoken-answer-quality sprint). Spoken answers
// must be sayable aloud (≤100 words / ≤35s) UNLESS the answer is exempt (code / detailed /
// system design / lecture / step-by-step). Property/rubric assertions, no fixed answers.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  countSpokenWordsExcludingCode, estimateSpeakSeconds, decideSpeakability,
  trimToSpeakable, applySpeakabilityBudget, classifySpeakability,
  classifyTargetSpeakability, classifyShortBand, shortBandTargetWords,
  planAnswer, formatAnswerPlanForPrompt,
  HARD_MAX_WORDS, SOFT_MAX_WORDS, SPOKEN_FULL_MAX_WORDS,
} from '../../../dist-electron/electron/llm/index.js';

// Build prose of ~N words across MULTIPLE sentences (so the tail-trimmer can operate).
// ~10 words per sentence.
const proseOf = (n) => {
  const out = [];
  let made = 0;
  let s = 0;
  while (made < n) {
    const take = Math.min(10, n - made);
    out.push(`Sentence ${s} ` + Array.from({ length: take - 2 < 0 ? 0 : take - 2 }, (_, i) => `word${i % 7}`).join(' ') + '.');
    made += take;
    s++;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
};

describe('countSpokenWordsExcludingCode — excludes code and math', () => {
  test('counts plain prose words', () => {
    assert.equal(countSpokenWordsExcludingCode('I built the payments service last year.'), 7);
  });
  test('excludes fenced code', () => {
    const t = 'Here is the idea. ```python\n' + 'x = 1\n'.repeat(50) + '```';
    assert.ok(countSpokenWordsExcludingCode(t) < 10, 'code words must not count');
  });
  test('excludes inline code and math', () => {
    const w = countSpokenWordsExcludingCode('The cost is `O(n)` and $x^2$ here.');
    assert.ok(w <= 5, `expected only spoken words, got ${w}`);
  });
});

describe('estimateSpeakSeconds — ~140 wpm', () => {
  test('70 words ≈ 30s', () => {
    const s = estimateSpeakSeconds(proseOf(70));
    assert.ok(s >= 28 && s <= 33, `got ${s}`);
  });
});

describe('decideSpeakability — over budget vs exceptions', () => {
  test('a 130-word interview answer is over budget', () => {
    const d = decideSpeakability(proseOf(130), 'jd_fit_answer', 'default', 'why should we hire you?', false);
    assert.equal(d.overBudget, true);
    assert.equal(d.exception, false);
  });

  test('a 60-word answer is within budget', () => {
    const d = decideSpeakability(proseOf(60), 'jd_fit_answer', 'default', 'why should we hire you?', false);
    assert.equal(d.overBudget, false);
  });

  // Exceptions: long is ALLOWED — never over budget.
  const exemptCases = [
    ['coding answer type', 'dsa_question_answer', 'default', 'solve two sum', true],
    ['system design type', 'system_design_answer', 'default', 'design a url shortener', false],
    ['lecture type', 'lecture_answer', 'default', 'explain the topic', false],
    ['style detailed', 'jd_fit_answer', 'detailed', 'walk me through your background', false],
    ['style code_only', 'dsa_question_answer', 'code_only', 'code only for two sum', false],
    ['question asks detail', 'jd_fit_answer', 'default', 'explain in detail and walk me through it', false],
    ['question asks step by step', 'technical_concept_answer', 'default', 'explain step by step', false],
  ];
  for (const [label, type, style, q, isCoding] of exemptCases) {
    test(`exempt: ${label} (never over budget)`, () => {
      const d = decideSpeakability(proseOf(180), type, style, q, isCoding);
      assert.equal(d.overBudget, false, 'exempt answers must never be over budget');
      assert.equal(d.exception, true);
      assert.ok(d.exceptionReason.length > 0);
    });
  }

  test('an answer with a fenced code block is exempt', () => {
    const t = proseOf(120) + '\n```python\nprint(1)\n```';
    const d = decideSpeakability(t, 'jd_fit_answer', 'default', 'show me', false);
    assert.equal(d.exception, true);
  });

  test('fence guard is stateless across calls (no global-regex lastIndex leak)', () => {
    // A long NON-fenced answer first (would advance a buggy global regex's lastIndex),
    // then a SHORTER fenced answer must STILL be detected as code-bearing/exempt.
    const long = proseOf(160);
    for (let i = 0; i < 5; i++) decideSpeakability(long, 'jd_fit_answer', 'default', 'q', false);
    const fenced = 'Short intro. ```python\nx = 1\n```';
    const d = decideSpeakability(fenced, 'jd_fit_answer', 'default', 'q', false);
    assert.equal(d.exception, true);
    assert.equal(d.target, 'STRUCTURED_FULL');
    assert.match(d.exceptionReason, /contains_code_block/);
    assert.equal(trimToSpeakable(fenced, d).changed, false);
  });
});

// ── 3-tier model (SPOKEN_SHORT / SPOKEN_FULL / STRUCTURED_FULL) ───────────────
// The exception list was replaced by a principle: longer is allowed whenever brevity
// would make the answer incomplete, misleading, unsafe, or unusable. SPOKEN_FULL answers
// are NEVER trimmed (user-confirmed "soft 180, never trim"); only SPOKEN_SHORT is enforced.
describe('classifyTargetSpeakability — tier classification (signal-based)', () => {
  const cases = [
    // STRUCTURED_FULL — not a spoken paragraph.
    ['dsa_question_answer', 'default', 'solve two sum', 'STRUCTURED_FULL'],
    ['system_design_answer', 'default', 'design a url shortener', 'STRUCTURED_FULL'],
    ['lecture_answer', 'default', 'explain the topic', 'STRUCTURED_FULL'],
    ['jd_fit_answer', 'detailed', 'why hire you', 'STRUCTURED_FULL'],
    ['jd_fit_answer', 'default', 'walk me through your background in detail', 'STRUCTURED_FULL'],
    ['technical_concept_answer', 'default', 'explain caching step by step', 'STRUCTURED_FULL'],
    // SPOKEN_FULL — still spoken, needs room.
    ['ethical_usage_answer', 'default', 'is it ok to use this in an interview', 'SPOKEN_FULL'],
    ['negotiation_answer', 'default', 'they lowballed my salary, how do I push back', 'SPOKEN_FULL'],
    ['behavioral_interview_answer', 'default', 'tell me about a time you had conflict', 'SPOKEN_FULL'],
    // A behavioral story with a leadership/recall cue needs room (code-review LOW 2026-06-16).
    ['behavioral_interview_answer', 'default', 'Did you ever lead a team?', 'SPOKEN_FULL'],
    ['behavioral_interview_answer', 'default', 'Tell me about a project you built', 'SPOKEN_FULL'],
    ['technical_concept_answer', 'default', 'compare redis and memcached', 'SPOKEN_FULL'],
    ['jd_fit_answer', 'default', 'what are the tradeoffs of your approach', 'SPOKEN_FULL'],
    ['experience_answer', 'default', 'expand on that and justify your choice', 'SPOKEN_FULL'],
    // SPOKEN_SHORT — the default.
    ['jd_fit_answer', 'default', 'why should we hire you', 'SPOKEN_SHORT'],
    ['technical_concept_answer', 'default', 'what is redis', 'SPOKEN_SHORT'],
    ['sales_answer', 'default', 'why is your product expensive', 'SPOKEN_SHORT'],
    ['gap_analysis_answer', 'default', 'what gap do you have', 'SPOKEN_SHORT'],
    // SPOKEN_SHORT — a bare "and"/"or" in a short question must NOT escalate (code-review
    // HIGH 2026-06-15): only a conjunction joining a second imperative ask is multi-part.
    ['technical_concept_answer', 'default', 'what is SQL and NoSQL?', 'SPOKEN_SHORT'],
    ['technical_concept_answer', 'default', 'what is HTTP and HTTPS?', 'SPOKEN_SHORT'],
    ['jd_fit_answer', 'default', 'are you available Monday or Tuesday?', 'SPOKEN_SHORT'],
    ['sales_answer', 'default', 'coffee or tea?', 'SPOKEN_SHORT'],
    // But a conjunction that joins a real second ask IS multi-part → SPOKEN_FULL.
    ['technical_concept_answer', 'default', 'define a hash map and explain when to use one', 'SPOKEN_FULL'],
  ];
  for (const [type, style, q, expected] of cases) {
    test(`${expected}: ${type} "${q.slice(0, 36)}"`, () => {
      assert.equal(classifyTargetSpeakability(type, style, q), expected);
    });
  }
});

describe('SPOKEN_FULL tier — never trimmed (soft 180, prompt-only)', () => {
  const fullCases = [
    ['negotiation', 'negotiation_answer', 'they lowballed my salary, how do I push back'],
    ['behavioral with context', 'behavioral_interview_answer', 'tell me about a time you had conflict'],
    ['ethical/safety', 'ethical_usage_answer', 'is it ok to use this in an interview'],
    ['tradeoff', 'jd_fit_answer', 'what are the tradeoffs here'],
  ];
  for (const [label, type, q] of fullCases) {
    test(`${label}: 150-word answer is exempt (target SPOKEN_FULL, not trimmed)`, () => {
      const d = decideSpeakability(proseOf(150), type, 'default', q, false);
      assert.equal(d.target, 'SPOKEN_FULL');
      assert.equal(d.exception, true);
      assert.equal(d.overBudget, false);
      assert.equal(trimToSpeakable(proseOf(150), d).changed, false);
    });
    test(`${label}: even a 250-word answer is NOT trimmed (soft 180, never trim)`, () => {
      const d = decideSpeakability(proseOf(250), type, 'default', q, false);
      assert.equal(d.target, 'SPOKEN_FULL');
      assert.equal(trimToSpeakable(proseOf(250), d).changed, false);
    });
  }

  test('SPOKEN_FULL_MAX_WORDS is the documented soft ceiling (180), not a trim threshold', () => {
    assert.equal(SPOKEN_FULL_MAX_WORDS, 180);
  });
});

describe('SPOKEN_SHORT tier — measured but NEVER trimmed (no output truncation)', () => {
  // The deterministic trimmer was removed 2026-06-16: it cropped the conclusion off long
  // answers. A long SPOKEN_SHORT answer is now MEASURED (over_budget for telemetry) but ships
  // WHOLE — length is the model's job via the prompt, never a deterministic cut.
  test('a 150-word answer is flagged over_budget but ships verbatim (not trimmed)', () => {
    const long = proseOf(150);
    const d = decideSpeakability(long, 'jd_fit_answer', 'default', 'why should we hire you', false);
    assert.equal(d.target, 'SPOKEN_SHORT');
    assert.equal(d.overBudget, true); // still measured as long, for telemetry
    const r = applySpeakabilityBudget(long, 'jd_fit_answer', 'default', 'why should we hire you', false);
    assert.equal(r.speakability_budget_applied, false, 'must NOT trim');
    assert.equal(r.text, long, 'answer ships verbatim — no truncation');
    assert.equal(r.spoken_word_count, 150);
    assert.equal(r.speakability_class, 'over_budget');
  });

  test('the conclusion (last sentence) is never dropped', () => {
    const answer = 'I built the payments service end to end. I cut p95 latency from 800ms to 300ms. '
      + 'I also added retries and idempotency keys so a duplicate charge can never happen. '
      + 'The hardest part was the migration, which I ran with zero downtime over a weekend. '
      + 'So the takeaway is that I can own a critical service from design through production and keep it reliable.';
    const r = applySpeakabilityBudget(answer, 'experience_answer', 'default', 'tell me about your work', false);
    assert.equal(r.text, answer);
    assert.match(r.text, /So the takeaway is/); // the conclusion survives
  });
});

// ── Adaptive 15-30s band within SPOKEN_SHORT (2026-06-16) ────────────────────
// Most spoken answers should land 15-30s by question intent, not always ~30s. classifyShortBand
// picks BRIEF/STANDARD/FULLER (prompt-guidance only — the trimmer is unchanged).
describe('classifyShortBand — adaptive 15-30s band (signal-based)', () => {
  const cases = [
    // BRIEF (~15s): yes/no, single fact, definition.
    ['BRIEF', 'jd_fit_answer', 'default', 'Are you available Monday?'],
    ['BRIEF', 'jd_fit_answer', 'default', 'Do you know Python?'],
    ['BRIEF', 'technical_concept_answer', 'default', 'What is CORS?'],
    ['BRIEF', 'technical_concept_answer', 'default', 'What is a hash map?'],
    ['BRIEF', 'profile_fact_answer', 'default', 'Who is your current manager?'],
    ['BRIEF', 'experience_answer', 'default', 'How long have you been coding?'],
    // STANDARD (~20-25s): the default for most interview/profile/role-fit answers.
    ['STANDARD', 'jd_fit_answer', 'default', 'Why should we hire you?'],
    ['STANDARD', 'jd_fit_answer', 'default', 'Why this role?'],
    ['STANDARD', 'skills_answer', 'default', 'What are your main skills?'],
    ['STANDARD', 'experience_answer', 'default', 'Tell me about your background'],
    ['STANDARD', 'gap_analysis_answer', 'default', 'What gap do you have for this job?'],
    // "what is YOUR …" is a self-reflection interview question, NOT a definition — must be
    // STANDARD, not BRIEF (code-review HIGH 2026-06-16). Genuine "what is X" definitions stay BRIEF.
    ['STANDARD', 'jd_fit_answer', 'default', 'What is your biggest weakness?'],
    ['STANDARD', 'jd_fit_answer', 'default', 'What is your greatest strength?'],
    ['STANDARD', 'jd_fit_answer', 'default', "What's your management style?"],
    ['BRIEF', 'technical_concept_answer', 'default', 'What is the CAP theorem?'],
    ['BRIEF', 'technical_concept_answer', 'default', 'What is a closure?'],
    // FULLER (~30s, still SPOKEN_SHORT): reasoning / comparison / "how would you".
    ['FULLER', 'jd_fit_answer', 'default', 'Why would you pick Redis over Memcached?'],
    ['FULLER', 'technical_concept_answer', 'default', 'How would you approach scaling this?'],
    ['FULLER', 'jd_fit_answer', 'default', "What's your take on microservices?"],
    ['FULLER', 'experience_answer', 'default', 'Walk me through your thinking on that'],
    // Explicit brevity styles win.
    ['BRIEF', 'jd_fit_answer', 'one_liner', 'why hire you in one line'],
    ['BRIEF', 'jd_fit_answer', 'short', 'quickly, why hire you'],
    // A yes/no opener carrying a STORY cue is NOT brief (code-review MEDIUM 2026-06-16) —
    // it's a behavioral story that needs room. Genuine yes/no lookups stay BRIEF.
    ['STANDARD', 'experience_answer', 'default', 'Did you ever have to deal with a difficult teammate?'],
    ['STANDARD', 'experience_answer', 'default', 'Have you ever led a team and what happened?'],
    ['BRIEF', 'jd_fit_answer', 'default', 'Would you relocate?'],
    ['BRIEF', 'jd_fit_answer', 'default', 'Is microservices a good fit here?'],
  ];
  for (const [expected, type, style, q] of cases) {
    test(`${expected}: ${type} "${q.slice(0, 36)}"`, () => {
      assert.equal(classifyShortBand(type, style, q), expected);
    });
  }
});

describe('shortBandTargetWords — monotonic, within the soft ceiling', () => {
  test('BRIEF < STANDARD < FULLER, all <= SOFT_MAX_WORDS (85)', () => {
    const b = shortBandTargetWords('BRIEF');
    const s = shortBandTargetWords('STANDARD');
    const f = shortBandTargetWords('FULLER');
    assert.ok(b.max < s.max, 'BRIEF max < STANDARD max');
    assert.ok(s.max < f.max, 'STANDARD max < FULLER max');
    assert.ok(f.max <= SOFT_MAX_WORDS, 'FULLER max <= 85');
    assert.ok(f.max <= HARD_MAX_WORDS, 'all bands stay within the hard ceiling');
    // seconds rise with the band.
    assert.ok(b.seconds < s.seconds && s.seconds <= f.seconds);
    for (const t of [b, s, f]) assert.ok(typeof t.guidance === 'string' && t.guidance.length > 0);
  });
});

// END-TO-END: planAnswer must TYPE a behavioral "did/have you ever <lead/manage people>"
// question as behavioral so the tier routes it to SPOKEN_FULL (the fuller story length). A
// tech/tool object ("have you built a REST API", "what projects have you built") must NOT be
// pulled into the behavioral lane (code-review caveat fix 2026-06-16).
describe('planAnswer + tier — behavioral story questions route to SPOKEN_FULL end-to-end', () => {
  const behavioral = [
    'Did you ever lead a team?',
    'Have you managed people before?',
    'Have you handled a conflict?',
    'Did you ever mentor a junior?',
    'Have you delivered under a tight deadline?',
    // indefinite-pronoun + crisis/difficult phrasings (code-review HIGH 2026-06-16)
    'Have you mentored anyone?',
    'Have you coached anyone?',
    'Did you handle a crisis?',
    'Have you handled a tough situation?',
    'Did you deal with a difficult situation?',
  ];
  for (const q of behavioral) {
    test(`"${q}" → behavioral → SPOKEN_FULL`, () => {
      const plan = planAnswer({ question: q, source: 'manual_input' });
      assert.equal(plan.answerType, 'behavioral_interview_answer', `expected behavioral, got ${plan.answerType}`);
      assert.equal(classifyTargetSpeakability(plan.answerType, plan.answerStyle, q), 'SPOKEN_FULL');
    });
  }

  const notBehavioral = [
    ['what projects have you built', 'project_answer'],
    ['Have you used Python?', 'skill_experience_answer'],
    ['Have you managed a database?', 'skill_experience_answer'], // tech object → skill, not behavioral
    ['Have you managed a cluster', 'skill_experience_answer'],
    ['Have you built a REST API?', 'skill_experience_answer'],
    ['did you actually use Redis', 'skill_experience_answer'],
  ];
  for (const [q, expected] of notBehavioral) {
    test(`"${q}" stays ${expected} (not pulled into behavioral)`, () => {
      assert.equal(planAnswer({ question: q, source: 'manual_input' }).answerType, expected);
    });
  }
});

describe('formatAnswerPlanForPrompt — injects a concrete LENGTH target for SPOKEN_SHORT default', () => {
  const lengthLine = (q) => {
    const plan = planAnswer({ question: q, source: 'manual_input' });
    const contract = formatAnswerPlanForPrompt(plan, false);
    const m = contract.match(/LENGTH: aim for about \d+s spoken[^\n]*/);
    return { plan, line: m ? m[0] : null };
  };

  test('a BRIEF question gets a ~15s / smaller-word target', () => {
    const { line } = lengthLine('What is CORS?');
    assert.ok(line, 'expected a LENGTH directive');
    assert.match(line, /about 15s/);
  });

  test('a FULLER question gets a ~30s / larger-word target', () => {
    const { line } = lengthLine('Why would you pick Redis over Memcached?');
    assert.ok(line, 'expected a LENGTH directive');
    assert.match(line, /about 30s/);
  });

  test('a STANDARD question gets a ~20-25s target', () => {
    const { line } = lengthLine('Why should we hire you?');
    assert.ok(line);
    assert.match(line, /about 2\ds/);
  });

  test('NO length directive for an explicit style (e.g. code only)', () => {
    const { line } = lengthLine('Write code only for Two Sum in Python');
    assert.equal(line, null, 'explicit-style answers own their own length');
  });

  test('NO length directive for a SPOKEN_FULL plan (negotiation)', () => {
    const { line } = lengthLine('They lowballed my salary at 80k, how do I push back without losing the offer?');
    assert.equal(line, null, 'SPOKEN_FULL owns its own length');
  });
});

describe('trimToSpeakable — removed (no-op, never truncates)', () => {
  // The trimmer was removed 2026-06-16. It is retained as a no-op for import compatibility;
  // it must NEVER change an answer at any length, so the answer is never cropped.
  test('never changes a long answer (no truncation)', () => {
    const long = proseOf(140);
    const d = decideSpeakability(long, 'experience_answer', 'default', 'tell me about your work', false);
    const r = trimToSpeakable(long, d);
    assert.equal(r.changed, false);
    assert.equal(r.text, long, 'answer ships verbatim');
  });

  test('never changes a very long answer either (no hard cap on output)', () => {
    const veryLong = proseOf(300);
    const d = decideSpeakability(veryLong, 'jd_fit_answer', 'default', 'why hire you', false);
    assert.equal(trimToSpeakable(veryLong, d).changed, false);
    assert.equal(trimToSpeakable(veryLong, d).text, veryLong);
  });

  test('never changes a fenced/code answer', () => {
    const codeHeavy = 'Short intro. ```python\n' + 'x=1\n'.repeat(60) + '```';
    const d = decideSpeakability(codeHeavy, 'jd_fit_answer', 'default', 'show', false);
    assert.equal(trimToSpeakable(codeHeavy, d).changed, false);
  });
});

// ── Fix D: speakability_class telemetry marker ───────────────────────────────
// classifySpeakability maps a SpeakabilityDecision to a coarse marker for telemetry.
// Precedence: exempt > over_budget > over_soft > standard (asserted explicitly).
describe('classifySpeakability — coarse marker mapping (Fix D)', () => {
  // Helper to forge a decision object directly (tests the PURE mapping in isolation,
  // independent of the word/second math).
  const decision = (over) => ({
    wordCount: 0, seconds: 0, overBudget: false, overSoftTarget: false,
    exception: false, exceptionReason: '', ...over,
  });

  test('exempt wins over everything (even if overBudget/overSoft also set)', () => {
    assert.equal(classifySpeakability(decision({ exception: true, exceptionReason: 'is_coding', overBudget: true, overSoftTarget: true })), 'exempt');
  });
  test('over_budget when overBudget and NOT exempt', () => {
    assert.equal(classifySpeakability(decision({ overBudget: true, overSoftTarget: true })), 'over_budget');
  });
  test('over_soft when only over the soft target (under hard cap, not exempt)', () => {
    assert.equal(classifySpeakability(decision({ overSoftTarget: true })), 'over_soft');
  });
  test('standard when within the soft target', () => {
    assert.equal(classifySpeakability(decision({})), 'standard');
  });

  // Real-path checks via decideSpeakability (no synthetic objects): these are the
  // exact scenarios the task spec calls out.
  test('real path: long (>100w) experience_answer, no detail cue → over_budget', () => {
    const d = decideSpeakability(proseOf(130), 'experience_answer', 'default', 'tell me about your work', false);
    const r = applySpeakabilityBudget(proseOf(130), 'experience_answer', 'default', 'tell me about your work', false);
    assert.equal(d.exception, false);
    assert.equal(d.overBudget, true);
    // applySpeakabilityBudget classifies on the ORIGINAL decision (pre-trim), so the
    // class reflects that this answer was over budget.
    assert.equal(r.speakability_class, 'over_budget');
  });
  test('real path: coding answer type → exempt', () => {
    const r = applySpeakabilityBudget(proseOf(180), 'dsa_question_answer', 'default', 'solve two sum', true);
    assert.equal(r.speakability_class, 'exempt');
  });
  test('real path: a fenced code block → exempt', () => {
    const t = 'Here is the idea. ```python\nx = 1\n```';
    const r = applySpeakabilityBudget(t, 'jd_fit_answer', 'default', 'show me', false);
    assert.equal(r.speakability_class, 'exempt');
  });
  test('real path: a short answer → standard', () => {
    const r = applySpeakabilityBudget(proseOf(30), 'experience_answer', 'default', 'tell me', false);
    assert.equal(r.speakability_class, 'standard');
  });
});

describe('applySpeakabilityBudget — metadata (measure-only, never trims)', () => {
  test('reports word count, seconds, class — but never trims (applied always false)', () => {
    const long = proseOf(130);
    const r = applySpeakabilityBudget(long, 'jd_fit_answer', 'default', 'why hire you', false);
    assert.equal(typeof r.spoken_word_count, 'number');
    assert.equal(typeof r.estimated_speak_seconds, 'number');
    assert.equal(r.speakability_budget_applied, false, 'measure-only — never trims');
    assert.equal(r.text, long, 'answer ships verbatim');
    assert.equal(r.spoken_word_count, 130); // reports the FULL length, not a trimmed one
  });
  test('exempt answer carries the exception reason and is unchanged', () => {
    const long = proseOf(160);
    const r = applySpeakabilityBudget(long, 'lecture_answer', 'default', 'explain', false);
    assert.equal(r.speakability_budget_applied, false);
    assert.ok(r.length_exception_reason.includes('lecture'));
    assert.equal(r.text, long);
  });
});
