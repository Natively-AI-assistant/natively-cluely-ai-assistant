// electron/llm/__tests__/HumanizeSpokenAnswer2026_06_15.test.mjs
//
// PROPERTY tests for the deterministic final-pass rewriter humanizeSpokenAnswer()
// (task Phase 6 + 9). The rewriter is STYLE-ONLY: it swaps fixed corporate idioms for
// plain-speech drop-ins, drops source narration / "the candidate" framing, and
// normalises spoken punctuation/formatting — without an LLM, without touching FACTS,
// and without ever editing code/math.
//
// These are property/rubric assertions over MANY paraphrased inputs, never
// exact-string equality on a fixed answer (anti-hardcoding rule).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  humanizeSpokenAnswer,
  humanizeForAnswerType,
} from '../../../dist-electron/electron/llm/index.js';

// The corporate phrases the product flagged. Each must be gone after a pass.
const BANNED = [
  /\bunique blend\b/i,
  /\btechnical rigor\b/i,
  /\bdata[- ]driven mindset\b/i,
  /\bactionable insights?\b/i,
  /\bactionable intelligence\b/i,
  /\bbusiness objectives\b/i,
  /\bhigh[- ]impact solutions?\b/i,
  /\bproven track record\b/i,
  /\b(?:decisive|distinct|significant|key)?\s*competitive advantage\b/i,
  /\bbridge the gap\b/i,
  /\bmove the needle\b/i,
  /\bscalable solutions?\b/i,
  /\bstrategic mindset\b/i,
  /\brobust and scalable\b/i,
  /\bseamless experience\b/i,
  /\bdeep expertise\b/i,
  /\bresults[- ]oriented\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\bleverag(?:e|es|ed|ing)\b/i,
];

// 30+ paraphrased corporate sentences so the implementation cannot overfit one wording.
const CORPORATE_VARIANTS = [
  'I bring a unique blend of engineering and analysis.',
  'My data-driven mindset helps me drive business objectives.',
  'I deliver actionable insights that move the needle.',
  'My proven track record gives me a competitive advantage.',
  'I leverage my technical rigor to ship high-impact solutions.',
  'We turn raw data into actionable intelligence.',
  'I build robust and scalable solutions with deep expertise.',
  'My results-oriented, best-in-class approach bridges the gap.',
  'I have a strategic mindset and a seamless experience focus.',
  'Leveraging my background, I create a decisive competitive advantage.',
  'I am a data-driven professional who delivers actionable insights.',
  'My unique blend of skills helps the team move the needle.',
  'I leverage analytics to drive business objectives forward.',
  'With deep expertise, I provide high-impact solutions.',
  'I have a proven track record of scalable solutions.',
  'My technical rigor produces actionable intelligence.',
  'I bridge the gap with a results-oriented mindset.',
  'A best-in-class engineer leveraging cutting tools.',
  'I deliver a seamless experience and a strategic mindset.',
  'My robust and scalable design moves the needle.',
  'I leverage my unique blend to deliver business objectives.',
  'My data-driven mindset turns raw data into actionable intelligence.',
  'I have deep expertise and a proven track record here.',
  'I provide actionable insights with technical rigor.',
  'My high-impact solutions give a competitive advantage.',
  'I am results-oriented and leverage scalable solutions.',
  'I bridge the gap between teams with a strategic mindset.',
  'My seamless experience leverages deep expertise.',
  'I move the needle by leveraging actionable intelligence.',
  'A best-in-class, data-driven mindset drives business objectives.',
  'My unique blend of technical rigor delivers actionable insights.',
  'I leverage a proven track record of high-impact solutions.',
];

describe('humanizeSpokenAnswer — removes every banned corporate phrase', () => {
  for (const input of CORPORATE_VARIANTS) {
    test(`no filler survives: "${input.slice(0, 48)}…"`, () => {
      const out = humanizeSpokenAnswer(input);
      for (const re of BANNED) {
        assert.doesNotMatch(out, re, `"${re}" survived in: ${out}`);
      }
    });
  }
});

describe('humanizeSpokenAnswer — grammar safety (no "a edge" / "an useful")', () => {
  for (const input of CORPORATE_VARIANTS) {
    test(`no broken article: "${input.slice(0, 40)}…"`, () => {
      const out = humanizeSpokenAnswer(input);
      // "a" before a vowel-sound word OR "an" before a consonant-sound word = broken.
      assert.doesNotMatch(out, /\ba\s+(?:edge|useful|actionable|honest|hour|mix\b)?(?:edge|honest)\b/i);
      assert.doesNotMatch(out, /\ban\s+(?:mix|track|leg|useful|reliable|real|smooth|habit|solution|goal)\b/i);
      // no doubled spaces or space-before-punctuation artifacts
      assert.doesNotMatch(out, /[ \t]{2,}/);
      assert.doesNotMatch(out, /\s+[,.!?]/);
    });
  }
});

