// electron/audio/whisper/__tests__/LegacyCopyUpgrade2026_10_23.test.mjs
//
// Issue #668 follow-up (2026-10-23): a selected local model still running from
// the copy an earlier version downloaded (Xenova Whisper Small: ~3 GB a call
// against 0.65 GB) moves to the current copy by itself, outside meetings.
// Before, only Settings › Audio › Update did it.
//
// What must hold:
//  - it downloads only the models Local STT uses, only when an update exists,
//    and never starts one while a meeting runs;
//  - a meeting pauses the update it started (cancel, partial files kept),
//    also one still on its way to starting, and a minute after the meeting
//    ends it resumes; a pause is not a failure;
//  - completed during a meeting: re-warmed only after it;
//  - a download started from Settings is left alone;
//  - a failed download, or a cancel the user made, is not retried this
//    session; a refused start is retried, up to three times;
//  - not enough disk for both copies: skipped;
//  - complete: the host re-warms from the new copy.
//
// Pure logic with injected state; no OS branch, so one run covers macOS and
// Windows. The main.ts wiring is pinned at the end. Not executed on Windows.
//
// Run: npm run build:electron && node --test electron/audio/whisper/__tests__/LegacyCopyUpgrade2026_10_23.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../../..');
const { createLegacyCopyUpgrader, LEGACY_UPGRADE_DISK_MARGIN_BYTES, LEGACY_UPGRADE_RESUME_DELAY_MS } = await import(
  pathToFileURL(path.join(repo, 'dist-electron/electron/audio/whisper/legacyCopyUpgrade.js')).href
);
const { selectedLocalModelIds } = await import(
  pathToFileURL(path.join(repo, 'dist-electron/electron/audio/whisper/modelManager.js')).href
);

const SMALL = 'Xenova/whisper-small';
const GB = 1024 ** 3;

function harness(over = {}) {
  const state = {
    selected: [SMALL],
    upgradable: new Set([SMALL]),
    meeting: false,
    status: new Map(),
    free: 50 * GB,
    started: [],
    cancelled: [],
    upgraded: [],
    startResult: { success: true },
    timers: [],
    ...over,
  };
  const up = createLegacyCopyUpgrader({
    selectedModelIds: () => state.selected,
    isUpgradeAvailable: (id) => state.upgradable.has(id),
    isMeetingActive: () => state.meeting,
    downloadStatus: (id) => state.status.get(id) ?? null,
    start: async (id) => {
      state.started.push(id);
      await state.beforeStartReturns?.();
      if (state.startResult.success && !state.startResult.alreadyDownloading) state.status.set(id, 'downloading');
      return state.startResult;
    },
    cancel: (id) => { state.cancelled.push(id); state.status.set(id, 'cancelled'); },
    downloadBytes: () => 500 * 1024 ** 2,
    freeDiskBytes: () => state.free,
    onUpgraded: (id) => state.upgraded.push(id),
    later: (fn, ms) => state.timers.push({ fn, ms }),
  });
  // Runs what a meeting's end scheduled, then lets run() settle.
  const flushLater = async () => {
    const due = state.timers.splice(0);
    for (const t of due) t.fn();
    await new Promise((r) => setImmediate(r));
  };
  return { state, up, flushLater };
}

test('outside a meeting, the selected model with a lighter copy is downloaded', async () => {
  const { state, up } = harness();
  await up.run();
  assert.deepEqual(state.started, [SMALL]);
});

test('nothing to update, or Local STT not in use (no selected ids): nothing is downloaded', async () => {
  const a = harness({ upgradable: new Set() });
  await a.up.run();
  assert.deepEqual(a.state.started, []);
  const b = harness({ selected: [] });
  await b.up.run();
  assert.deepEqual(b.state.started, []);
});

test('the same model selected for both channels is downloaded once', async () => {
  const { state, up } = harness({ selected: [SMALL, SMALL, SMALL] });
  await up.run();
  assert.deepEqual(state.started, [SMALL]);
});

