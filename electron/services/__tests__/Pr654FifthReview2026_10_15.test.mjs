// PR 654, fifth review (2026-10-15).
//  1. Turning Start automatically off during a countdown stops it (and the
//     countdown rechecks the setting before it starts anything).
//  2. A meeting that ends while a failover stand-in carries a channel waits
//     for the stand-in's last words (bounded, per provider) before the
//     providers stop and the transcript is saved; with no stand-in, no wait.
// Fake clocks, timers and providers; platform-neutral modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
const { MeetingOffers } = require(dist('services/meetingDetection/meetingOffer.js'));
const { SttFailover } = require(dist('audio/sttFailover.js'));
const { sttTailTimingFor } = require(dist('audio/sttTailTiming.js'));
const { liveTimingFor } = require(dist('services/dictation/dictationSession.js'));

function offerRig({ focused = false } = {}) {
    let t = 0;
    let auto = true;
    let blocked = false;
    const timers = new Map();
    let seq = 0;
    const state = { panel: [], notes: [], closed: 0, starts: [] };
    const offers = new MeetingOffers({
        isMeetingActive: () => false, requestStart: (r) => state.starts.push(r), autoStart: () => auto,
        showPanel: (o) => state.panel.push(o), notify: (n) => { state.notes.push(n); return true; },
        closeNotification: () => { state.closed++; }, launcherFocused: () => focused,
        promptsBlocked: () => blocked,
        now: () => t,
        setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
        clearTimeout: (id) => timers.delete(id),
    });
    const advance = (ms) => { t += ms; for (const [id, x] of [...timers]) if (x.at <= t) { timers.delete(id); x.fn(); } };
    return { offers, state, advance, setAuto: (v) => { auto = v; }, setBlocked: (v) => { blocked = v; } };
}
const CALL = { app: 'Zoom', body: 'A Zoom call started.', start: { via: 'detected' }, callId: 'app:Zoom' };

test('Start automatically turned off mid-countdown: no start; the offer stays as plain Start / Not now', () => {
    const r = offerRig();
    r.offers.offer(CALL);
    assert.equal(r.state.notes[0].title, 'Starting Natively');
    r.advance(4_000);
    r.setAuto(false);
    r.offers.autoStartOff();
    const view = r.offers.view();
    assert.ok(view, 'still offered');
    assert.equal(view.autoStartAt, null, 'no countdown on the panel');
    assert.equal(r.state.panel.at(-1).autoStartAt, null, 'the panel was told');
    assert.equal(r.state.notes.at(-1).title, 'Start Natively?', 'the notification no longer says it starts by itself');
    r.advance(20_000);
    assert.deepEqual(r.state.starts, []);
    // Start still works by hand.
    assert.equal(r.offers.start(view.id), true);
    assert.equal(r.state.starts.length, 1);
});

test('the countdown rechecks the setting when it ends, even if nothing told it', () => {
    const r = offerRig({ focused: true });
    r.offers.offer(CALL);
    r.setAuto(false);
    r.advance(10_000);
    assert.deepEqual(r.state.starts, []);
    assert.ok(r.offers.view(), 'the offer stays');
    assert.equal(r.offers.view().autoStartAt, null);
    assert.equal(r.state.notes.length, 0, 'launcher in front: still no notification');
    // Turning it off with no countdown running changes nothing.
    const before = r.state.panel.length;
    r.offers.autoStartOff();
    assert.equal(r.state.panel.length, before);
    const ipc = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
    assert.match(ipc, /if \(!on\) require\('\.\/services\/meetingDetection\/wireMeetingDetection'\)\.getMeetingOffers\(\)\?\.autoStartOff\(\);/);
});

class FakeStt extends EventEmitter {
    constructor() { super(); this.stopped = 0; this.ended = 0; this.finalized = 0; }
    setSampleRate() {} setAudioChannelCount() {} start() {} write() {}
    notifySpeechEnded() { this.ended++; }
    finalize() { this.finalized++; }
    stop() { this.stopped++; }
}

