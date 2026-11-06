// A send pressed while ⌘/Ctrl+H is still capturing takes the screenshot along
// instead of going without it (user report, 2026-11-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingScreenshots } from '../pendingScreenshots.mjs';

const later = (value, ms) => new Promise((r) => setTimeout(() => r(value), ms));

test('nothing in flight: settle resolves at once with nothing', async () => {
  const shots = createPendingScreenshots();
  assert.equal(shots.inFlight(), false);
  const t0 = Date.now();
  assert.deepEqual(await shots.settle(1000), []);
  assert.ok(Date.now() - t0 < 50);
});

test('a send during the capture waits for it and takes it', async () => {
  const shots = createPendingScreenshots();
  const capture = shots.track(later({ path: '/a.png', preview: 'p' }, 60));
  assert.equal(shots.inFlight(), true);
  const taken = await shots.settle(1000);
  assert.deepEqual(taken, [{ path: '/a.png', preview: 'p' }]);
  assert.equal(shots.claimed('/a.png'), true);
  assert.deepEqual(await capture, { path: '/a.png', preview: 'p' });
  assert.equal(shots.inFlight(), false);
});

test('the capture handler sees the claim when it checks, not only after the send', async () => {
  // As NativelyInterface runs it: the handler awaits the capture and checks
  // claimed() in its continuation, which runs BEFORE the waiting send resumes.
  // The old claim (taken after the wait) came too late, and the image was
  // also added to the tray.
  const shots = createPendingScreenshots();
  let sawClaim = null;
  const handler = (async () => {
    const shot = await shots.track(later({ path: '/b.png', preview: 'p' }, 30));
    sawClaim = shots.claimed(shot.path);
  })();
  const sending = shots.settle(1000);
  await handler;
  assert.equal(sawClaim, true, 'the tray add is skipped');
  assert.deepEqual(await sending, [{ path: '/b.png', preview: 'p' }], 'and the send has it');
});

test('a capture that finishes after the wait is not claimed: it goes to the tray', async () => {
  const shots = createPendingScreenshots();
  let sawClaim = null;
  const handler = (async () => {
    const shot = await shots.track(later({ path: '/late.png', preview: 'p' }, 120));
    sawClaim = shots.claimed(shot.path);
  })();
  assert.deepEqual(await shots.settle(30), []);
  await handler;
  assert.equal(sawClaim, false);
});

test('a capture slower than the cap is left for the tray', async () => {
  const shots = createPendingScreenshots();
  const capture = shots.track(later({ path: '/slow.png', preview: 'p' }, 200));
  const t0 = Date.now();
  assert.deepEqual(await shots.settle(40), []);
  assert.ok(Date.now() - t0 < 150);
  const shot = await capture;
  assert.equal(shots.claimed(shot.path), false);
});

test('a failed or empty capture is nothing, never a rejection', async () => {
  const shots = createPendingScreenshots();
  shots.track(Promise.reject(new Error('capture already in progress')));
  shots.track(Promise.resolve(null));
  shots.track(Promise.resolve({ path: '' }));
  assert.deepEqual(await shots.settle(500), []);
  assert.equal(shots.inFlight(), false);
});

test('a capture is taken by one send only', async () => {
  const shots = createPendingScreenshots();
  shots.track(later({ path: '/c.png' }, 20));
  const [first, second] = await Promise.all([shots.settle(500), shots.settle(500)]);
  assert.equal(first.length + second.length, 1);
});

test('two quick captures both ride the send', async () => {
  const shots = createPendingScreenshots();
  shots.track(later({ path: '/1.png' }, 20));
  shots.track(later({ path: '/2.png' }, 40));
  const taken = await shots.settle(500);
  assert.deepEqual(taken.map((s) => s.path), ['/1.png', '/2.png']);
});
