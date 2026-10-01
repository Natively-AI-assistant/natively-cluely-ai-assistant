/**
 * The one ordering rule for screenshot rungs (2026-10-01): the selection's own
 * rung leads, unless its circuit breaker is open; then health-ordered cloud
 * rungs; then local ones. Pure, so both screenshot paths can share it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const { orderVisionCandidates } = require(dist('llm/visionOrdering.js'));

const r = (id, priority) => ({ id, priority });
const cloud = [r('openai', 0), r('claude', 1), r('gemini_flash', 2), r('fluxion', 3)];
const local = [{ ...r('custom', 100), isLocal: true }, { ...r('ollama', 101), isLocal: true }];
const ids = (list) => list.map((p) => p.id);
const order = (over = {}) => ids(orderVisionCandidates({ selected: [], cloud, local, localOnly: false, health: new Map(), now: 1000, ...over }));
const cooling = (id, until = 5000) => [id, { openUntil: until, consecutiveFails: 3, ttftEma: null }];

describe('orderVisionCandidates', () => {
  test('no selection: cloud by priority, then local', () => {
    assert.deepEqual(order(), ['openai', 'claude', 'gemini_flash', 'fluxion', 'custom', 'ollama']);
  });
  test('the selection leads, and is not repeated', () => {
    assert.deepEqual(order({ selected: [cloud[3]] }), ['fluxion', 'openai', 'claude', 'gemini_flash', 'custom', 'ollama']);
    assert.deepEqual(order({ selected: [local[1]] }), ['ollama', 'openai', 'claude', 'gemini_flash', 'fluxion', 'custom']);
  });
  test('several selected rungs lead in the order given', () => {
    assert.deepEqual(order({ selected: [local[1], cloud[2]] }), ['ollama', 'gemini_flash', 'openai', 'claude', 'fluxion', 'custom']);
  });
  test('a faster measured provider does not jump ahead of the selection', () => {
    const health = new Map([['claude', { openUntil: 0, consecutiveFails: 0, ttftEma: 200 }], ['openai', { openUntil: 0, consecutiveFails: 0, ttftEma: 900 }]]);
    assert.deepEqual(order({ selected: [cloud[3]], health }), ['fluxion', 'claude', 'openai', 'gemini_flash', 'custom', 'ollama']);
  });
  test('a cloud selection whose breaker is open stops leading, and leads again once it closes', () => {
    const health = new Map([cooling('fluxion')]);
    assert.deepEqual(order({ selected: [cloud[3]], health }), ['openai', 'claude', 'gemini_flash', 'fluxion', 'custom', 'ollama'], 'cooling: tried last among cloud, not first');
    assert.deepEqual(order({ selected: [cloud[3]], health, now: 6000 }), ['fluxion', 'openai', 'claude', 'gemini_flash', 'custom', 'ollama']);
  });
  test('a LOCAL selection leads even while its breaker is open: the cloud follows only if it fails', () => {
    // Design section 3: "A selected local model leads; the cloud follows only
    // if it fails." The breaker exception exists for cloud first-token budgets;
    // a person who picked a local model must not have a recovered Ollama
    // skipped for the rest of a cooldown while their screenshots go to a cloud.
    assert.deepEqual(order({ selected: [local[1]], health: new Map([cooling('ollama')]) }), ['ollama', 'openai', 'claude', 'gemini_flash', 'fluxion', 'custom']);
    assert.deepEqual(order({ selected: [local[0], cloud[3]], health: new Map([cooling('custom'), cooling('fluxion')]) }),
      ['custom', 'openai', 'claude', 'gemini_flash', 'fluxion', 'ollama'], 'the local one still leads; the cooling cloud one does not');
  });
  test('a HOSTED custom endpoint is a cloud selection: it sits with the local rungs but stops leading while cooling', () => {
    // With local-only mode off, a remote custom provider is seated in the
    // `local` list with isLocal:false. Being in that list does not make it local.
    const hosted = { ...r('custom', 100), isLocal: false };
    const list = [hosted, local[1]];
    const args = { selected: [hosted], cloud, local: list, localOnly: false, now: 1000 };
    assert.deepEqual(ids(orderVisionCandidates({ ...args, health: new Map([cooling('custom')]) })), ['openai', 'claude', 'gemini_flash', 'fluxion', 'custom', 'ollama']);
    assert.deepEqual(ids(orderVisionCandidates({ ...args, health: new Map() })), ['custom', 'openai', 'claude', 'gemini_flash', 'fluxion', 'ollama']);
  });
  test('if the cooling selection is the only rung, it is still tried', () => {
    const only = [r('fluxion', 0)];
    assert.deepEqual(ids(orderVisionCandidates({ selected: only, cloud: only, local: [], localOnly: false, health: new Map([cooling('fluxion')]), now: 1000 })), ['fluxion']);
  });
  test('local-only: local rungs only, whatever is selected', () => {
    assert.deepEqual(order({ selected: [cloud[3]], localOnly: true }), ['custom', 'ollama']);
  });
  test('the inputs are not mutated', () => {
    // Out of priority order, with measured speeds: an in-place sort WOULD move
    // these (in priority order with no health, sorting was a no-op and the
    // test could not fail).
    const c = [cloud[2], cloud[0], cloud[3], cloud[1]], l = [local[1], local[0]];
    const before = [ids(c), ids(l)];
    const health = new Map([['claude', { openUntil: 0, consecutiveFails: 0, ttftEma: 100 }], ['openai', { openUntil: 0, consecutiveFails: 0, ttftEma: 900 }]]);
    const out = ids(orderVisionCandidates({ selected: [c[2]], cloud: c, local: l, localOnly: false, health, now: 1 }));
    assert.notDeepEqual(out.slice(1, 4), before[0].filter((id) => id !== 'fluxion'), 'control: ordering really reorders these');
    assert.deepEqual([ids(c), ids(l)], before);
  });
});
