// electron/llm/__tests__/PlanningPreamble2026_08_21.test.mjs
//
// RC-6 regression from live shadow session C (2026-08-21): answers opened with
// the model's own deliberation ("Since the interviewer is asking directly
// about what I built… I should answer in my own voice…") before the real
// spoken answer. Presses 5/13/20/47 verbatim. Press 5 additionally leaked
// résumé figures INSIDE the meta-commentary. All four existing guards were
// measured no-ops on the verbatim text.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { stripPlanningPreamble } = await import(dist('planningPreamble.js'));

describe('RC-6: the live leaks are stripped', () => {
  test('press 5 — deliberation with résumé figures, then the real answer', () => {
    const leaked = 'Since the interviewer is asking directly about what I built in Natively, and the résumé '
      + 'shows me as the builder of the whole project (16,000+ users, $25K+ revenue, Electron/TypeScript/React/Rust '
      + 'stack), I should answer in my own voice describing what I personally built. The prior assistant turn '
      + 'already established the product story, so this should go deeper on the "what did YOU build" angle. '
      + 'I built the whole audio capture layer in Rust, the Electron shell, and the retrieval pipeline.';
    const r = stripPlanningPreamble(leaked);
    assert.equal(r.repaired, true);
    assert.match(r.text, /^I built the whole audio capture layer/);
    assert.doesNotMatch(r.text, /résumé shows me/);
    assert.doesNotMatch(r.text, /\$25K\+ revenue/);
  });

  test('press 13 — interviewer-move narration plus option-choosing', () => {
    const leaked = 'The interviewer is pushing for one concrete concurrency or lifecycle problem. '
      + 'The previous suggestion covered two, but they keep asking for a single, specific one. '
      + 'Let me answer with one focused, grounded example. '
      + 'Yeah, one that bit me hardest was the Rust WASAPI capture thread during shutdown.';
    const r = stripPlanningPreamble(leaked);
    assert.equal(r.repaired, true);
    assert.match(r.text, /^Yeah, one that bit me hardest/);
    assert.doesNotMatch(r.text, /interviewer is pushing/);
  });

  test('press 20 — "So the interviewer is asking whether…" narration', () => {
    const leaked = 'So the interviewer is asking whether I\'d jump straight to changing the embedding model, '
      + 'or whether I\'d do something else first. '
      + 'I wouldn\'t change the embedding model first. That\'s treating the symptom, not diagnosing it.';
    const r = stripPlanningPreamble(leaked);
    assert.equal(r.repaired, true);
    assert.match(r.text, /^I wouldn't change the embedding model first/);
  });
});

describe('RC-6: legitimate content is never touched', () => {
  for (const [name, answer] of [
    ['a clean first-person answer', 'I built the audio layer in Rust because the WASAPI callbacks needed real-time guarantees the Node bindings could not provide.'],
    ['a mid-answer "I should mention" stays (only the OPENING run is eligible)', 'The capture pipeline runs in Rust. I should mention it also handles device switching, which was the hardest part.'],
    ['an answer that talks about interviewers as subject matter', 'Interviewers usually ask about tradeoffs here, so in practice I keep a mental checklist of consistency versus availability.'],
    ['a spoken answer opening with "So…"', 'So the main reason is latency. Redis keeps the hot path in memory and gives us predictable sub-millisecond reads.'],
    ['a code-fenced answer', '```python\ndef two_sum(nums, target):\n    seen = {}\n```'],
  ]) {
    test(name, () => {
      const r = stripPlanningPreamble(answer);
      assert.equal(r.repaired, false, name);
      assert.equal(r.text, answer);
    });
  }

  test('an answer that is ALL planning fails open (original returned)', () => {
    const allPlanning = 'The interviewer is pushing for one concrete example. I should answer with the strongest one.';
    const r = stripPlanningPreamble(allPlanning);
    assert.equal(r.repaired, false);
    assert.equal(r.text, allPlanning);
  });
});
