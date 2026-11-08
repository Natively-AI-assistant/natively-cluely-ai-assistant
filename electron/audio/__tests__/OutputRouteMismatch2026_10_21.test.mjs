// Windows: meeting audio playing on an output the loopback is not bound to
// (eCommunications default, or a device chosen inside Zoom/Teams) used to be
// indistinguishable from a quiet meeting — no transcript, no banner. The
// detector turns per-endpoint output peaks into a re-target or a banner, and
// must stay silent for everything that is NOT that situation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OutputRouteMismatchDetector,
  QUIET_MS,
  QUIET_AFTER_SIGNAL_MS,
  SWITCH_COOLDOWN_MS,
} from '../outputRouteMismatch.mjs';

const SPEAKERS = 'speakers';
const HEADSET = 'headset';
const USB_DAC = 'usb-dac';

/** One observation per second, as main.ts polls. */
function run(detector, seconds, { startMs = 0, quietSinceMs = 1, heardSignal = false, captured = SPEAKERS, explicit = false, playing = {} }) {
  const decisions = [];
  for (let i = 0; i < seconds; i++) {
    const nowMs = startMs + i * 1000;
    const peaks = [SPEAKERS, HEADSET, USB_DAC].map((id) => ({ id, peak: playing[id] ?? 0 }));
    const d = detector.observe({
      nowMs, quietSinceMs, heardSignal, capturedId: captured, explicit,
      defaultId: SPEAKERS, commsId: HEADSET, peaks,
    });
    if (d.type !== 'none') decisions.push({ ...d, nowMs });
  }
  return decisions;
}

test('a quiet meeting with nothing playing anywhere never acts', () => {
  assert.deepEqual(run(new OutputRouteMismatchDetector(), 120, {}), []);
});

test('meeting on the communications default while we loop back the console default: switch to it', () => {
  const decisions = run(new OutputRouteMismatchDetector(), 20, { playing: { [HEADSET]: 0.3 } });
  assert.equal(decisions.length, 1);
  assert.deepEqual({ type: decisions[0].type, deviceId: decisions[0].deviceId }, { type: 'switch', deviceId: HEADSET });
  assert.ok(decisions[0].nowMs >= QUIET_MS, 'must not act before the capture has been quiet long enough');
});

test('a notification blip on another device does not move the capture', () => {
  // Two seconds of sound on the headset, then nothing.
  const blip = new OutputRouteMismatchDetector();
  const out = [];
  for (let i = 0; i < 30; i++) {
    const peak = i >= 10 && i < 12 ? 0.5 : 0;
    const r = blip.observe({
      nowMs: i * 1000, quietSinceMs: 1, heardSignal: false, capturedId: SPEAKERS, explicit: false,
      defaultId: SPEAKERS, commsId: HEADSET,
      peaks: [{ id: SPEAKERS, peak: 0 }, { id: HEADSET, peak }],
    });
    if (r.type !== 'none') out.push(r);
  }
  assert.deepEqual(out, []);
});

test('our own capture carrying signal recently blocks any action', () => {
  // quietSinceMs is "now" every tick: the interviewer is being heard.
  const d = new OutputRouteMismatchDetector();
  for (let i = 0; i < 30; i++) {
    const nowMs = i * 1000;
    const r = d.observe({
      nowMs, quietSinceMs: nowMs, heardSignal: true, capturedId: SPEAKERS, explicit: false,
      defaultId: SPEAKERS, commsId: HEADSET,
      peaks: [{ id: SPEAKERS, peak: 0 }, { id: HEADSET, peak: 0.4 }],
    });
    assert.equal(r.type, 'none');
  }
});

test('no chunk yet (quietSinceMs 0) never acts', () => {
  assert.deepEqual(run(new OutputRouteMismatchDetector(), 30, { quietSinceMs: 0, playing: { [HEADSET]: 0.4 } }), []);
});

test('the captured endpoint itself playing is not a routing fault', () => {
  assert.deepEqual(run(new OutputRouteMismatchDetector(), 30, { playing: { [SPEAKERS]: 0.4, [HEADSET]: 0.4 } }), []);
});

test('an explicit Settings choice is honored: banner once, never a switch', () => {
  const decisions = run(new OutputRouteMismatchDetector(), 120, { explicit: true, playing: { [HEADSET]: 0.4 } });
  assert.deepEqual(decisions.map((d) => [d.type, d.deviceId]), [['warn', HEADSET]]);
});

test('a non-default device is warned about, not followed', () => {
  const decisions = run(new OutputRouteMismatchDetector(), 120, { playing: { [USB_DAC]: 0.4 } });
  assert.deepEqual(decisions.map((d) => [d.type, d.deviceId]), [['warn', USB_DAC]]);
});

test('a switch to the same device is not repeated inside the cooldown', () => {
  const d = new OutputRouteMismatchDetector();
  // The capture got reverted (e.g. by recovery) and the mismatch persists.
  const decisions = run(d, Math.ceil(SWITCH_COOLDOWN_MS / 1000) + 20, { playing: { [HEADSET]: 0.4 } });
  assert.equal(decisions.filter((x) => x.type === 'switch').length, 2);
  assert.ok(decisions[1].nowMs - decisions[0].nowMs >= SWITCH_COOLDOWN_MS);
});

test('after switching, the console default playing can bring the capture back', () => {
  const d = new OutputRouteMismatchDetector();
  run(d, 20, { playing: { [HEADSET]: 0.4 } });
  const back = run(d, 20, { startMs: 30_000, quietSinceMs: 30_000, captured: HEADSET, playing: { [SPEAKERS]: 0.4 } });
  assert.deepEqual(back.map((x) => [x.type, x.deviceId]), [['switch', SPEAKERS]]);
});

test('a capture that has carried signal is never switched, only warned about after a long silence', () => {
  // Interviewer heard earlier, now silent while the candidate answers; a
  // ringtone / clip plays on the communications default meanwhile.
  const d = new OutputRouteMismatchDetector();
  const early = run(d, Math.ceil(QUIET_AFTER_SIGNAL_MS / 1000) - 2, { heardSignal: true, playing: { [HEADSET]: 0.4 } });
  assert.deepEqual(early, [], 'no action inside the long quiet window');
  const late = run(d, 10, { startMs: QUIET_AFTER_SIGNAL_MS, heardSignal: true, playing: { [HEADSET]: 0.4 } });
  assert.deepEqual(late.map((x) => [x.type, x.deviceId]), [['warn', HEADSET]]);
});

test('reset() starts a new meeting clean', () => {
  const d = new OutputRouteMismatchDetector();
  run(d, 120, { explicit: true, playing: { [HEADSET]: 0.4 } });
  d.reset();
  assert.equal(run(d, 20, { explicit: true, playing: { [HEADSET]: 0.4 } }).length, 1);
});
