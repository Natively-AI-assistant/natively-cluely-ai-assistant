// electron/llm/__tests__/GenericTechBrevity2026_06_15.test.mjs
//
// Property tests for generic technical-concept brevity. Small models ignore the "be brief"
// prompt for generic concepts ("what is CORS?") and emit doc-style tutorials, so:
//   (a) the technical_concept template bluntly forbids doc structure, and
//   (b) compressTechnicalConcept FLATTENS all markdown structure to prose AND caps to a short
//       spoken answer (user decision 2026-06-16). Behavioural — no fixed answer strings.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { compressTechnicalConcept, countSpokenWordsExcludingCode } from '../../../dist-electron/electron/llm/index.js';
import { planAnswer, formatAnswerPlanForPrompt } from '../../../dist-electron/electron/llm/index.js';

describe('technical_concept template bluntly forbids doc structure', () => {
  const TECH_QS = [
    'What is Redis?', 'What is JWT?', 'What is CORS?', 'Explain REST API.',
    'Explain caching.', 'What is database indexing?', 'Explain the event loop.',
  ];
  for (const q of TECH_QS) {
    test(`"${q}" plans a spoken, no-doc-structure contract`, () => {
      const plan = planAnswer({ question: q, source: 'manual_input' });
      assert.equal(plan.answerType, 'technical_concept_answer', `expected technical_concept for "${q}", got ${plan.answerType}`);
      const prompt = formatAnswerPlanForPrompt(plan, false);
      assert.match(prompt, /SPOKEN ANSWER|spoken answer/i);
      // It must explicitly forbid headings / bullets / code blocks.
      assert.match(prompt, /heading|bullet|code block/i);
      assert.match(prompt, /WRONG/i);
    });
  }
});

// A realistic small-model tutorial (headers + bullets, like the live GUI output).
const corsTutorial = [
  'CORS (Cross-Origin Resource Sharing) is a browser security mechanism that lets a server',
  'specify which origins may access its resources.',
  '',
  'How it works:',
  '',
  '- Request Headers: the browser adds an Origin header.',
  '- Server Response: the server returns Access-Control-Allow-Origin.',
  '- Browser Enforcement: the browser allows or blocks the response.',
  '',
  'Preflight Requests',
  'For requests with side effects the browser sends an OPTIONS preflight.',
  '',
  'Common Headers:',
  '- Access-Control-Allow-Origin',
  '- Access-Control-Allow-Methods',
].join('\n');

