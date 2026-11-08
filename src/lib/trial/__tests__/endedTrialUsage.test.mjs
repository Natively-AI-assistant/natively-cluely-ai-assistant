import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageForEndedCard } from '../endedTrialUsage.mjs';

const seen = { usage: { ai: 3, ai_tokens: 50_000, stt_seconds: 120, search: 0 }, limits: { ai_tokens: 60_000 } };

test('the card shows the last usage the launcher saw, not zeros', () => {
  assert.deepEqual(usageForEndedCard(seen, 'clock'), seen.usage);
  assert.notEqual(usageForEndedCard(seen, 'clock'), seen.usage, 'a copy, never the live object');
});

test('an allowance ending shows the whole allowance used: the server refuses only then', () => {
  assert.equal(usageForEndedCard(seen, 'allowance').ai_tokens, 60_000);
  assert.equal(usageForEndedCard(seen, 'allowance').stt_seconds, 120, 'the other numbers stay as seen');
  // Never lower than what was seen, and no allowance known: as seen.
  assert.equal(usageForEndedCard({ ...seen, usage: { ...seen.usage, ai_tokens: 61_000 } }, 'allowance').ai_tokens, 61_000);
  assert.equal(usageForEndedCard({ usage: seen.usage }, 'allowance').ai_tokens, 50_000);
  assert.equal(usageForEndedCard({ usage: seen.usage, limits: { ai_tokens: 0 } }, 'allowance').ai_tokens, 50_000);
});

test('nothing seen (an ending found at launch): no numbers, so the card says none', () => {
  assert.equal(usageForEndedCard(null, 'clock'), null);
  assert.equal(usageForEndedCard({ limits: { ai_tokens: 60_000 } }, 'allowance'), null);
});

// ── Wiring: the launcher's card gets these figures, and leaves the sentence out without them ──
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('the launcher hands the ended card the last figures seen, not a zero literal', () => {
  const app = read('App.tsx');
  const card = app.slice(app.indexOf('<FreeTrialModal'), app.indexOf('onByok=', app.indexOf('<FreeTrialModal')));
  assert.match(card, /usageForEndedCard\(lastSeenTrialRef\.current, trialEndedReason\)/);
  assert.doesNotMatch(card, /ai_tokens: 0/);
  assert.match(app, /choice === 'allowance'\) \{\s*setTrialEndedReason\('allowance'\)/);
});

test('the card prints the usage sentence only when it has figures', () => {
  const modal = read('components/trial/FreeTrialModal.tsx');
  assert.match(modal, /\{usage && \(\s*<>\s*You\{isActiveTrial/);
});
