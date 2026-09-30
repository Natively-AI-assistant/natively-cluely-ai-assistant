// electron/llm/__tests__/MetaPreambleGate2026_09_30.test.mjs
//
// Visible meta reasoning at the START of an answer (2026-09-30):
//   "The interviewer's question is…", "The user is asking…", "They want to
//   know how I'd…", "Okay, so I should frame…", "Here's how I'd answer:",
//   "Here's what you can say:", "Answer:" on its own line.
// None matched stripPlanningPreamble or stripMetaPreamble, and the default
// typed path (V3) streamed raw tokens with no filter at all.
//
//   1. stripPlanningPreamble: the new phrasings are removed, only at the start,
//      and legitimate first sentences survive (false-positive list).
//   2. PreambleStreamGate: for every fixture and several chunkings, what the
//      gate emits equals stripPlanningPreamble(full).text — the invariant that
//      makes the hotkey final equal the streamed text (no visible swap) and the
//      typed finalText equal what was streamed.
//   3. asksAboutTheQuestion: the typed-path opt-out.
//   4. Wiring: typed V3 loop and the hotkey paint path use the gate.
//
// Pure string logic + source reads; identical on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.resolve(repoRoot, 'dist-electron/electron/llm/', p)).href;
const {
  stripPlanningPreamble, PreambleStreamGate, asksAboutTheQuestion, PREAMBLE_GATE_MAX_HOLD_CHARS,
} = await import(dist('planningPreamble.js'));
const SRC = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

const REAL = "I'd shard by tenant first, then move the hot tables to read replicas.";

const POSITIVES = [
  ["interviewer's question", `The interviewer's question is about scaling the payment service. ${REAL}`],
  ['the user is asking', `The user is asking how I would scale the service. ${REAL}`],
  ['they want to know (about me)', `They want to know how I'd scale it under load. ${REAL}`],
  ['okay, so I should frame', `Okay, so I should frame this around impact. ${REAL}`],
  ["here's how I'd answer:", `Here's how I'd answer: ${REAL}`],
  ["here's what you can say:", `Here's what you can say:\n\n${REAL}`],
  ['here is what to say:', `Here is what to say: ${REAL}`],
  ["here's a response:", `Here's a response: ${REAL}`],
  ['the question is asking', `The question is asking whether I have run this at scale. ${REAL}`],
  ['so the user wants', `So the user wants me to explain the sharding plan. ${REAL}`],
  ['Answer: on its own line', `Answer:\n${REAL}`],
  ['**Answer:** on its own line', `**Answer:**\n${REAL}`],
  ['two preamble sentences in a row', `The interviewer wants to know about scale. The question is really asking for a plan. ${REAL}`],
  ['preamble then paragraph break', `The user is asking about scaling.\n\n${REAL}`],
  ['curly apostrophes', `The interviewer’s question is about scaling. Here’s how I’d answer: ${REAL}`],
];

const NEGATIVES = [
  ['plain first-person answer', REAL],
  ['"The question is a good one" spoken to the other party', "The question is a good one, and I'd start with the data model."],
  ['"The question is whether…" as content', 'The question is whether we shard or scale up, and I would shard.'],
  ['stakeholders "they want to know" without the speaker as object', 'They want to know the timeline, so I send weekly updates.'],
  ['"I\'ll start with" is content', "I'll start with the database layer, because that is where the load lands."],
  ['"The user base grew" is content', 'The user base grew three times in a year, so we moved to Kafka.'],
  ['"The user wants a faster checkout" is content', 'The user wants a faster checkout, so we cut two steps.'],
  ['"Here\'s the thing:" is content', "Here's the thing: we moved to Kafka because the queue kept backing up."],
  ['"Answer: yes" on one line is left alone', 'Answer: yes, we ran it at 40k requests a second.'],
  ['"So I built…" is content', 'So I built the ingestion pipeline in Rust.'],
  ['code answer', '```python\ndef two_sum(nums, target):\n    return []\n```'],
  ['mid-answer meta sentence stays', `${REAL} The interviewer is asking about cost too, so I'd mention reserved instances.`],
  ['heading answer', '## Approach\nUse a hash map.'],
];

