// The Launcher calendar card's banner stack (bannerStack.mjs). What these pin:
// a surviving banner never changes its position in the list, because a DOM
// move cancels its running transition, and the arrival order puts the soonest
// meeting in front.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { reconcileStack, settleEntering, dropLeft, arrivalSteps } = await import('../bannerStack.mjs');

const t = (...keys) => keys.map((key) => ({ key, item: key.toUpperCase() }));
const view = (entries) => entries.map((e) => `${e.key}@${e.depth}:${e.phase}`);

test('a stack filling from empty: every banner enters at its depth, front first', () => {
    assert.deepEqual(view(reconcileStack([], t('a', 'b', 'c'))), ['a@0:enter', 'b@1:enter', 'c@2:enter']);
});

test('arrival order: the furthest first, so the soonest lands in front', () => {
    assert.deepEqual(arrivalSteps(['a', 'b', 'c']), [['c'], ['b', 'c'], ['a', 'b', 'c']]);
    assert.deepEqual(arrivalSteps(['a']), [['a']]);
    assert.deepEqual(arrivalSteps([]), []);

    // Played through reconcileStack: nobody moves, depths step back as each arrives.
    let s = [];
    for (const step of arrivalSteps(['a', 'b', 'c'])) s = settleEntering(reconcileStack(s, t(...step)));
    assert.deepEqual(view(s), ['c@2:rest', 'b@1:rest', 'a@0:rest']);
});

test('surviving banners never change position in the list, whatever happens to depth', () => {
    const rest = settleEntering(reconcileStack([], t('a', 'b', 'c')));

    // The front meeting passes and a new one joins the back.
    const next = reconcileStack(rest, t('b', 'c', 'd'));
    assert.deepEqual(view(next), ['a@0:leaving', 'b@0:rest', 'c@1:rest', 'd@2:enter']);
    assert.deepEqual(next.slice(0, 3).map((e) => e.key), ['a', 'b', 'c'], 'no survivor moved');

    // A sooner meeting is booked: it enters in front, the back one leaves.
    const sooner = reconcileStack(rest, t('z', 'a', 'b'));
    assert.deepEqual(view(sooner), ['a@1:rest', 'b@2:rest', 'c@2:leaving', 'z@0:enter']);
});

test('a leaving banner stays until dropped, and a revived one is kept', () => {
    const rest = settleEntering(reconcileStack([], t('a', 'b')));
    const leaving = reconcileStack(rest, t('b'));
    assert.deepEqual(view(leaving), ['a@0:leaving', 'b@0:rest']);
    assert.deepEqual(view(reconcileStack(leaving, t('b'))), ['a@0:leaving', 'b@0:rest'], 'stays leaving, not re-flagged');

    const revived = reconcileStack(leaving, t('a', 'b'));
    assert.deepEqual(view(revived), ['a@0:rest', 'b@1:rest'], 'comes back in place');
    assert.deepEqual(view(dropLeft(revived, ['a'])), ['a@0:rest', 'b@1:rest'], 'the pending drop spares a revived banner');
    assert.deepEqual(view(dropLeft(leaving, ['a'])), ['b@0:rest']);
});

test('banners that already arrived (the card remounted) rest instead of replaying the entrance', () => {
    const seen = new Set(['a', 'b']);
    assert.deepEqual(view(reconcileStack([], t('a', 'b', 'c'), (k) => seen.has(k))), ['a@0:rest', 'b@1:rest', 'c@2:enter']);
});

test('the same keys again change nothing but the item', () => {
    const rest = settleEntering(reconcileStack([], t('a', 'b')));
    const again = reconcileStack(rest, [{ key: 'a', item: 'A2' }, { key: 'b', item: 'B' }]);
    assert.deepEqual(view(again), ['a@0:rest', 'b@1:rest']);
    assert.equal(again[0].item, 'A2', 'a renamed meeting shows its new title');
    assert.equal(settleEntering(again), again, 'nothing entering: same array back, no re-render');
});

const { padStack, isSlotKey } = await import('../bannerStack.mjs');

test('the stack is always three deep: placeholder slots fill in behind real items', () => {
    const keys = (xs) => xs.map((x) => x.key);
    assert.deepEqual(keys(padStack([])), ['slot:0', 'slot:1', 'slot:2'], 'nothing yet: a placeholder front and two behind');
    assert.deepEqual(keys(padStack(t('a'))), ['a', 'slot:1', 'slot:2']);
    assert.deepEqual(keys(padStack(t('a', 'b', 'c', 'd'))), ['a', 'b', 'c'], 'never deeper than three');
    assert.equal(isSlotKey('slot:1'), true);
    assert.equal(isSlotKey('m1'), false);
});

test('meetings arriving over placeholders push them out the back, one per arrival', () => {
    let s = settleEntering(reconcileStack([], padStack([])));
    for (const step of arrivalSteps(t('a', 'b', 'c'))) s = settleEntering(reconcileStack(s, padStack(step)));
    assert.deepEqual(view(s), ['slot:0@0:leaving', 'slot:1@1:leaving', 'slot:2@2:leaving', 'c@2:rest', 'b@1:rest', 'a@0:rest']);

    // One meeting: only the front placeholder gives way; the two behind stay.
    const one = reconcileStack(settleEntering(reconcileStack([], padStack([]))), padStack(t('a')));
    assert.deepEqual(view(one), ['slot:0@0:leaving', 'slot:1@1:rest', 'slot:2@2:rest', 'a@0:enter']);
});
