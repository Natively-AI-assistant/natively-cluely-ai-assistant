import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramTimingLog, percentiles } from '../diagramTimings.mjs';

describe('diagram timing log', () => {
  test('summarises a turn relative to the accepted request, receipt and visibility separately', () => {
    const log = createDiagramTimingLog();
    log.mark('t1', 'request_accepted', 1000);
    log.mark('t1', 'first_token', 1400);
    log.mark('t1', 'first_text_visible', 1490);
    log.mark('t1', 'block_complete', 2600);
    log.mark('t1', 'block_revealed', 2900);
    log.mark('t1', 'diagram_visible', 2960);
    log.mark('t1', 'answer_complete', 5200);
    log.set('t1', 'renderMs', 31);
    assert.deepEqual(log.summary('t1'), {
      id: 't1', hasRequestMark: true, firstTokenMs: 400, firstTextVisibleMs: 490,
      diagramReceivedMs: 1600, diagramRevealedMs: 1900, diagramVisibleMs: 1960, answerCompleteMs: 4200, renderMs: 31,
    });
  });

  test('the first occurrence of a mark wins; numbers take the last write', () => {
    const log = createDiagramTimingLog();
    log.mark('t', 'first_token', 10);
    log.mark('t', 'first_token', 99);
    log.set('t', 'repairs', 1);
    log.set('t', 'repairs', 2);
    assert.equal(log.get('t').marks.first_token, 10);
    assert.equal(log.get('t').numbers.repairs, 2);
  });

  test('a pending question id can be renamed to the answer row id', () => {
    const log = createDiagramTimingLog();
    log.mark('pending', 'request_accepted', 5);
    log.mark('row-1', 'first_token', 50);
    log.rename('pending', 'row-1');
    assert.equal(log.get('pending'), null);
    assert.deepEqual(log.get('row-1').marks, { first_token: 50, request_accepted: 5 });
  });

  test('it holds only numbers and short categories, and is bounded', () => {
    const log = createDiagramTimingLog({ max: 3 });
    for (let i = 0; i < 10; i += 1) log.mark(`t${i}`, 'first_token', i);
    assert.equal(log.all().length, 3);
    log.set('t9', 'question', { text: 'secret' });
    assert.equal(log.get('t9').numbers.question, undefined);
    log.mark('t9', 'first_token', 'nope');
    assert.equal(log.summary('missing'), null);
  });

  test('a turn with no request mark still reports, flagged as such', () => {
    const log = createDiagramTimingLog();
    log.mark('t', 'first_token', 100);
    log.mark('t', 'diagram_visible', 900);
    const s = log.summary('t');
    assert.equal(s.hasRequestMark, false);
    assert.equal(s.diagramVisibleMs, 800);
  });
});

describe('percentiles', () => {
  test('nearest-rank p50 / p95', () => {
    assert.deepEqual(percentiles([5, 1, 3, 2, 4]), { n: 5, min: 1, p50: 3, p95: 5, max: 5 });
    assert.deepEqual(percentiles([7]), { n: 1, min: 7, p50: 7, p95: 7, max: 7 });
    assert.equal(percentiles([]), null);
    assert.equal(percentiles([NaN]), null);
  });
});
