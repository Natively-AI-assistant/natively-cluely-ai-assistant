// A typed refinement of the previous reply — "shorter", "simpler please",
// "another one, less pushy" — came back as a near-copy: the resolver anchors it
// as `shorter (rephrasing request: how to phrase the answer to "…")` and the
// model answered the earlier question again at the same length (50 words -> 49,
// 112 -> 97-101). The composer now names the previous reply as the thing to
// revise and gives a word budget computed from it. See refinementNotice in
// electron/context-intelligence/generation/prompt-composer.ts.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refinementNotice, previousAssistantReply } from '../../../dist-electron/electron/context-intelligence/generation/prompt-composer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPOSER = fs.readFileSync(path.join(HERE, '..', 'generation', 'prompt-composer.ts'), 'utf8');

const REPLY = "I don't want to quote you a number I can't stand behind, so let me confirm exactly what support hours and uptime commitment sit on the mid tier and come straight back to you. While I do, what does your team actually need covered, business hours or around the clock?";
const CONVO = `[ME]: what do I say\n\nUser: she wants to know what support hours we give. what do I say\nAssistant: ${REPLY}\n\n[[GIST]] confirm mid-tier support, ask coverage need`;
const marked = (request) => `${request} (rephrasing request: how to phrase the answer to "she wants to know what support hours we give. what do I say")`;

describe('the previous reply is found in the conversation block', () => {
  test('the last Assistant line, without its summary chip', () => {
    assert.equal(previousAssistantReply(CONVO), REPLY);
  });
  test('the last of several, and the spoken-surface label too', () => {
    assert.equal(previousAssistantReply('User: a\nAssistant: first reply here.\nUser: b\nAssistant: second reply here.'), 'second reply here.');
    assert.equal(previousAssistantReply('[ME]: hi\n[ASSISTANT (PREVIOUS SUGGESTION)]: say this to them.\n[INTERVIEWER]: ok'), 'say this to them.');
  });
  test('none → empty', () => {
    assert.equal(previousAssistantReply('User: only me so far'), '');
    assert.equal(previousAssistantReply(undefined), '');
  });
});

describe('a typed refinement names the previous reply and its length', () => {
  test('"shorter" gets half the previous reply\'s words as a budget', () => {
    const n = REPLY.split(/\s+/).length;
    const notice = refinementNotice(marked('shorter'), CONVO);
    assert.match(notice, /^# Revise your previous reply\n/);
    assert.match(notice, new RegExp(`is about your LAST reply above \\(${n} words\\), not a new question`));
    assert.match(notice, new RegExp(`in at most ${Math.ceil(n / 2)} words`));
    assert.match(notice, /Do not answer the earlier question afresh/);
  });
  test('"simpler please" gets plainer words and a 70% budget', () => {
    const n = REPLY.split(/\s+/).length;
    const notice = refinementNotice(marked('simpler please'), CONVO);
    assert.match(notice, /plainer words and shorter sentences/);
    assert.match(notice, new RegExp(`in at most ${Math.ceil(n * 0.7)} words`));
  });
  test('"another one, less pushy" asks for a different one', () => {
    const notice = refinementNotice(marked('another one, less pushy'), CONVO);
    assert.match(notice, /Give a DIFFERENT one that applies the change they asked for/);
    assert.match(notice, /"another one, less pushy"/);
  });
  test('the budget never asks for fewer than 8 words', () => {
    const notice = refinementNotice(marked('shorter'), 'User: q\nAssistant: one two three four five six seven eight nine ten.');
    assert.match(notice, /in at most 8 words/);
  });
});

describe('everything else is left exactly as it was', () => {
  test('a turn the resolver did not mark as a rephrasing request', () => {
    assert.equal(refinementNotice('shorter', CONVO), '');
    assert.equal(refinementNotice('another one, different numbers (follow-up to: "build a heap")', CONVO), '');
  });
  test('a rephrasing request that is not one of the three kinds', () => {
    assert.equal(refinementNotice(marked('what should I say'), CONVO), '');
    assert.equal(refinementNotice(marked('more confident'), CONVO), '');
  });
  test('a HEARD "shorter" is not addressed to the assistant', () => {
    assert.equal(refinementNotice(marked('shorter'), CONVO, true), '');
  });
  test('no previous reply, or one too short to shorten', () => {
    assert.equal(refinementNotice(marked('shorter'), 'User: only me'), '');
    assert.equal(refinementNotice(marked('shorter'), 'User: q\nAssistant: Yes, it does.'), '');
  });
  test('a previous reply that holds code is not rewritten by word count', () => {
    assert.equal(refinementNotice(marked('shorter'), 'User: q\nAssistant: Here it is:\n```js\nconst a = 1; const b = 2; const c = a + b;\n```\nThat adds the two numbers together for you.'), '');
  });
});

describe('where it sits in the prompt', () => {
  test('with the other per-turn notices, after the calculation notice, typed turns only', () => {
    const i = COMPOSER.indexOf("push('calculation', calculationNotice(");
    const j = COMPOSER.indexOf("push('refinement', refinementNotice(d.resolvedQuestion, input.conversationSummary, input.heardQuestion === true))");
    const k = COMPOSER.indexOf("push('list_form'");
    assert.ok(i > 0 && j > i && k > j);
  });
});