describe('stripPlanningPreamble: the new phrasings', () => {
  for (const [name, text] of POSITIVES) {
    test(`strips: ${name}`, () => {
      const r = stripPlanningPreamble(text);
      assert.equal(r.repaired, true, name);
      assert.equal(r.text, REAL, name);
      assert.ok(r.removedSentences >= 1);
    });
  }
  for (const [name, text] of NEGATIVES) {
    test(`keeps: ${name}`, () => {
      const r = stripPlanningPreamble(text);
      assert.equal(r.repaired, false, name);
      assert.equal(r.text, text, name);
    });
  }
  test('an answer that is only a preamble fails open', () => {
    const only = 'The interviewer is asking about scaling.';
    assert.deepEqual(stripPlanningPreamble(only), { text: only, repaired: false, removedSentences: 0 });
  });
});

/** Feed `text` through a fresh gate in the given chunk sizes; return what it emitted. */
function runGate(text, chunkSize) {
  const gate = new PreambleStreamGate();
  let out = '';
  const pieces = [];
  if (chunkSize === 'whole') pieces.push(text);
  else for (let i = 0; i < text.length; i += chunkSize) pieces.push(text.slice(i, i + chunkSize));
  for (const p of pieces) out += gate.push(p);
  out += gate.flush();
  return { out, gate };
}

describe('PreambleStreamGate: streamed text equals the final strip', () => {
  const CHUNKINGS = [1, 2, 3, 7, 16, 'whole'];
  const fixtures = [...POSITIVES, ...NEGATIVES, ['short answer', 'Yes.'], ['only preamble', 'The user is asking about scaling.']];
  for (const [name, text] of fixtures) {
    test(`parity: ${name}`, () => {
      const expected = stripPlanningPreamble(text).text;
      for (const size of CHUNKINGS) {
        assert.equal(runGate(text, size).out, expected, `${name} @ chunk ${size}`);
      }
    });
  }

  test('a preamble split mid-apostrophe across chunks is still removed', () => {
    const gate = new PreambleStreamGate();
    let out = '';
    for (const p of ['The interviewer', "'", 's question is about sc', 'aling. ', "I'd shard", ' by tenant.']) out += gate.push(p);
    out += gate.flush();
    assert.equal(out, "I'd shard by tenant.");
    assert.equal(gate.removedUnits, 1);
  });

  test('nothing is emitted while the opening is still undecided', () => {
    const gate = new PreambleStreamGate();
    assert.equal(gate.push('The interviewer'), '');
    assert.equal(gate.push("'s question is"), '');
    assert.equal(gate.isReleased, false);
  });

  test('an ordinary opening is released after a few characters, not at its sentence end', () => {
    const gate = new PreambleStreamGate();
    assert.equal(gate.push('Redis is'), 'Redis is');
    assert.equal(gate.isReleased, true);
    assert.equal(gate.push(' fast.'), ' fast.');
  });

  test('a code answer passes straight through', () => {
    const gate = new PreambleStreamGate();
    assert.equal(gate.push('```js\n'), '```js\n');
    assert.equal(gate.push('const a = 1;'), 'const a = 1;');
  });

  test('a short answer under the hold threshold is released on flush', () => {
    const gate = new PreambleStreamGate();
    assert.equal(gate.push('I'), '');
    assert.equal(gate.push("'ll"), '');
    assert.equal(gate.flush(), "I'll");
  });

  test('an all-preamble stream fails open on flush (original text, nothing lost)', () => {
    const text = 'The interviewer is asking about scaling. They want to know how I would do it.';
    assert.equal(runGate(text, 5).out, text);
  });

  test('past the max hold the opening is released unchanged', () => {
    const long = 'The interviewer is asking ' + 'about a very long run-on topic '.repeat(12);
    assert.ok(long.length > PREAMBLE_GATE_MAX_HOLD_CHARS);
    const gate = new PreambleStreamGate();
    let out = '';
    for (let i = 0; i < long.length; i += 10) out += gate.push(long.slice(i, i + 10));
    assert.equal(gate.isReleased, true, 'released before the stream ended');
    out += gate.flush();
    assert.equal(out, long);
  });

  test('empty stream emits nothing', () => {
    assert.equal(runGate('', 'whole').out, '');
  });
});

