// #744: three lines of a candidate's Real-time prompt never reached identity or
// behavioural answers.
//  - "about 40M deliveries a day": the money pattern read "40M" as an amount.
//  - an incident story with "$9k" in it: the currency branch gated it to
//    negotiation answers only.
//  - "Stories: Go rewrite vs N+1 queries ...": the instruction extractor peeled
//    "Stories:" and read "Go" as the verb, so the facts filter dropped the line.
// Salary and pricing lines must still be withheld.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { classifyCustomContext, selectCustomContextFactsForAnswer } = await import(dist('customContextClassifier.js'));
const { isDirectiveShaped } = await import(dist('userInstructionContract.js'));

const WEBHOOK = 'Own the webhook delivery service: signing, idempotency keys, backoff retries, per-customer rate limits, dead-letter queue, replay CLI, about 40M deliveries a day.';
const INCIDENT = '2022 incident: a flag misconfiguration double-applied promo codes for about 40 min (about 1,200 orders, $9k); I rolled back, reconciled, ran the postmortem, added CI flag validation and canary stages.';
const STORIES = 'Stories: Go rewrite vs N+1 queries (two-week spike, p99 1.8 s to 400 ms); six-week webhook launch (cut the self-serve UI and custom retry policies); feedback on oversized PRs (stacked PRs, reviews under a day).';

const factsFor = (raw, type) => selectCustomContextFactsForAnswer(classifyCustomContext(raw), type).map((c) => c.text).join('\n');

describe('profile facts reach identity and behavioural answers', () => {
  for (const [name, line, probe] of [['a count with an M unit', WEBHOOK, /40M deliveries/], ['an incident cost', INCIDENT, /promo codes/], ['a Stories: Go line', STORIES, /Go rewrite/]]) {
    test(name, () => {
      for (const type of ['identity_answer', 'behavioral_interview_answer']) {
        assert.match(factsFor(line, type), probe, `${type} lost: ${line.slice(0, 40)}`);
      }
      assert.equal(classifyCustomContext(line).hasSensitive, false);
    });
  }
  test('other counts stay counts', () => {
    for (const line of ['Scaled the API to 100k users.', 'The app has 5M downloads.', 'We process 2m events per minute.']) {
      assert.equal(classifyCustomContext(line).hasSensitive, false, line);
    }
  });
});

describe('pay and pricing are still withheld', () => {
  for (const line of [
    'I make 185k base.',
    'Current offer is 320k TC.',
    'My salary is $185k.',
    'Target 2m per year.',
    'I hold 50k shares.',
    'We raised a $40M round.',
    'The outage cost us $2M in ARR.',
    'After the incident I got a raise to $150k.',
    'Our list price is $50/seat.',
  ]) {
    test(`sensitive: "${line}"`, () => {
      const c = classifyCustomContext(line);
      assert.equal(c.hasSensitive, true, line);
      assert.equal(factsFor(line, 'behavioral_interview_answer'), '', line);
    });
  }
  test('a salary sentence beside an incident story is still withheld on its own', () => {
    const raw = `${INCIDENT} My base salary is $185k.`;
    const facts = factsFor(raw, 'behavioral_interview_answer');
    assert.doesNotMatch(facts, /185k/);
    assert.match(facts, /promo codes/);
  });
});

test('capitalised Go is the language after a label; the verb still reads as an instruction', () => {
  assert.equal(isDirectiveShaped('Go rewrite vs N+1 queries'), false);
  assert.equal(isDirectiveShaped('Go through each step before the code.'), true);
  assert.equal(isDirectiveShaped('Tip: go deeper on tradeoffs.'), true);
  assert.equal(isDirectiveShaped('go rewrite the answer'), true, 'lower-case go stays the verb');
});
