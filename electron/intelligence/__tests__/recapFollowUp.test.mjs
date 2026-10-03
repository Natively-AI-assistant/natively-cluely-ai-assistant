// electron/intelligence/__tests__/recapFollowUp.test.mjs
//
// Covers electron/intelligence/context-os/recapFollowUp.ts — the source-contract
// rules appended to recap / refinement prompts and the detector for an explicit
// "switch source" request inside a refinement.
//
// Runs against the compiled output in dist-electron/.
// Run: node --test electron/intelligence/__tests__/recapFollowUp.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
  buildRecapContractRule,
  buildFollowUpContractRule,
  detectFollowUpSourceSwitch,
} = require(path.join(repoRoot, 'dist-electron/electron/intelligence/context-os/recapFollowUp.js'));

const contract = (sourceOwner) => ({ sourceOwner, forbiddenSources: [] });
const OWNERS = ['reference_files', 'profile', 'transcript', 'meeting_rag', 'long_term_memory', 'general'];

describe('buildRecapContractRule', () => {
  test('always restricts the recap to the spoken transcript', () => {
    for (const owner of OWNERS) {
      const lines = buildRecapContractRule(contract(owner)).split('\n');
      assert.equal(lines[0], '## SOURCE CONTRACT (recap)', owner);
      assert.match(lines[1], /^Summarize ONLY what was actually said/, owner);
      assert.match(lines[2], /no resume\/profile facts/, owner);
      assert.match(lines[2], /no prior-session memory/, owner);
    }
  });

  test('document-grounded mode adds the "conversation, not the document" line', () => {
    const lines = buildRecapContractRule(contract('reference_files')).split('\n');
    assert.equal(lines.length, 4);
    assert.match(lines[3], /summarizes the CONVERSATION, not the document/);
  });

  test('every other owner gets exactly the three base lines', () => {
    for (const owner of OWNERS.filter((o) => o !== 'reference_files')) {
      const rule = buildRecapContractRule(contract(owner));
      assert.equal(rule.split('\n').length, 3, owner);
      assert.doesNotMatch(rule, /document-grounded/, owner);
    }
  });

  test('the forbidden-source list does not change the text', () => {
    assert.equal(
      buildRecapContractRule({ sourceOwner: 'profile', forbiddenSources: ['hindsight_memory', 'profile_jd'] }),
      buildRecapContractRule(contract('profile')),
    );
  });
});

describe('buildFollowUpContractRule', () => {
  const SWITCH_LINE = /switching sources needs a fresh question/;

  test('always forbids new factual claims and ends with the source-switch refusal', () => {
    for (const owner of OWNERS) {
      const lines = buildFollowUpContractRule(contract(owner)).split('\n');
      assert.equal(lines[0], '## SOURCE CONTRACT (refinement)', owner);
      assert.match(lines[1], /^You are EDITING the previous answer/, owner);
      assert.match(lines[2], /Do not introduce ANY new factual claim/, owner);
      assert.match(lines.at(-1), SWITCH_LINE, owner);
    }
  });

  test('reference_files inherits the uploaded-material-only grounding', () => {
    const lines = buildFollowUpContractRule(contract('reference_files')).split('\n');
    assert.equal(lines.length, 5);
    assert.match(lines[3], /grounded in uploaded material only/);
    assert.match(lines[3], /Do not add resume\/profile facts/);
  });

  test('profile inherits the candidate-profile grounding', () => {
    const lines = buildFollowUpContractRule(contract('profile')).split('\n');
    assert.equal(lines.length, 5);
    assert.match(lines[3], /grounded in the candidate profile/);
    assert.match(lines[3], /Do not add uploaded-document facts/);
  });

  test('other owners get no owner-specific line', () => {
    for (const owner of ['transcript', 'meeting_rag', 'long_term_memory', 'general']) {
      const rule = buildFollowUpContractRule(contract(owner));
      assert.equal(rule.split('\n').length, 4, owner);
      assert.doesNotMatch(rule, /was grounded in/, owner);
    }
  });
});

