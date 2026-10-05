// The overflow guard for a model on this device (electron/llm/localContextTrim).
//
// The old guard dropped lines off the top until the prompt fitted. On a
// diagram turn that cut the design on the table in half: the opening tag and
// the first nodes gone, the rest and the closing tag kept, and a contract in
// the system prompt asking for the whole diagram back with every node kept.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = (rel) => pathToFileURL(path.resolve(here, '../../../dist-electron/electron', rel)).href;
const { trimUserContentToFit, userContentRoomChars, DESIGN_OMITTED_NOTE } = await import(dist('llm/localContextTrim.js'));

/** What the guard did before: lines off the top until it fits, one line always left. */
function oldTrim(text, maxChars) {
  const lines = text.split('\n');
  while (lines.length > 1 && lines.join('\n').length > maxChars) lines.shift();
  return lines.join('\n');
}

const DESIGN = [
  '<active_design view="architecture" version="2">',
  'This is the design currently on the table. It is the starting point for this turn, as the diagram contract describes.',
  '```mermaid',
  'flowchart LR',
  '  client[Client] --> api[API Gateway]',
  '  api --> svc[Order Service]',
  '  svc --> db[(Orders DB)]',
  '  svc --> queue[[Events]]',
  '```',
  '</active_design>',
].join('\n');

const transcript = (n) => Array.from({ length: n }, (_, i) => `[Them]: line ${i + 1} of the meeting, said some time ago`).join('\n');
const SPEECH = (n) => ['<conversation_so_far>', 'What was said in this meeting, most recent last. The drawing asked for in this turn is drawn from this, and from nothing that is not in it.', ...Array.from({ length: n }, (_, i) => `[Me]: point ${i + 1}`), '</conversation_so_far>'].join('\n');

describe('ordinary content is cut exactly as before', () => {
  test('a transcript loses its oldest lines first, and the same ones', () => {
    const text = `CONTEXT:\n${transcript(200)}\n\nUSER:\nWhat did they decide?`;
    for (const max of [0, 1, 40, 500, 2000, 5000, text.length - 1, text.length, text.length + 10]) {
      assert.equal(trimUserContentToFit(text, max), oldTrim(text, max), `max ${max}`);
    }
  });

  test('and so does anything else without a drawing in it (2,000 random prompts)', () => {
    let seed = 20261002;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const words = ['', 'USER:', 'CONTEXT:', '<transcript>', '</transcript>', '[Me]: ok', 'a longer line of ordinary meeting talk', '```', 'flowchart LR', '</active_design>', '<evidence source_type="X">'];
    for (let i = 0; i < 2000; i += 1) {
      const text = Array.from({ length: 1 + rnd(40) }, () => words[rnd(words.length)] + 'x'.repeat(rnd(30))).join('\n');
      const max = rnd(text.length + 20);
      assert.equal(trimUserContentToFit(text, max), oldTrim(text, max));
    }
  });

  test('content that fits is returned untouched', () => {
    const text = `CONTEXT:\n${transcript(3)}\n\n${DESIGN}\n\nUSER:\nAdd a cache.`;
    assert.equal(trimUserContentToFit(text, text.length), text);
  });

  test('one line always remains', () => {
    assert.equal(trimUserContentToFit('a\nb\nthe question', 0), 'the question');
    assert.equal(trimUserContentToFit('only', 0), 'only');
  });

  test('the room is what the old test computed', () => {
    // estimateTokens(sys) + estimateTokens(user) + 2000 <= max, four characters to a token.
    const sys = 'x'.repeat(1001); // 251 tokens
    assert.equal(userContentRoomChars(4096, sys), (4096 - 2000 - 251) * 4);
    assert.equal(userContentRoomChars(1000, sys), 0);
  });
});