describe('asksAboutTheQuestion: the typed-path opt-out', () => {
  for (const q of ['What is the interviewer asking?', 'what do they want?', 'Which question did he ask?', 'explain the question', 'What does she mean by that?', "What's the question?", 'What is the customer looking for?']) {
    test(`opts out: ${q}`, () => assert.equal(asksAboutTheQuestion(q), true));
  }
  for (const q of ['How would you scale a payment service?', 'Tell me about a conflict you resolved', 'Write two sum in python', '',
    'Why do you want to work here?', 'What do you want to be doing in five years?', 'What questions do you have for us?']) {
    test(`keeps the gate: ${JSON.stringify(q)}`, () => assert.equal(asksAboutTheQuestion(q), false));
  }
});

describe('wiring', () => {
  const ipc = SRC('electron/ipcHandlers.ts');
  const engine = SRC('electron/IntelligenceEngine.ts');

  test('typed V3: every token goes through the gate, finalText is only what was emitted, flushed before done', () => {
    const start = ipc.indexOf('if (!callerOwnsPrompt && isContextIntelligenceV3Enabled()) {');
    const v3 = ipc.slice(start, ipc.indexOf('} catch (v3Err: any) {', start));
    assert.match(v3, /pp\.asksAboutTheQuestion\(String\(message \|\| ''\)\) \? null : new pp\.PreambleStreamGate\(\)/);
    assert.match(v3, /const emitV3Visible = \(visible: string\) => \{\s*if \(!visible\) return;\s*finalText \+= visible;\s*event\.sender\.send\('gemini-stream-token', visible/);
    const loop = v3.slice(v3.indexOf('for await (const tok of v3Stream.stream)'), v3.indexOf("event.sender.send('gemini-stream-done'"));
    assert.doesNotMatch(loop, /finalText \+= tok/, 'raw tokens never reach finalText');
    assert.ok(loop.indexOf('v3PreambleGate.flush()') > 0, 'flushed before done');
  });

  test('hotkey: the gate runs only where the post-stream strip runs, before the first paint', () => {
    assert.match(engine, /const preambleGate = \(!isSpeculative && !codingGate && !isCodingAnswerType\(answerPlan\.answerType\)\)/);
    assert.match(engine, /const paintBuffered = \(token: string\): void => \{\s*if \(preambleGate\) \{\s*token = preambleGate\.push\(token\);\s*if \(!token\) return;/);
    assert.match(engine, /unpainted = stripPlanningPreamble\(fullAnswer\)\.text;/);
    assert.match(engine, /if \(!isSpeculative && fullAnswer && !isCodingAnswerType\(answerPlan\.answerType\)\) \{\s*try \{\s*const \{ stripPlanningPreamble \}/);
  });
});

// Role nouns (2026-09-30, final set: recruiting answers narrated the ask —
// "The candidate is asking about next steps, so give them your own reply…").
describe('role-noun preambles', () => {
  const REPLY = "We'll do a team call next week, then an offer conversation.";
  for (const [label, text] of [
    ['candidate is asking', `The candidate is asking about next steps, so give them your own first-person reply. ${REPLY}`],
    ['prospect wants to know', `The prospect wants to know how pricing scales. ${REPLY}`],
    ['customer is asking', `The customer is asking whether the outage is fixed. ${REPLY}`],
    ['examiner asks for an explanation', `The examiner asks for an explanation of the sample size. ${REPLY}`],
  ]) {
    test(`strips: ${label}`, () => {
      const r = stripPlanningPreamble(text);
      assert.equal(r.text.trim(), REPLY);
      let out = ''; const g = new PreambleStreamGate();
      for (let i = 0; i < text.length; i += 7) out += g.push(text.slice(i, i + 7));
      out += g.flush();
      assert.equal(out.trim(), REPLY);
    });
  }
  for (const text of [
    'The candidate dodged the question about scope, so ask: "What exactly did you own on that migration?"',
    'The customer has been charged twice, so let me check the account now.',
    'The prospect already uses NetSuite, which matters for the sync.',
  ]) {
    test(`keeps: ${text.slice(0, 40)}`, () => {
      assert.equal(stripPlanningPreamble(text).text, text);
    });
  }
});