describe('detectFollowUpSourceSwitch', () => {
  test('detects a switch to the profile', () => {
    for (const q of [
      'answer from my resume instead',
      'Use my CV',
      'based on my background, redo it',
      'rewrite this using my experience',
      'pull it from my profile',
    ]) {
      assert.equal(detectFollowUpSourceSwitch(q), 'profile', q);
    }
  });

  test('detects a switch to the uploaded material', () => {
    for (const q of [
      'use the document',
      'answer from the uploaded slides',
      'based on the pdf',
      'take it from the thesis',
      'using the material I gave you',
      'use file instead',
    ]) {
      assert.equal(detectFollowUpSourceSwitch(q), 'reference_files', q);
    }
  });

  test('detects a switch to the conversation', () => {
    for (const q of [
      'answer from the meeting',
      'use the transcript',
      'based on the conversation so far',
      'from the call, please',
    ]) {
      assert.equal(detectFollowUpSourceSwitch(q), 'transcript', q);
    }
  });

  test('is case-insensitive', () => {
    assert.equal(detectFollowUpSourceSwitch('ANSWER FROM MY RESUME'), 'profile');
    assert.equal(detectFollowUpSourceSwitch('Use The Document'), 'reference_files');
    assert.equal(detectFollowUpSourceSwitch('BASED ON THE TRANSCRIPT'), 'transcript');
  });

  test('plain refinements are not a source switch', () => {
    for (const q of [
      'make it shorter',
      'more confident please',
      'add a concrete example',
      'rephrase in simpler words',
      'translate to Spanish',
    ]) {
      assert.equal(detectFollowUpSourceSwitch(q), null, q);
    }
  });

  test('a source noun without a switch verb is not a switch', () => {
    assert.equal(detectFollowUpSourceSwitch('my resume is too long'), null);
    assert.equal(detectFollowUpSourceSwitch('the document was boring'), null);
    assert.equal(detectFollowUpSourceSwitch('the meeting ran late'), null);
  });

  test('the profile needs the possessive: "the resume" alone is not a profile switch', () => {
    assert.equal(detectFollowUpSourceSwitch('use the resume'), null);
  });

  test('word boundaries: lookalike words do not trigger', () => {
    assert.equal(detectFollowUpSourceSwitch('use the recall metric'), null);
    assert.equal(detectFollowUpSourceSwitch('reuse my resume'), null);
    assert.equal(detectFollowUpSourceSwitch('based on my resumes'), null);
  });

  test('the verb and the source must be in the same sentence', () => {
    assert.equal(detectFollowUpSourceSwitch('Make it shorter than what I use. My resume is unrelated'), null);
    assert.equal(detectFollowUpSourceSwitch('Which one should I use? The document is long'), null);
    assert.equal(detectFollowUpSourceSwitch('Stop using that! The meeting is over'), null);
  });

  test('the verb and the source must be close together (30 characters)', () => {
    const near = `use ${'x'.repeat(25)} my resume`;
    const far = `use ${'x'.repeat(40)} my resume`;
    assert.equal(detectFollowUpSourceSwitch(near), 'profile');
    assert.equal(detectFollowUpSourceSwitch(far), null);
  });

  test('when several sources are named, profile wins over document wins over transcript', () => {
    assert.equal(detectFollowUpSourceSwitch('use my resume and the document'), 'profile');
    assert.equal(detectFollowUpSourceSwitch('use the document and the meeting'), 'reference_files');
    assert.equal(detectFollowUpSourceSwitch('use the meeting and my resume'), 'profile');
  });

  test('empty, missing and non-string input is "no switch"', () => {
    for (const q of ['', '   ', null, undefined, 0, false]) {
      assert.equal(detectFollowUpSourceSwitch(q), null, String(q));
    }
  });

  test('repeated calls give the same answer (no regex state leaks)', () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(detectFollowUpSourceSwitch('answer from my resume instead'), 'profile');
      assert.equal(detectFollowUpSourceSwitch('make it shorter'), null);
    }
  });
});