describe('the design on the table is never sent in part', () => {
  const text = `CONTEXT:\n${transcript(60)}\n\n${DESIGN}\n\nUSER:\nAdd a cache between the service and the database.`;
  const tail = '\n\nUSER:\nAdd a cache between the service and the database.';

  test('the old guard did send half of it', () => {
    const max = DESIGN.length + tail.length - 200;
    const before = oldTrim(text, max);
    assert.ok(before.includes('</active_design>') && !before.includes('<active_design'), 'a closing tag with no opening one');
    assert.ok(!before.includes('client[Client]') && before.includes('svc --> db[(Orders DB)]'), 'the first nodes gone, the last kept');
  });

  test('older context goes first and the design stays whole', () => {
    const max = DESIGN.length + tail.length + 200;
    const out = trimUserContentToFit(text, max);
    assert.ok(out.length <= max);
    assert.ok(out.includes(DESIGN), 'the block is intact');
    assert.ok(out.endsWith(tail));
    assert.ok(!out.includes('line 1 of the meeting'), 'the oldest lines went');
  });

  test('when it cannot fit, it goes whole and one line says so', () => {
    for (const max of [DESIGN.length + tail.length - 1, DESIGN.length + tail.length - 120, 200]) {
      const out = trimUserContentToFit(text, max);
      assert.ok(out.length <= max, `fits ${max}`);
      assert.ok(!/<\/?active_design/.test(out), 'no tag of it is left');
      assert.ok(!out.includes('flowchart LR') && !out.includes('Orders DB'), 'and none of its source');
      assert.ok(out.includes(DESIGN_OMITTED_NOTE));
      assert.ok(out.endsWith('Add a cache between the service and the database.'), 'the question is kept');
    }
  });

  test('with room for nothing but the question, the question is what is left', () => {
    assert.equal(trimUserContentToFit(text, 60), '\nUSER:\nAdd a cache between the service and the database.');
    assert.equal(trimUserContentToFit(text, 50), 'Add a cache between the service and the database.');
    assert.equal(trimUserContentToFit(text, 60), oldTrim(text, 60), 'which is what the old guard left as well');
  });

  test('an opening tag that is never closed is ordinary text', () => {
    const broken = `CONTEXT:\n<active_design view="architecture">\nflowchart LR\n  a --> b\n\nUSER:\nq`;
    assert.equal(trimUserContentToFit(broken, 20), oldTrim(broken, 20));
  });
});

describe('what was said in the meeting keeps its wrapper while any of it is left', () => {
  const question = '\n\nUSER:\nDraw what we discussed.';
  const text = `CONTEXT:\n${transcript(10)}\n\n${SPEECH(80)}${question}`;

  test('the old guard cut the opening tag and the sentence that says what it is', () => {
    const before = oldTrim(text, 600);
    assert.ok(before.includes('</conversation_so_far>') && !before.includes('<conversation_so_far>'));
  });

  test('now the oldest of it goes and the most recent stays, framed', () => {
    const out = trimUserContentToFit(text, 600);
    assert.ok(out.length <= 600);
    assert.match(out, /^<conversation_so_far>\nWhat was said in this meeting, most recent last\./);
    assert.ok(out.includes('[Me]: point 80') && !out.includes('[Me]: point 1\n'));
    assert.ok(out.includes('</conversation_so_far>'));
    assert.ok(out.endsWith(question));
  });

  test('with no room for any of it, the wrapper goes too', () => {
    const out = trimUserContentToFit(text, 40);
    assert.ok(!/conversation_so_far/.test(out));
    assert.ok(out.endsWith('Draw what we discussed.'));
  });

  test('speech is given up before the design is', () => {
    const both = `CONTEXT:\n${DESIGN}\n\n${SPEECH(80)}${question}`;
    const max = DESIGN.length + question.length + 320;
    const out = trimUserContentToFit(both, max);
    assert.ok(out.length <= max);
    assert.ok(out.includes(DESIGN), 'the design is whole');
    assert.ok(out.includes('[Me]: point 80'), 'and the most recent speech is still there');
    assert.ok(!out.includes('[Me]: point 1\n'));
  });
});

describe('every local-model trim goes through it', () => {
  test('no line-by-line cut is left in LLMHelper', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(path.resolve(here, '../../LLMHelper.ts'), 'utf8');
    assert.equal((source.match(/trimUserContentToFit\(/g) || []).length, 3, 'callOllama, streamWithOllama, fitContextForCurrentModel');
    assert.ok(!/lines\.shift\(\)/.test(source));
  });
});