test('never starts during a meeting; a minute after it ends, it starts', async () => {
  const { state, up, flushLater } = harness({ meeting: true });
  await up.run();
  assert.deepEqual(state.started, []);
  state.meeting = false;
  up.onMeetingStateChanged(false);
  assert.deepEqual(state.started, [], 'not at the moment the meeting ends: its workers and summary are still running');
  assert.equal(state.timers[0].ms, LEGACY_UPGRADE_RESUME_DELAY_MS);
  assert.ok(LEGACY_UPGRADE_RESUME_DELAY_MS >= 30_000);
  await flushLater();
  assert.deepEqual(state.started, [SMALL]);
});

test('a new meeting inside that minute keeps it waiting', async () => {
  const { state, up, flushLater } = harness();
  up.onMeetingStateChanged(false);
  state.meeting = true;
  await flushLater();
  assert.deepEqual(state.started, []);
});

test('a meeting pauses the update and its end resumes it', async () => {
  const { state, up, flushLater } = harness();
  await up.run();
  state.meeting = true;
  up.onMeetingStateChanged(true);
  assert.deepEqual(state.cancelled, [SMALL]);
  up.onDownloadStatus(SMALL, 'cancelled'); // the pause, as the service reports it
  state.meeting = false;
  up.onMeetingStateChanged(false);
  await flushLater();
  assert.deepEqual(state.started, [SMALL, SMALL]);
});

test('a meeting that starts while the download is on its way to starting pauses it too', async () => {
  const { state, up } = harness();
  // startWhenReady awaits the proxy lookup before the worker exists.
  state.beforeStartReturns = async () => {
    state.meeting = true;
    up.onMeetingStateChanged(true); // status still null here: nothing to pause yet
  };
  await up.run();
  assert.deepEqual(state.cancelled, [SMALL]);
  up.onDownloadStatus(SMALL, 'cancelled');
  assert.deepEqual(state.started, [SMALL]);
});

test('a download Settings started in the meantime is not taken over', async () => {
  const { state, up } = harness({ startResult: { success: true, alreadyDownloading: true } });
  await up.run();
  state.status.set(SMALL, 'downloading');
  state.meeting = true;
  up.onMeetingStateChanged(true);
  assert.deepEqual(state.cancelled, []);
});

test('a download started from Settings is neither started again nor paused', async () => {
  const { state, up } = harness();
  state.status.set(SMALL, 'downloading');
  await up.run();
  assert.deepEqual(state.started, []);
  up.onMeetingStateChanged(true);
  assert.deepEqual(state.cancelled, []);
});

test('a cancel the user made is not undone this session', async () => {
  const { state, up } = harness();
  await up.run();
  state.status.set(SMALL, 'cancelled');
  up.onDownloadStatus(SMALL, 'cancelled');
  up.onMeetingStateChanged(false);
  await up.run();
  assert.deepEqual(state.started, [SMALL]);
});

test('a failed download or a start that is refused is not retried this session', async () => {
  const a = harness();
  await a.up.run();
  a.state.status.set(SMALL, 'error');
  a.up.onDownloadStatus(SMALL, 'error');
  await a.up.run();
  assert.deepEqual(a.state.started, [SMALL]);

  // A refused start (a paused worker still stopping) is retried, three times at most.
  const b = harness({ startResult: { success: false, error: 'The previous download of this model is still stopping.' } });
  for (let i = 0; i < 5; i++) await b.up.run();
  assert.deepEqual(b.state.started, [SMALL, SMALL, SMALL]);
  const c = harness({ startResult: { success: false, error: 'still stopping' } });
  await c.up.run();
  c.state.startResult = { success: true };
  await c.up.run();
  assert.deepEqual(c.state.started, [SMALL, SMALL]);
});

test('an update a quit interrupted is picked up again', async () => {
  const { state, up } = harness();
  state.status.set(SMALL, 'interrupted');
  await up.run();
  assert.deepEqual(state.started, [SMALL]);
});