function failoverRig(id, { pendingUntil = null } = {}) {
    let t = 0;
    const made = [];
    const out = [];
    const f = new SttFailover({
        source: 'mic', primary: 'soniox', candidates: () => [id],
        create: () => {
            const s = new FakeStt();
            if (pendingUntil !== null) s.hasPendingWork = () => t < pendingUntil;
            made.push(s);
            return s;
        },
        onTranscript: (seg) => out.push(seg.text), onStatus: () => {}, restartPrimary: () => {},
        setInterval: () => 1, clearInterval: () => {},
        now: () => t, sleep: async (ms) => { t += ms; for (const h of hooks) h(t); },
    });
    const hooks = [];
    return { f, made, out, at: (ms, fn) => hooks.push((now) => { if (now >= ms && !fn.done) { fn.done = true; fn(); } }), now: () => t };
}

test('meeting end with a streaming stand-in: told the audio is over, its last line lands before the stop', async () => {
    const r = failoverRig('deepgram');
    r.f.engage();
    const dg = r.made[0];
    r.at(600, () => dg.emit('transcript', { text: 'and that is the plan', isFinal: true }));
    await r.f.drain();
    assert.equal(dg.ended, 1);
    assert.equal(dg.finalized, 1);
    assert.deepEqual(r.out, ['and that is the plan']);
    assert.ok(r.now() >= 600 + 1_500 && r.now() < 600 + 1_500 + 400, `quiet for its idle time after the line (${r.now()} ms)`);
    r.f.stop();
    assert.equal(dg.stopped, 1);
});

test('meeting end with a Groq stand-in uploading: waits for the upload, within its limit', async () => {
    const r = failoverRig('groq', { pendingUntil: 15_000 });
    r.f.engage();
    const groq = r.made[0];
    r.at(14_800, () => groq.emit('transcript', { text: 'the last upload', isFinal: true }));
    await r.f.drain();
    assert.deepEqual(r.out, ['the last upload']);
    // A stuck upload is still bounded by the provider's hard limit.
    const stuck = failoverRig('groq', { pendingUntil: Infinity });
    stuck.f.engage();
    await stuck.f.drain();
    assert.ok(stuck.now() >= 45_000 && stuck.now() < 46_000, `${stuck.now()} ms`);
});

test('no stand-in running: the drain returns at once, and main awaits it before stopping the providers and saving', async () => {
    const r = failoverRig('deepgram');
    await r.f.drain();
    assert.equal(r.now(), 0, 'no wait at all');
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    const end = main.slice(main.indexOf('private async endMeetingTransition()'));
    const finalize = end.indexOf('this.googleSTT_User?.finalize?.();');
    const drains = end.indexOf('this._sttFailover.system?.drain(),');
    const grace = end.indexOf('await new Promise(resolve => setTimeout(resolve, 250));');
    const awaited = end.indexOf('await standInDrain;');
    const stop = end.indexOf('this.googleSTT?.stop();');
    const save = end.indexOf('await this.intelligenceManager.stopMeeting()');
    assert.ok(finalize > 0 && finalize < drains, 'the stand-ins are told with the primaries');
    assert.ok(grace < awaited && awaited < stop && stop < save, 'awaited after the grace, before the stop and the save');
    assert.match(end, /this\._sttFailover\.mic\?\.drain\(\),/);
    // One timing table for dictation and the drain.
    for (const id of ['groq', 'local-whisper', 'deepgram', 'apple-speech']) assert.deepEqual(liveTimingFor(id), sttTailTimingFor(id), id);
});

test('Undetectable turned on while an offer waits: nothing shows again and nothing starts', () => {
    const r = offerRig();
    r.offers.offer(CALL);
    const shown = r.state.notes.length;
    r.advance(3_000);
    r.setBlocked(true);
    r.setAuto(false);
    r.offers.autoStartOff();
    assert.equal(r.state.notes.length, shown, 'no fresh notification');
    assert.equal(r.offers.view(), null, 'the offer is dropped');
    assert.equal(r.state.panel.at(-1), null, 'the panel is cleared');
    const r2 = offerRig();
    r2.offers.offer(CALL);
    r2.advance(2_000);
    r2.setBlocked(true);
    r2.advance(20_000);
    assert.deepEqual(r2.state.starts, [], 'the countdown never starts a meeting under Undetectable');
});