describe('humanizeSpokenAnswer — idempotent (running twice = once)', () => {
  for (const input of CORPORATE_VARIANTS) {
    test(`stable: "${input.slice(0, 40)}…"`, () => {
      const once = humanizeSpokenAnswer(input);
      const twice = humanizeSpokenAnswer(once);
      assert.equal(twice, once);
    });
  }
});

describe('humanizeSpokenAnswer — preserves code / math / inline-code byte-for-byte', () => {
  test('fenced code block is untouched (incl. an em dash inside it)', () => {
    const code = '```python\nx = a — b  # em dash stays in code\nreturn x\n```';
    const input = `Here is the idea, I leverage my unique blend. ${code} That ships well.`;
    const out = humanizeSpokenAnswer(input);
    assert.ok(out.includes(code), 'the fenced block must be preserved exactly');
    assert.doesNotMatch(out, /unique blend/i);
    assert.doesNotMatch(out, /\bleverage\b/i);
  });

  test('inline code span is untouched', () => {
    const out = humanizeSpokenAnswer('Call `leverage_data()` to drive business objectives.');
    assert.ok(out.includes('`leverage_data()`'), 'inline code must survive');
    assert.doesNotMatch(out.replace('`leverage_data()`', ''), /business objectives/i);
  });

  test('inline + block math survive', () => {
    const out = humanizeSpokenAnswer('The cost is $O(n)$ and my data-driven mindset helps. $$\\sum_{i} a_i — b_i$$');
    assert.ok(out.includes('$O(n)$'));
    assert.ok(out.includes('$$\\sum_{i} a_i — b_i$$'), 'block math (with em dash) preserved');
    assert.doesNotMatch(out, /data-driven mindset/i);
  });
});

describe('humanizeSpokenAnswer — spoken punctuation/format normalization', () => {
  test('em/en dash between words → comma; numeric range keeps hyphen', () => {
    const out = humanizeSpokenAnswer('I led the migration — it took a while. The range is 5—10 items.');
    assert.doesNotMatch(out, /[—–]/, 'no em/en dash in spoken prose');
    assert.match(out, /5-10/, 'numeric range becomes a hyphen, not a comma');
  });

  test('semicolon in prose → sentence split', () => {
    const out = humanizeSpokenAnswer('I built it; it worked well.');
    assert.doesNotMatch(out, /;/);
    assert.match(out, /\bit worked well/i);
  });

  test('mid-sentence bold markers are KEPT (key-term scanning aid, 2026-06-15)', () => {
    // Sparing key-term bold is a deliberate on-screen scanning aid and is no longer
    // stripped. Bold is never spoken aloud, so spoken quality is unaffected.
    const out = humanizeSpokenAnswer('I built the **payments** service.');
    assert.match(out, /\*\*payments\*\*/, 'key-term bold must survive the humanizer');
    assert.match(out, /payments/);
  });
});

