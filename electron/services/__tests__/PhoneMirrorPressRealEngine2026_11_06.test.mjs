// electron/services/__tests__/PhoneMirrorPressRealEngine2026_11_06.test.mjs
//
// A button's IPC handler runs its engine call as a press (startPhonePress in
// phoneMirrorLiveAnswers) and publishes its own copy to the phone only when the
// press's answer did not already reach the phone as it streamed. The press is
// carried by AsyncLocalStorage, so this pins, against the REAL IntelligenceEngine
// (stub models only), that the engine sends a press's answer events from inside
// that press's call, and that an answer finishing outside it (an Auto Answer)
// is never counted as the press's own.
//
// Platform-agnostic: main-process async context, same on macOS and Windows.

import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const dist = (p) => path.join(repoRoot, 'dist-electron/electron', p);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-phone-press-'));
process.env.NATIVELY_TEST_USERDATA = userData;
{
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      app: { getPath: () => userData, getName: () => 'natively-test', getVersion: () => '0.0.0-test', isPackaged: false, isReady: () => true, on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => repoRoot },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (x) => Buffer.from(String(x)), decryptString: (b) => b.toString() },
      ipcMain: { handle() {}, on() {}, removeHandler() {} }, BrowserWindow: { getAllWindows: () => [] },
      shell: {}, dialog: {}, screen: {}, nativeTheme: { on() {} }, powerMonitor: { on() {} }, systemPreferences: {},
    },
  };
}
after(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* best effort */ } });

const live = require(dist('services/phoneMirrorLiveAnswers.js'));

const ANSWER = 'I picked PostgreSQL for the ecosystem and the tooling around it.';

/** A real engine with stub models, wired to the phone mirror; the sink records what the phone gets. */
function setup() {
  const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
  const { SessionTracker } = require(dist('SessionTracker.js'));
  const session = new SessionTracker();
  const say = (text, ago) => session.addTranscript({ speaker: 'system', text, timestamp: Date.now() - ago, final: true });
  say('We moved the launch to the 3rd because the SOC 2 audit slipped.', 60_000);
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
  engine.lastTriggerTime = 0;
  engine.whatToAnswerLLM = { async *generateStream() { yield ANSWER; } };
  engine.recapLLM = { async *generateStream() { yield 'We moved the launch '; yield 'because of the audit.'; } };
  engine.liveHelperLLM = { async *generateStream() { yield 'Now: '; yield 'the audit.'; } };
  const done = [];
  const tokens = [];
  const discarded = [];
  const sink = {
    publishUserMessage() {}, publishError() {}, publishAssistantMessage() {},
    publishToken: (id, token, opts) => tokens.push({ id, token, label: opts?.label }),
    publishDiscard: (id) => discarded.push(id),
    publishDone: (id, content, opts) => done.push({ id, content, label: opts?.label }),
  };
  const mirror = live.wireLiveAnswersToPhone(engine, () => sink);
  return { engine, done, tokens, discarded, mirror };
}