test('not enough disk for the new copy beside the old one: skipped; unknown free space: tried', async () => {
  const a = harness({ free: 500 * 1024 ** 2 + LEGACY_UPGRADE_DISK_MARGIN_BYTES - 1 });
  await a.up.run();
  assert.deepEqual(a.state.started, []);
  const b = harness({ free: null });
  await b.up.run();
  assert.deepEqual(b.state.started, [SMALL]);
});

test('complete: the host is told, once, and only for its own update', async () => {
  const { state, up } = harness();
  up.onDownloadStatus(SMALL, 'complete'); // not ours yet
  assert.deepEqual(state.upgraded, []);
  await up.run();
  up.onDownloadStatus(SMALL, 'verifying');
  up.onDownloadStatus(SMALL, 'complete');
  up.onDownloadStatus(SMALL, 'complete');
  assert.deepEqual(state.upgraded, [SMALL]);
});

test('completed during a meeting: the re-warm waits until after it', async () => {
  const { state, up, flushLater } = harness();
  await up.run();
  state.meeting = true;
  up.onDownloadStatus(SMALL, 'complete');
  assert.deepEqual(state.upgraded, []);
  state.meeting = false;
  up.onMeetingStateChanged(false);
  await flushLater();
  assert.deepEqual(state.upgraded, [SMALL]);
});

test('selectedLocalModelIds: global (Tiny English when unset), per-channel only when on, catalog ids only, once each', () => {
  const settings = (o) => (k) => o[k];
  assert.deepEqual(selectedLocalModelIds(settings({})), ['Xenova/whisper-tiny.en']);
  assert.deepEqual(selectedLocalModelIds(settings({ localWhisperModel: SMALL, localWhisperModelMic: 'Xenova/whisper-base' })), [SMALL]);
  assert.deepEqual(
    selectedLocalModelIds(settings({ localWhisperModel: SMALL, localWhisperPerChannelEnabled: true, localWhisperModelMic: 'Xenova/whisper-base', localWhisperModelSystem: SMALL })),
    [SMALL, 'Xenova/whisper-base'],
  );
  assert.deepEqual(selectedLocalModelIds(settings({ localWhisperModel: 'not/a-model', localWhisperPerChannelEnabled: true, localWhisperModelMic: '' })), []);
});

test('main.ts wires it: Local STT only, meeting start/stop, every download state, warm worker swap outside meetings', () => {
  const src = fs.readFileSync(path.join(repo, 'electron/main.ts'), 'utf8');
  const body = src.slice(src.indexOf('private scheduleLegacyCopyUpgrades(): void {'), src.indexOf('private broadcastMeetingState(): void {'));
  assert.ok(body.length > 0, 'scheduleLegacyCopyUpgrades present');
  assert.match(body, /getSttProvider\(\) === 'local-whisper'\s*\? mm\.selectedLocalModelIds\(/);
  assert.match(body, /isModelUpgradeAvailable\(id, resolveInferenceConfig\(\)\.dtype\)/);
  assert.match(body, /service\.subscribe\([\s\S]*?onDownloadStatus\(entry\.modelId, entry\.status\)/);
  assert.match(body, /if \(this\.isMeetingActive \|\| !modelPreloader\.isWarm\(id\)\) return;/);
  assert.match(body, /\}, 90_000\);\s*\(timer as any\)\.unref\?\.\(\);/);
  const broadcast = src.slice(src.indexOf('private broadcastMeetingState(): void {'), src.indexOf('private broadcastMeetingState(): void {') + 400);
  assert.match(broadcast, /this\.legacyCopyUpgrader\?\.onMeetingStateChanged\(this\.isMeetingActive\)/);
  assert.match(src, /this\.scheduleLegacyCopyUpgrades\(\);/);
  // The startup preload reads the same helper.
  assert.match(src, /const modelIds = new Set<string>\(\[modelId, \.\.\.selectedLocalModelIds\(/);
});
