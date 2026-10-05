// electron/llm/__tests__/transcriptEntityExtractor.test.mjs
//
// Unit tests for electron/llm/transcriptEntityExtractor.ts — the deterministic
// (no LLM, no I/O) entity extraction that feeds SessionMemory, plus the
// correction-turn and cross-mode-invite predicates.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/transcriptEntityExtractor.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { extractTranscriptEntities, isCorrectionTurn, isExplicitCrossModeInvite } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'transcriptEntityExtractor.js'),
);

const extract = (text, role) => extractTranscriptEntities(text, role);
const kinds = (text, role, kind) => extract(text, role).filter((e) => e.kind === kind).map((e) => e.value);

describe('extractTranscriptEntities: empty and malformed input', () => {
  test('empty, whitespace, null and undefined all return []', () => {
    for (const v of ['', '   ', '\n\t', null, undefined]) {
      assert.deepEqual(extract(v, 'user'), [], JSON.stringify(v));
    }
  });

  test('non-string input is coerced, not thrown on', () => {
    assert.deepEqual(extract(12345, 'user'), []);
  });

  test('plain filler yields nothing', () => {
    assert.deepEqual(extract('Yes.', 'user'), []);
    assert.deepEqual(extract('okay that sounds good to me', 'user'), []);
  });
});

describe('extractTranscriptEntities: skills', () => {
  test('collects every distinct skill in the turn, first spelling wins', () => {
    assert.deepEqual(extract('I used Python and React, also python again in that role', 'user'), [
      { kind: 'skill', value: 'Python' },
      { kind: 'skill', value: 'React' },
    ]);
  });

  test('a CamelCase skill is a skill, and a known CamelCase tech is never a project', () => {
    assert.deepEqual(extract('We used RocksDB and TypeScript heavily there', 'user'), [
      { kind: 'skill', value: 'TypeScript' },
    ]);
  });

  test('a one-word skill answer is a skill, not a project', () => {
    assert.deepEqual(extract('Python.', 'user'), [{ kind: 'skill', value: 'Python' }]);
  });

  test('a repeated skill after a cue word is tagged once and never as a project', () => {
    assert.deepEqual(extract('We deployed on Kafka with a streaming Kafka and Flink pipeline', 'interviewer'), [
      { kind: 'skill', value: 'Kafka' },
    ]);
  });
});

describe('extractTranscriptEntities: projects', () => {
  test('a CamelCase token is a project', () => {
    assert.deepEqual(extract('I built TalentScope over the last year', 'interviewer'), [
      { kind: 'project', value: 'TalentScope' },
    ]);
  });

  test('the same CamelCase project mentioned twice is emitted once', () => {
    assert.deepEqual(kinds('TalentScope shipped, then TalentScope grew a lot', 'interviewer', 'project'), ['TalentScope']);
  });

  test('well-known platform names are not projects', () => {
    assert.deepEqual(extract('It has a lot of GitHub stars right now', 'user'), []);
  });

  test('"tell me about X" cues a project', () => {
    assert.deepEqual(extract('tell me about Natively', 'interviewer'), [{ kind: 'project', value: 'Natively' }]);
  });

  test('"use X" cues a project, but "using X and Y" is a tool list and does not', () => {
    assert.deepEqual(extract('We decided to use Foobar for the mesh layer', 'user'), [{ kind: 'project', value: 'Foobar' }]);
    assert.deepEqual(extract('We were using Foobar and Bazqux for the mesh layer', 'user'), []);
  });

  test('"back to X" cues a project; a bare "to X" does not', () => {
    assert.deepEqual(extract('Going back to Stripe for a moment', 'interviewer'), [{ kind: 'project', value: 'Stripe' }]);
    assert.deepEqual(extract('She reported to Priya for a year', 'interviewer'), []);
  });

  test('a cued stop-word is not a project', () => {
    assert.deepEqual(extract('Can you talk about Today in detail', 'interviewer'), []);
  });

  test('a short proper-noun answer is a project for user, assistant and unknown speakers', () => {
    for (const role of ['user', 'assistant', undefined]) {
      assert.deepEqual(extract('Natively.', role), [{ kind: 'project', value: 'Natively' }], String(role));
    }
  });

  test('the short-answer rule does not apply to the interviewer', () => {
    assert.deepEqual(extract('Natively.', 'interviewer'), []);
  });

  test('up to three words are scanned, each proper noun becomes a project', () => {
    assert.deepEqual(extract('Natively and Cluely', 'user'), [
      { kind: 'project', value: 'Natively' },
      { kind: 'project', value: 'Cluely' },
    ]);
  });

  test('more than three words disables the short-answer rule', () => {
    assert.deepEqual(extract('Natively was really fun', 'user'), []);
  });

  test('a cued name in a longer sentence is tagged exactly once', () => {
    assert.deepEqual(extract('It was called Natively I think', 'assistant'), [{ kind: 'project', value: 'Natively' }]);
  });
});

