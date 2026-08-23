/**
 * The cooldown must throttle a RESTATED FRAGMENT of the same utterance and let a
 * genuinely DIFFERENT question through. Pre-fix it silenced both.
 */
const path = require('path');
const { planNextAssistantAction } = require(path.resolve(__dirname, '../..', 'dist-electron/electron/llm/index.js'));

const base = { confidence: 0.9, now: 10_000, lastTriggerTime: 9_000, cooldownMs: 3000 }; // 1s ago: inside window
const run = (o) => planNextAssistantAction({ ...base, ...o });

const CASES = [
  // [label, triggerQuestion, lastTriggerQuestion, expectSilentCooldown]
  ['restated fragment of the same question', 'How many engineers were on the team?', 'How many engineers were on the team', true],
  ['same question, minor STT drift',         'which datastore did we use',           'Which datastore did we use?',          true],
  ['GENUINELY different question',           'Which datastore did we use?',          'How many engineers were on the team?', false],
  ['different question, unrelated topic',    'What did we use for caching?',         'Did we migrate to AWS?',               false],
  ['no previous question recorded',          'Which datastore did we use?',          undefined,                              true],
  ['no current question',                    '',                                     'Did we migrate to AWS?',               true],
];

let bad = 0;
for (const [label, q, prev, expectSilent] of CASES) {
  const d = run({ triggerQuestion: q, lastTriggerQuestion: prev, transcriptContext: q || 'ctx' });
  const silentCooldown = d.kind === 'silent' && d.reason === 'cooldown';
  const ok = silentCooldown === expectSilent;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} throttled=${String(silentCooldown).padEnd(5)} (want ${String(expectSilent).padEnd(5)}) ${label}`);
}

// The throttle must still exist at all — a regression here would remove the rate limit.
const outside = run({ triggerQuestion: 'anything', lastTriggerQuestion: 'anything', lastTriggerTime: 0 });
const stillThrottles = run({ triggerQuestion: 'same', lastTriggerQuestion: 'same', transcriptContext: 'same' });
console.log(`  ${outside.reason !== 'cooldown' ? 'ok  ' : 'FAIL'} outside the window is not throttled`);
console.log(`  ${stillThrottles.reason === 'cooldown' ? 'ok  ' : 'FAIL'} the cooldown still throttles a repeat inside the window`);
if (outside.reason === 'cooldown') bad++;
if (stillThrottles.reason !== 'cooldown') bad++;

process.exit(bad ? 1 : 0);
