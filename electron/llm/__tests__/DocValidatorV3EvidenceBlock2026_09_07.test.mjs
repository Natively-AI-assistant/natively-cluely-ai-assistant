// The post-stream document-grounded validator must read the evidence format
// it is actually handed (2026-09-07).
//
// THE DEFECT. `computeEvidenceCoverage` splits the retrieved block on
// `<snippet>` tags and keeps only pieces matching `/<text>|\[Section/`. T4
// (2026-08-28) correctly pointed the WTA validator at the evidence V3 SENT —
// `requestSnapshot.v3Prompt.evidenceBlock` — but V3's context-packer renders
// `<evidence …>…</evidence>` blocks, which that splitter does not recognise.
// Result: zero snippets, hasNumericEvidence=false, and on every
// `exact_numeric_answer`-shaped question the CORRECT streamed answer was
// overwritten with "I could not find that in the retrieved sections of the
// document." (measured 5/5 on a 120k-char corpus, 2026-09-07).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd());
const {
  computeEvidenceCoverage,
  validateDocumentGroundedAnswer,
} = require(path.join(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js'));

const QUESTION = 'How many retailers did PriceX cover?';
const ANSWER = 'PriceX covered 14 retailers.';
const FACT = 'Founder, PriceX (2022–2024). Price-comparison website covering 14 retailers; sold to a strategic acquirer.';

const v3Block = (content) =>
  `<evidence evidence_id="ev-0" source_type="CANDIDATE_FILE" source_id="ref_1" version_id="legacy" scope_id="u:local" `
  + `section="Experience" source_name="resume.pdf" provenance="MODE_REFERENCE_FILE" authority="DOCUMENT_FACT" direct_fact="true">\n`
  + `${content}\n</evidence>`;
const legacyBlock = (content) => `<snippet><text>${content}</text></snippet>`;
const sectionBlock = (content) => `[Section 2.1 | Experience]\n${content}`;

describe('computeEvidenceCoverage reads every evidence format the validator receives', () => {
  for (const [name, block] of [['legacy <snippet><text>', legacyBlock(FACT)], ['[Section …] prefix', sectionBlock(FACT)], ['V3 <evidence>', v3Block(FACT)]]) {
    test(`${name}: numeric evidence is seen`, () => {
      const c = computeEvidenceCoverage({ question: QUESTION, retrievedBlock: block });
      assert.equal(c.queryShape, 'exact_numeric_answer');
      assert.equal(c.hasNumericEvidence, true, `${name}: ${JSON.stringify(c)}`);
      assert.equal(c.shouldRefuse, false, `${name}: ${c.reason}`);
    });
  }

  test('V3 block with several evidence items scores each item, not the concatenation', () => {
    const block = [v3Block('Education: B.Tech Computer Science (2014–2018).'), v3Block(FACT)].join('\n\n');
    const c = computeEvidenceCoverage({ question: QUESTION, retrievedBlock: block });
    assert.equal(c.hasNumericEvidence, true);
    assert.ok(c.topAnswerability > 0, 'per-item answerability must be scored');
  });
});

describe('validateDocumentGroundedAnswer ships a correct answer grounded in V3 evidence', () => {
  test('ships on the V3 <evidence> format (the WTA post-stream path)', () => {
    const v = validateDocumentGroundedAnswer({ question: QUESTION, answer: ANSWER, retrievedBlock: v3Block(FACT) });
    assert.equal(v.action, 'ship', `${v.reason} ${JSON.stringify(v.coverage)}`);
    assert.equal(v.ok, true);
  });

  test('parity: the identical answer ships on the legacy formats', () => {
    for (const block of [legacyBlock(FACT), sectionBlock(FACT)]) {
      const v = validateDocumentGroundedAnswer({ question: QUESTION, answer: ANSWER, retrievedBlock: block });
      assert.equal(v.action, 'ship', v.reason);
    }
  });

  test('a genuinely absent value still refuses on the V3 format (guard is not weakened)', () => {
    const v = validateDocumentGroundedAnswer({
      question: QUESTION,
      // A measured value (number + unit) the evidence never states. (A bare
      // count such as "42 retailers" is not unit-anchored and is deliberately
      // not a token — see NUM_UNIT_RE.)
      answer: 'PriceX covered 42 retailers and processed 9 GB of pricing data daily.',
      retrievedBlock: v3Block('Founder, Natively (2025–present). Live-meeting copilot.'),
    });
    assert.notEqual(v.action, 'ship', 'an unsupported measured value must not ship');
  });
});

describe('duration units compare across spellings (2026-09-07)', () => {
  const SOW = 'Milestones:\n1. Discovery and architecture (40 hr).\n2. Backend integration (80 hr).\n3. UI integration (60 hr).';
  test('"80 hours" in the answer is supported by "(80 hr)" in the evidence', () => {
    const v = validateDocumentGroundedAnswer({ question: 'How many hours is milestone 2?', answer: 'Milestone 2, Backend integration, is **80 hours**.', retrievedBlock: v3Block(SOW) });
    assert.equal(v.action, 'ship', `${v.reason} ${JSON.stringify(v.missing)}`);
  });
  test('"27 minutes" vs "27 min", "2 weeks" vs "2 wks"', () => {
    for (const [answer, block] of [
      ['It locked writes for 27 minutes.', 'locked writes for 27 min during peak hour'],
      ['The rollout takes 2 weeks.', 'rollout: 2 wks'],
    ]) {
      const v = validateDocumentGroundedAnswer({ question: 'How many minutes did it lock writes for?', answer, retrievedBlock: v3Block(block) });
      assert.equal(v.action, 'ship', `${answer} :: ${v.reason} ${JSON.stringify(v.missing)}`);
    }
  });
  test('a duration the evidence does not state is still unsupported', () => {
    const v = validateDocumentGroundedAnswer({ question: 'How many hours is milestone 2?', answer: 'Milestone 2 is 95 hours.', retrievedBlock: v3Block(SOW) });
    assert.notEqual(v.action, 'ship');
  });
});

describe('the question\'s own subject is never an unsupported named entity (2026-09-07)', () => {
  const { detectUnsupportedDocumentAnswer } = require(path.join(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js'));
  test('"Milestone 2" / "Step 4" / "Module 4" restated from the question ship', () => {
    for (const [q, a, block] of [
      ['How many hours is milestone 2?', 'Milestone 2 is 80 hours.', '2. Backend integration (80 hr).'],
      ['What does step 4 of the onboarding checklist require?', 'Step 4 requires audio device approval.', 'Step 4: Step 4 requires audio device approval — pick your mic.'],
      ['What topics are in Module 4?', 'Module 4 covers the method of characteristics and Fourier series.', '## Module 4 — Wave and heat equations\n- Method of characteristics.\n- Fourier series solutions.'],
    ]) {
      const v = validateDocumentGroundedAnswer({ question: q, answer: a, retrievedBlock: v3Block(block) });
      assert.equal(v.action, 'ship', `${q} :: ${v.reason} ${JSON.stringify(v.missing)}`);
    }
  });
  test('an entity the question did NOT mention is still checked against the evidence', () => {
    const r = detectUnsupportedDocumentAnswer({ question: 'What backbone does the tool use?', answer: 'It uses Gemma 3 12B.', retrievedBlock: 'The visual backbone is OpenVLA-OFT.' });
    assert.equal(r.unsupported, true);
    assert.equal(r.reason, 'unsupported_named_entity');
  });
});

describe('dates and ordinal labels are not named-entity claims (2026-09-07)', () => {
  const { extractNamedEntityClaims } = require(path.join(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js'));
  test('"April 10, 2026" against evidence written as 2026-04-10 ships', () => {
    const v = validateDocumentGroundedAnswer({
      question: 'What was the root cause of INC-119?',
      answer: 'A bad migration on April 10, 2026 added a NOT NULL column without a default and locked writes for 27 minutes.',
      retrievedBlock: v3Block('Root cause INC-119: bad migration on 2026-04-10. The migration to add a NOT NULL column ran without a default and locked writes for 27 minutes.'),
    });
    assert.equal(v.action, 'ship', `${v.reason} ${JSON.stringify(v.missing)}`);
  });
  test('calendar and ordinal tokens are skipped; product names are kept', () => {
    const e = extractNamedEntityClaims('On April 10 in Q3 we shipped Gemma 3 12B on Step 4 of the rollout; see Module 4 and OpenVLA-OFT.');
    assert.ok(!e.has('april 10') && !e.has('q3') && !e.has('step 4') && !e.has('module 4'), JSON.stringify([...e]));
    assert.ok(e.has('gemma 3 12b') || e.has('gemma 3'), JSON.stringify([...e]));
    assert.ok(e.has('openvla-oft') || e.has('openvla'), JSON.stringify([...e]));
  });
});

describe('completeness is judged against values near the question\'s terms (2026-09-07)', () => {
  const { detectIncompleteNumericAnswer } = require(path.join(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js'));
  const SOW = 'Statement of Work — Halcyon integration\n\nSOW scope: 4 milestones; rate $140/hr; cap 200 hours.\n\nMilestones:\n1. Discovery and architecture (40 hr).\n2. Backend integration (80 hr).\n3. UI integration (60 hr).\n4. Handoff and documentation (20 hr).';
  test('"hourly rate and hour cap" is complete without the four milestone durations', () => {
    const v = validateDocumentGroundedAnswer({ question: 'What is the hourly rate and the hour cap in the SOW?', answer: 'The hourly rate is **$140/hr** and the cap is **200 hours**.', retrievedBlock: v3Block(SOW) });
    assert.equal(v.action, 'ship', `${v.reason} ${JSON.stringify(v.missing)}`);
  });
  test('a genuinely partial list of the SAME set is still incomplete', () => {
    const block = 'Hardware: training used 8 NVIDIA P100 GPUs with 16 GB memory each; inference hardware used 2 GPUs with 24 GB memory.';
    const r = detectIncompleteNumericAnswer({ question: 'What hardware and how much memory were used?', answer: 'Training used 16 GB of memory per GPU.', retrievedBlock: block });
    assert.equal(r.incomplete, true, JSON.stringify(r));
    assert.ok(r.missing.includes('24gb'), JSON.stringify(r));
  });
  test('with no topical line the legacy same-unit rule is unchanged', () => {
    const block = 'Alpha: 25 Hz. Beta: 50 Hz.';
    const r = detectIncompleteNumericAnswer({ question: 'List the rates.', answer: 'It runs at 25 Hz.', retrievedBlock: block });
    assert.equal(r.incomplete, true, JSON.stringify(r));
  });
});