describe('extractTranscriptEntities: companies, owners, topics', () => {
  test('customer / talking-to cues tag a company', () => {
    assert.deepEqual(extract('our customer Acme signed last week', 'interviewer'), [{ kind: 'company', value: 'Acme' }]);
    assert.deepEqual(extract('we are talking to Globex next', 'interviewer'), [{ kind: 'company', value: 'Globex' }]);
  });

  test('a stop-word after a company cue is ignored', () => {
    assert.deepEqual(extract('the client Today is unhappy', 'interviewer'), []);
  });

  test('an action-item owner becomes a decision', () => {
    assert.deepEqual(extract('Action item owner Priya will follow up', 'interviewer'), [{ kind: 'decision', value: 'Priya' }]);
    assert.deepEqual(extract('that is assigned to Rahul for now', 'interviewer'), [{ kind: 'decision', value: 'Rahul' }]);
  });

  test('a named technical topic is tagged, preserving the spoken casing', () => {
    assert.deepEqual(extract('can you explain dynamic programming to me', 'interviewer'), [
      { kind: 'topic', value: 'dynamic programming' },
    ]);
    assert.deepEqual(kinds('walk me through BFS on a grid', 'interviewer', 'topic'), ['BFS']);
  });

  test('one turn can carry several kinds, skills first', () => {
    const out = extract('our customer Acme wants rate limiting built in Python', 'interviewer');
    assert.deepEqual(out, [
      { kind: 'skill', value: 'Python' },
      { kind: 'company', value: 'Acme' },
      { kind: 'topic', value: 'rate limiting' },
    ]);
  });
});

describe('extractTranscriptEntities: compensation', () => {
  test('a salary figure is tagged comp + sensitive with the trimmed turn as value', () => {
    assert.deepEqual(extract('  I expect 120k base  ', 'interviewer'), [
      { kind: 'comp', value: 'I expect 120k base', sensitive: true },
    ]);
  });

  test('lpa figures, currency symbols and comp phrases are all detected', () => {
    for (const t of ['around 25 lpa', 'they offered $95000', 'what is your base salary expectation', 'the signing bonus matters', '150000 per year']) {
      const out = extract(t, 'interviewer');
      assert.equal(out[0]?.kind, 'comp', t);
      assert.equal(out[0]?.sensitive, true, t);
    }
  });

  test('the comp value is capped at 80 characters', () => {
    const text = 'x'.repeat(100) + ' $5';
    const [comp] = extract(text, 'interviewer');
    assert.equal(comp.kind, 'comp');
    assert.equal(comp.value, 'x'.repeat(80));
  });

  test('comp comes first and other entities are still extracted', () => {
    const out = extract('my expected salary for the Python role', 'interviewer');
    assert.deepEqual(out, [
      { kind: 'comp', value: 'my expected salary for the Python role', sensitive: true },
      { kind: 'skill', value: 'Python' },
    ]);
  });

  test('only comp entities carry the sensitive flag', () => {
    const out = extract('tell me about Natively and your Python work', 'interviewer');
    assert.ok(out.length > 0);
    assert.ok(out.every((e) => !('sensitive' in e)));
  });
});

describe('isCorrectionTurn', () => {
  test('recognises each correction cue, case-insensitively', () => {
    for (const t of ['Actually, it was Go', 'CORRECTION: three years', 'use Redis instead', "let's use Redis", 'lets use Redis', 'we moved to GCP', 'scratch that', 'I meant Postgres']) {
      assert.equal(isCorrectionTurn(t), true, t);
    }
  });

  test('ordinary turns and cue look-alikes are not corrections', () => {
    for (const t of ['I worked there for three years', 'that is factually correct', 'the corrections department', '']) {
      assert.equal(isCorrectionTurn(t), false, t);
    }
  });

  test('null and undefined are false', () => {
    assert.equal(isCorrectionTurn(null), false);
    assert.equal(isCorrectionTurn(undefined), false);
  });
});

describe('isExplicitCrossModeInvite', () => {
  test('a profile/project object after use/with/in/from is an invite', () => {
    for (const t of ['use my project as the example', 'Did you do this in your portfolio', 'with the Natively codebase', 'from your own project', 'using my own code']) {
      assert.equal(isExplicitCrossModeInvite(t), true, t);
    }
  });

  test('"in natively" alone is an invite', () => {
    assert.equal(isExplicitCrossModeInvite('how did you do that in Natively'), true);
  });

  test('"have you used ... in your work/experience" is an invite within one sentence', () => {
    assert.equal(isExplicitCrossModeInvite('have you used caching in your work'), true);
    assert.equal(isExplicitCrossModeInvite('Have you implemented rate limiting in your experience?'), true);
    assert.equal(isExplicitCrossModeInvite('have you used it? in your experience'), false);
  });

  test('benign phrasing is not an invite', () => {
    for (const t of ['I learned that in college', 'explain bfs', 'solve this with a hash map', 'in my experience it depends', '']) {
      assert.equal(isExplicitCrossModeInvite(t), false, t);
    }
  });

  test('null and undefined are false', () => {
    assert.equal(isExplicitCrossModeInvite(null), false);
    assert.equal(isExplicitCrossModeInvite(undefined), false);
  });
});
