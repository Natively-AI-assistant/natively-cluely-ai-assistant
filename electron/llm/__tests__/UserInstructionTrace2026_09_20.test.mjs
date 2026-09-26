// electron/llm/__tests__/UserInstructionTrace2026_09_20.test.mjs
//
// The user report ended: "Is there a way to inspect/log the final prompt +
// resolved coding format sent to the model on a failing turn?" There was not —
// the six causes in userInstructionContract.ts were each found by probing
// built code by hand. This trace is the answer: one PII-free record per turn
// of what the instruction analysis resolved and what the app did about it.
// Content (the prompts themselves) is logged under `*Prompt` keys, which
// redactForLog hides at 'standard' and keeps verbatim at 'full'.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjs = createRequire(import.meta.url);
const { describeUserInstructionDelivery } = cjs(path.resolve(__dirname, '../../../dist-electron/electron/llm/userInstructionContract.js'));
const { redactValue } = cjs(path.resolve(__dirname, '../../../dist-electron/electron/utils/redactForLog.js'));

describe('the delivery record', () => {
  test('reports what was resolved and that the app length stood down', () => {
    const d = describeUserInstructionDelivery({ instructions: 'Answer in 100 words.\nUse Java only', defaultLengthDirective: 'LENGTH: roughly 40 to 60 words' });
    assert.equal(d.delivered, true);
    assert.equal(d.instructionChars, 'Answer in 100 words.\nUse Java only'.length);
    assert.deepEqual(d.length, { unit: 'words', count: 100, bound: 'about' });
    assert.equal(d.programmingLanguage, 'Java');
    assert.equal(d.definesAnswerStructure, false);
    assert.equal(d.appLength, 'suppressed_by_user');
  });

  test('app length rides as a default when the user set none', () => {
    assert.equal(describeUserInstructionDelivery({ instructions: 'Use Java only', defaultLengthDirective: 'LENGTH: …' }).appLength, 'sent_as_default');
  });

  test('no instructions: the record says so — the fastest way to spot a delivery failure', () => {
    const d = describeUserInstructionDelivery({ instructions: '', defaultLengthDirective: 'LENGTH: …' });
    assert.equal(d.delivered, false);
    assert.equal(d.instructionChars, 0);
    assert.equal(d.appLength, 'sent_as_default');
    assert.equal(describeUserInstructionDelivery({}).appLength, 'none');
  });

  test('the record itself carries NO user text', () => {
    const d = describeUserInstructionDelivery({ instructions: 'SECRET_PHRASE answer in 100 words' });
    assert.doesNotMatch(JSON.stringify(d), /SECRET_PHRASE/);
  });
});

describe('prompts logged beside it are level-gated by key name', () => {
  const payload = { delivery: { delivered: true }, systemPrompt: 'SYSTEM SECRET', userPrompt: 'USER SECRET' };
  test("'standard' hides the prompts and keeps the record", () => {
    const out = JSON.stringify(redactValue(payload, 'standard'));
    assert.doesNotMatch(out, /SYSTEM SECRET|USER SECRET/);
    assert.match(out, /"delivered":true/);
  });
  test("'full' keeps them verbatim — a log that hides the prompt cannot explain the answer", () => {
    const out = JSON.stringify(redactValue(payload, 'full'));
    assert.match(out, /SYSTEM SECRET/);
    assert.match(out, /USER SECRET/);
  });
});