describe('humanizeSpokenAnswer — drops source narration & "the candidate"', () => {
  const narrations = [
    'Based on my resume, I scaled the service.',
    'Based on your resume, I led the team.',
    'According to the JD, I fit the role.',
    'According to the job description, I have the skills.',
    'Based on the provided context, I shipped it.',
  ];
  for (const n of narrations) {
    test(`source narration removed: "${n}"`, () => {
      const out = humanizeSpokenAnswer(n);
      assert.doesNotMatch(out, /based on (?:my|your|the)/i);
      assert.doesNotMatch(out, /according to (?:the|my|your)/i);
      assert.match(out, /^[A-Z]/, 'remaining sentence still starts capitalised');
    });
  }

  const candidateFrames = [
    'The candidate has strong backend skills.',
    'The candidate is a good fit for the role.',
    "The candidate's experience is relevant.",
    'The candidate brings real depth here.',
  ];
  for (const c of candidateFrames) {
    test(`third-person candidate framing → first person: "${c}"`, () => {
      const out = humanizeSpokenAnswer(c);
      assert.doesNotMatch(out, /\bthe candidate\b/i);
      assert.match(out, /\bI\b|\bmy\b|\bI'm\b/i);
    });
  }
});

describe('humanizeSpokenAnswer — meaning preservation (keeps the concrete facts)', () => {
  test('numbers, tech names, and project nouns survive the rewrite', () => {
    const input =
      'Based on my resume, I leveraged my technical rigor to cut p95 latency from 800ms to 300ms on the Kafka pipeline.';
    const out = humanizeSpokenAnswer(input);
    for (const fact of ['800ms', '300ms', 'p95', 'Kafka', 'latency']) {
      assert.ok(out.includes(fact), `fact "${fact}" must survive: ${out}`);
    }
    assert.doesNotMatch(out, /technical rigor/i);
    assert.doesNotMatch(out, /based on my resume/i);
  });
});

describe('humanizeSpokenAnswer — leaves clean human speech alone', () => {
  const clean = [
    "I'm a backend engineer. I built the payments service at my last job.",
    'Honestly, I haven\'t used Kafka much, but I\'ve done similar streaming work with NATS.',
    'I\'d be upfront about that gap and explain how I\'d close it.',
  ];
  for (const c of clean) {
    test(`unchanged (no idiom/label/dash): "${c.slice(0, 40)}…"`, () => {
      assert.equal(humanizeSpokenAnswer(c), c);
    });
  }
});

describe('humanizeForAnswerType — broad spoken denylist gates the rewriter', () => {
  const filler = 'I bring a unique blend and leverage my technical rigor.';
  // The curated directive set PLUS the broader spoken types real sessions showed filler on
  // (profile_fact_answer, follow_up_answer, unknown_answer, general_meeting_answer).
  const spoken = [
    'identity_answer', 'jd_fit_answer', 'gap_analysis_answer', 'sales_answer',
    'behavioral_interview_answer', 'profile_fact_answer', 'follow_up_answer',
    'unknown_answer', 'general_meeting_answer',
  ];
  for (const t of spoken) {
    test(`${t}: rewrites`, () => {
      const r = humanizeForAnswerType(t, filler);
      assert.equal(r.changed, true);
      assert.doesNotMatch(r.text, /unique blend/i);
    });
  }
  // Structured/precision types must stay byte-for-byte (the rewriter would risk them).
  const preserved = [
    'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
    'lecture_answer', 'system_design_answer', 'debugging_question_answer',
    'project_link_answer', 'source_code_evidence_answer', 'ethical_usage_answer',
  ];
  for (const t of preserved) {
    test(`${t}: untouched (byte-for-byte)`, () => {
      const r = humanizeForAnswerType(t, filler);
      assert.equal(r.changed, false);
      assert.equal(r.text, filler);
    });
  }
});

describe('humanizeSpokenAnswer — code-review regression cases (2026-06-15)', () => {
  test('HIGH: bare "a competitive advantage" keeps the space ("a leg up", not "aleg up")', () => {
    const out = humanizeSpokenAnswer('It gives us a competitive advantage over rivals.');
    assert.match(out, /a leg up/);
    assert.doesNotMatch(out, /aleg/);
    assert.doesNotMatch(out, /competitive advantage/i);
  });

  test('HIGH: NOUN "leverage" is preserved (sales/negotiation), VERB "leverage" becomes "use"', () => {
    // noun senses untouched
    assert.match(humanizeSpokenAnswer('My main leverage in the deal is the timeline.'), /\bleverage\b/);
    assert.match(humanizeSpokenAnswer('Financial leverage helped us scale.'), /Financial leverage/);
    assert.match(humanizeSpokenAnswer('That gives me more leverage to negotiate.'), /more leverage/);
    // verb sense rewritten
    assert.doesNotMatch(humanizeSpokenAnswer('I leverage analytics to ship features.'), /\bleverage\b/i);
  });

  test('MED: two dollar amounts on a line are NOT mis-paired as math; both survive', () => {
    const out = humanizeSpokenAnswer('The range is $5M to $20M for the contract.');
    assert.ok(out.includes('$5M'));
    assert.ok(out.includes('$20M'));
  });

  test('MED: currency ($20k) is preserved and not treated as math', () => {
    const out = humanizeSpokenAnswer('The budget is $20k and the floor is $15k.');
    assert.ok(out.includes('$20k') && out.includes('$15k'));
  });

  test('MED: real inline math ($O(n)$) is still protected while prose around it is humanized', () => {
    const out = humanizeSpokenAnswer('The cost is $O(n)$ and my data-driven mindset helps.');
    assert.ok(out.includes('$O(n)$'));
    assert.doesNotMatch(out, /data-driven mindset/i);
  });

  test('MED: a literal "PROT0" in the answer is NOT corrupted by the placeholder scheme', () => {
    const out = humanizeSpokenAnswer('The function returns PROT0 as a sentinel value.');
    assert.ok(out.includes('PROT0'), 'literal PROT0 must survive');
    assert.match(out, /as a sentinel value/);
  });

  test('MED: inline code adjacent to a word keeps its surrounding spaces', () => {
    const out = humanizeSpokenAnswer('Call the `helper()` now and ship it.');
    assert.ok(out.includes('`helper()`'));
    assert.match(out, /the `helper\(\)` now/);
  });
});

describe('humanizeSpokenAnswer — robustness', () => {
  test('empty / non-string inputs are safe', () => {
    assert.equal(humanizeSpokenAnswer(''), '');
    assert.equal(humanizeSpokenAnswer(null), null);
    assert.equal(humanizeSpokenAnswer(undefined), undefined);
  });
});