describe('compressTechnicalConcept — flatten ONLY (no truncation)', () => {
  test('a header+bullet tutorial is flattened to prose with no markdown structure', () => {
    const r = compressTechnicalConcept(corsTutorial, false);
    assert.equal(r.changed, true);
    assert.doesNotMatch(r.text, /^[ \t]*[-*•+]\s+/m, 'no bullet markers survive');
    assert.doesNotMatch(r.text, /^#{1,6}\s/m, 'no ATX headers survive');
    assert.doesNotMatch(r.text, /\n/, 'flattened to a single paragraph');
  });

  test('NEVER truncates — all prose content is kept (only structure removed)', () => {
    // Every meaningful word from the tutorial body must survive the flatten (user decision
    // 2026-06-16: flatten only, no cap). We compare word counts of the de-structured source.
    const sourceWords = countSpokenWordsExcludingCode(
      corsTutorial.replace(/^[ \t]*[-*•+#][ \t]*/gm, '').replace(/:/g, ''),
    );
    const r = compressTechnicalConcept(corsTutorial, false);
    const outWords = countSpokenWordsExcludingCode(r.text);
    // Flatten keeps essentially all words (allow a tiny delta for dropped pure-label lines).
    assert.ok(outWords >= sourceWords - 4, `content was truncated: ${outWords} vs ~${sourceWords}`);
    // And it is NOT cut to a short cap — a real tutorial body stays its full length.
    assert.ok(outWords >= 60, `a full tutorial should keep its length, got ${outWords}`);
  });

  test('keeps the LEAD definition (the answer is not gutted)', () => {
    const r = compressTechnicalConcept(corsTutorial, false);
    assert.match(r.text, /CORS .*browser security mechanism/i);
  });

  test('drops an embedded code example (a code block in a SPOKEN concept answer)', () => {
    const withCode = [
      'A hash map maps keys to values for O(1) average lookup.',
      '',
      'Example (Python)',
      '```python',
      'd = {"a": 1}',
      'print(d["a"])',
      '```',
      'It is used for indexing and caching.',
    ].join('\n');
    const r = compressTechnicalConcept(withCode, false);
    assert.equal(r.changed, true);
    assert.doesNotMatch(r.text, /```/, 'fenced code is dropped');
    assert.doesNotMatch(r.text, /print\(/, 'code body is gone');
    assert.match(r.text, /hash map maps keys to values/i, 'lead definition kept');
  });

  test('a long comparison/tradeoff is flattened but NOT shortened', () => {
    const tradeoff = [
      'The choice depends on scale and team maturity.',
      '',
      'Monolith:',
      '- Pros: simpler to develop, test, and deploy early.',
      '- Cons: harder to scale; a single bug can crash everything.',
      '',
      'Microservices:',
      '- Pros: independent scaling, fault isolation, tech diversity.',
      '- Cons: operational complexity, distributed transactions, more monitoring.',
      '',
      'My take: start with a modular monolith and extract services only when a module needs its own scaling.',
    ].join('\n');
    const r = compressTechnicalConcept(tradeoff, false);
    assert.doesNotMatch(r.text, /^[ \t]*[-*•+]\s+/m, 'bullets are flattened');
    // The conclusion ("My take…") must survive — nothing is dropped from the tail.
    assert.match(r.text, /start with a modular monolith and extract services/i);
    assert.ok(countSpokenWordsExcludingCode(r.text) >= 60, 'full content kept, not capped');
  });

  test('KEEPS the analogy when simple terms WERE requested', () => {
    const withAnalogy = 'Redis is an in-memory data store. Think of it like a fast notebook. It is used for caching.';
    const r = compressTechnicalConcept(withAnalogy, true);
    assert.match(r.text, /think of it like/i);
  });

  test('drops a long analogy when simple terms were NOT requested', () => {
    const withAnalogy = 'Redis is an in-memory data store. Think of it like a high-speed workbench where you keep the tools you reach for most often instead of walking to the garage every time you need something. It is used for caching and sessions.';
    const r = compressTechnicalConcept(withAnalogy, false);
    assert.doesNotMatch(r.text, /think of it like/i);
    assert.match(r.text, /in-memory data store/i);
  });

  test('leaves a clean short spoken answer unchanged', () => {
    const clean = 'Redis is an in-memory data store, used when you need very fast reads and writes like caching, sessions, or rate limits. The tradeoff is memory cost, so you watch eviction and what data really belongs there.';
    const r = compressTechnicalConcept(clean, false);
    assert.equal(r.changed, false);
  });

  test('empty / trivial input is safe', () => {
    assert.equal(compressTechnicalConcept('', false).changed, false);
    assert.equal(compressTechnicalConcept('Short.', false).changed, false);
  });

  // code-review HIGH 2026-06-16: dotted technical tokens must NOT be split ("Node.js" → "Node. js").
  test('preserves dotted technical tokens, decimals, versions, globs', () => {
    const cases = [
      ['Node.js is a runtime built on V8. It runs JavaScript on servers. People use it widely.', /Node\. js/],
      ['Pi is roughly 3.14 in geometry. It appears in circles. It is irrational.', /3\. 14/],
      ['Use version 2.0 of the lib. It fixed a bug. Upgrade soon.', /2\. 0/],
      ['A glob like *.ts matches files. It is used in configs. Shells expand it.', /\*\. ts/],
    ];
    for (const [input, broken] of cases) {
      const r = compressTechnicalConcept(input, false);
      assert.doesNotMatch(r.text, broken, `dotted token was split in: ${r.text}`);
    }
  });

  // code-review MEDIUM 2026-06-16: a header emitted first must not become the lead "sentence".
  test('a header-first tutorial keeps the real definition as the lead (header dropped)', () => {
    const t = '## Overview\n\nCORS is a browser security mechanism that controls cross-origin requests. It uses an Origin header.\n\n## How it works\n\nThe browser sends the header and checks the response.';
    const r = compressTechnicalConcept(t, false);
    assert.match(r.text, /^CORS is a browser security mechanism/, 'lead must be the definition, not "Overview."');
    assert.doesNotMatch(r.text, /\bOverview\b/);
  });

  // code-review LOW 2026-06-16: an UNCLOSED fenced block's raw code must not survive into speech.
  test('an unclosed code fence is dropped (no raw code in the spoken answer)', () => {
    const t = 'A hash map maps keys to values. Here is an example. ```python\nd = {}\nd["a"]=1';
    const r = compressTechnicalConcept(t, false);
    assert.doesNotMatch(r.text, /```|d\[|python/, 'unclosed fence code must be dropped');
    assert.match(r.text, /hash map maps keys to values/i);
  });

  test('idempotent (running twice = once)', () => {
    const once = compressTechnicalConcept(corsTutorial, false);
    const twice = compressTechnicalConcept(once.text, false);
    assert.equal(twice.text, once.text);
  });
});
