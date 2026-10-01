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
const local = [r('custom', 100), r('ollama', 101)];
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
  test('a LOCAL selection whose breaker is open goes behind the cloud rungs', () => {
    assert.deepEqual(order({ selected: [local[1]], health: new Map([cooling('ollama')]) }), ['openai', 'claude', 'gemini_flash', 'fluxion', 'custom', 'ollama']);
  });
  test('if the cooling selection is the only rung, it is still tried', () => {
    const only = [r('fluxion', 0)];
    assert.deepEqual(ids(orderVisionCandidates({ selected: only, cloud: only, local: [], localOnly: false, health: new Map([cooling('fluxion')]), now: 1000 })), ['fluxion']);
  });
  test('local-only: local rungs only, whatever is selected', () => {
    assert.deepEqual(order({ selected: [cloud[3]], localOnly: true }), ['custom', 'ollama']);
  });
  test('the inputs are not mutated', () => {
    const c = [...cloud], l = [...local];
    orderVisionCandidates({ selected: [c[3]], cloud: c, local: l, localOnly: false, health: new Map(), now: 1 });
    assert.deepEqual(ids(c), ids(cloud)); assert.deepEqual(ids(l), ids(local));
  });
});