describe('a press knows its own answer, with the real engine', () => {
  test('What to Answer pressed: the answer streamed to the phone belongs to the press', async () => {
    const { engine, done, mirror } = setup();
    const press = live.startPhonePress();
    const answer = await press.run(() => engine.runWhatShouldISay('Why PostgreSQL?', 0.9, undefined, { skipCooldown: true, forceFresh: true }));
    assert.equal(answer, ANSWER);
    assert.deepEqual(done.map((d) => [d.label, d.content]), [['What to Answer', ANSWER]]);
    assert.equal(press.answeredOnPhone, true, 'the handler does not publish a second copy');
    mirror.dispose();
    engine.reset();
  });

  test('Recap pressed: same', async () => {
    const { engine, done, mirror } = setup();
    const press = live.startPhonePress();
    const summary = await press.run(() => engine.runRecap());
    assert.ok(summary);
    assert.deepEqual(done.map((d) => d.label), ['Recap']);
    assert.equal(press.answeredOnPhone, true);
    mirror.dispose();
  });

  test('What did I miss? pressed: same', async () => {
    const { engine, done, mirror } = setup();
    const press = live.startPhonePress();
    const text = await press.run(() => engine.runLiveHelper('catch_me_up'));
    assert.equal(text, 'Now: the audit.');
    assert.deepEqual(done.map((d) => d.label), ['What did I miss?']);
    assert.equal(press.answeredOnPhone, true);
    mirror.dispose();
  });

  test('an Auto Answer finishing during a press, overtaking it: never counted as the press\'s answer', async () => {
    const { engine, done, tokens, discarded, mirror } = setup();
    let release;
    const held = new Promise((r) => { release = r; });
    let started;
    const streaming = new Promise((r) => { started = r; });
    engine.liveHelperLLM = { async *generateStream() { yield 'SOC 2 is'; started(); await held; yield ' an audit.'; } };
    const press = live.startPhonePress();
    const pressing = press.run(() => engine.runLiveHelper('define'));
    await streaming;
    // The engine answering on its own, outside any press: a newer generation
    // that overtakes the press, which then ends without an answer.
    const auto = await engine.runWhatShouldISay('Why PostgreSQL?', 0.9, undefined, { skipCooldown: true, forceFresh: true });
    assert.equal(auto, ANSWER);
    assert.deepEqual(done.map((d) => d.label), ['What to Answer']);
    assert.equal(press.answeredOnPhone, false, 'the Auto Answer is not the press\'s answer');
    release();
    const text = await pressing;
    assert.equal(text, null, 'the press was overtaken');
    // Its half answer stays as written, as the overlay keeps the row.
    const defineIds = [...new Set(tokens.filter((t) => t.label === 'Define').map((t) => t.id))];
    assert.equal(defineIds.length, 1);
    assert.deepEqual(done.map((d) => [d.id, d.label, d.content]).slice(1), [[defineIds[0], 'Define', 'SOC 2 is']]);
    assert.deepEqual(discarded, []);
    mirror.dispose();
    engine.reset();
  });

  test('Recap pressed again mid-answer: the first card ends as written, the second has its own', async () => {
    const { engine, done, tokens, discarded, mirror } = setup();
    let release;
    const held = new Promise((r) => { release = r; });
    let started;
    const streaming = new Promise((r) => { started = r; });
    let calls = 0;
    engine.recapLLM = {
      async *generateStream() {
        if (calls++ === 0) { yield 'Old '; started(); await held; yield 'never shown'; return; }
        yield 'New '; yield 'recap.';
      },
    };
    const first = live.startPhonePress();
    const firstRun = first.run(() => engine.runRecap());
    await streaming;
    const second = live.startPhonePress();
    const summary = await second.run(() => engine.runRecap());
    release();
    // runRecap returns what it had when overtaken; the handler would copy it.
    assert.equal(await firstRun, 'Old ');
    assert.equal(summary, 'New recap.');
    const ids = [...new Set(tokens.map((t) => t.id))];
    assert.equal(ids.length, 2, 'the second press never wrote into the first card');
    assert.deepEqual(tokens.filter((t) => t.id === ids[0]).map((t) => t.token), ['Old '], 'nothing after it was overtaken');
    assert.deepEqual(done.map((d) => [d.id, d.content]), [[ids[1], 'New recap.'], [ids[0], 'Old ']]);
    assert.deepEqual(discarded, []);
    assert.equal(first.answeredOnPhone, true, 'its card is on the phone: no second copy');
    assert.equal(second.answeredOnPhone, true);
    mirror.dispose();
  });

  test('an Auto Answer outside any press marks nothing', async () => {
    const { engine, done, mirror } = setup();
    const press = live.startPhonePress();
    await engine.runWhatShouldISay('Why PostgreSQL?', 0.9, undefined, { skipCooldown: true, forceFresh: true });
    assert.equal(done.length, 1);
    assert.equal(press.answeredOnPhone, false);
    mirror.dispose();
    engine.reset();
  });
});
