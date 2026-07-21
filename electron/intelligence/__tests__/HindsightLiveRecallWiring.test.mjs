// Live-recall gate + (opt-in) live recall. The gate is the load-bearing safety property:
// Hindsight recall fires on the live answer path ONLY for backward-looking questions, so
// normal/coding/identity questions add ZERO latency. The live portion (retain→backward-
// recall) is opt-in (HINDSIGHT_LIVE_TEST=1 + a running server), skipped headless.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBackwardLookingQuery } from '../../../dist-electron/electron/intelligence/ContextRouter.js';
import { HindsightClientAdapter } from '../../../dist-electron/electron/intelligence/memory/HindsightClientAdapter.js';

const LIVE = process.env.HINDSIGHT_LIVE_TEST === '1';
const BASE = process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = String(process.hrtime.bigint()).slice(-9);

describe('isBackwardLookingQuery — the live-recall gate', () => {
  test('fires TRUE for backward-looking questions', () => {
    for (const q of [
      'what did we discuss last time about Redis?',
      'did we cover the pricing objection before?',
      'summarize our previous calls',
      'what came up in the prior meeting',
      'have we talked about this earlier?',
      'what did the client say last time',
    ]) assert.equal(isBackwardLookingQuery(q), true, `should match: "${q}"`);
  });

  test('fires FALSE for normal/coding/identity/sales questions (zero-latency guarantee)', () => {
    for (const q of [
      'write code for two sum',
      'introduce yourself',
      'why should we hire you?',
      'what is my name?',
      'explain BFS',
      'why is your product expensive?',
      'what are my skills?',
    ]) assert.equal(isBackwardLookingQuery(q), false, `should NOT match: "${q}"`);
  });

  test('never throws on empty/garbage/non-string', () => {
    assert.equal(isBackwardLookingQuery(''), false);
    assert.equal(isBackwardLookingQuery('   '), false);
    assert.equal(isBackwardLookingQuery(null), false);
    assert.equal(isBackwardLookingQuery(undefined), false);
    assert.equal(isBackwardLookingQuery(12345), false);
  });
});

describe('Hindsight live recall (opt-in)', { skip: !LIVE && 'set HINDSIGHT_LIVE_TEST=1 + run the dev server' }, () => {
  test('retain → backward-looking recall returns the fact (the live-recall scenario)', async () => {
    const adapter = new HindsightClientAdapter({ baseUrl: BASE });
    assert.equal(adapter.enabled, true);
    const scope = { userId: `recall_${stamp}` };
    adapter.retain({ content: 'In our last call we agreed to migrate the cache layer to Redis next sprint.', scope, source: 'meeting_summary' });
    await adapter.flush();
    let out = [];
    for (let i = 0; i < 12; i++) {
      out = await adapter.recall('what did we discuss last time about the cache?', scope, { timeoutMs: 800, maxResults: 5 });
      if (out.some((m) => /redis|cache|migrate/i.test(m.text))) break;
      await sleep(2500);
    }
    assert.ok(out.some((m) => /redis|cache|migrate/i.test(m.text)), 'backward-looking recall should surface the prior-call fact');
  });

  test('the 800ms live budget is honored (never blocks the answer)', async () => {
    const adapter = new HindsightClientAdapter({ baseUrl: BASE });
    const t0 = Date.now();
    await adapter.recall('what did we discuss last time?', { userId: `budget_${stamp}` }, { timeoutMs: 800, maxResults: 5 });
    assert.ok(Date.now() - t0 < 2000, 'recall must return within ~the 800ms budget (+overhead), never hang');
  });
});
