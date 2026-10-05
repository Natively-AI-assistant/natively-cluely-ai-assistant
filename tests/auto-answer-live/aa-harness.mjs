// tests/auto-answer-live/aa-harness.mjs
//
// LIVE Auto Answer run through the real capture stack and real STT — nothing
// is injected:
//   interviewer → `say` rendered to a file (silence trimmed at both ends, so the
//                 end of playback IS the end of speech), played by ffmpeg on all
//                 16 channels of BlackHole 16ch = the meeting's OUTPUT device, so
//                 the CoreAudio tap captures it as the system-audio channel;
//   candidate   → `say` into BlackHole 2ch = the meeting's MIC.
// (All 16 channels: the tap averages the device's channels to mono, and `say -a`
// on one channel arrived 24 dB quiet — see tests/meeting-memory/live-audio.)
//
// The renderer listeners timestamp every answer token batch and final with the
// same wall clock the harness uses for speech end, so
//   stop→first token  and  stop→final
// are measured at the renderer boundary the user actually sees.
//
// Prereqs: BlackHole 2ch + 16ch, ffmpeg, and this worktree's app running via
// `NATIVELY_E2E=1 node scripts/dev-agent.mjs`, profile set up with
// setup-profile.mjs.
//
//   node tests/auto-answer-live/aa-harness.mjs --script ti --label ti-natively [--noise 0.004]

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep, withTimeout } from './cdp.mjs';
import { SCRIPTS } from './scripts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const scriptName = opt('script', 'ti');
const label = opt('label', `${scriptName}-${Date.now()}`);
const only = opt('only', null);           // comma list of interviewer ids to keep (plus the user turns after them)
const WPM = Number(opt('wpm', 180));
const VOICE = { interviewer: opt('voice', 'Samantha'), user: 'Daniel' };
const ANSWER_WAIT_MS = Number(opt('wait', 25000));
const SILENT_WATCH_MS = Number(opt('silentWatch', 7000));
const noise = opt('noise', null);        // e.g. 0.004 — a pink-noise bed under the interviewer, like a real call

const script = SCRIPTS[scriptName];
if (!script) throw new Error(`unknown script ${scriptName}`);

// ── audio ────────────────────────────────────────────────────────────────────
function sayDeviceId(name) {
  const out = execFileSync('say', ['-a', '?'], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.includes(name));
  if (!line) throw new Error(`say has no output device "${name}"`);
  return line.trim().split(/\s+/)[0];
}
function ffmpegDeviceIndex(name) {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'anullsrc', '-t', '0.05', '-f', 'audiotoolbox', '-list_devices', 'true', '-'], { encoding: 'utf8' });
  const m = String(out.stderr).match(new RegExp(`\\[(\\d+)\\]\\s+${name}\\b`));
  if (!m) throw new Error(`ffmpeg sees no audio device "${name}"`);
  return m[1];
}
ffmpegDeviceIndex('BlackHole 16ch');
const PAN_ALL_16 = `pan=16c|${Array.from({ length: 16 }, (_, i) => `c${i}=c0`).join('|')}`;
const CLIP_DIR = path.join(os.tmpdir(), `aa-clips-${process.pid}`);
fs.mkdirSync(CLIP_DIR, { recursive: true });

/** Render once, trimmed at both ends: playback end == end of speech. */
function renderClip(text, i, voice = VOICE.interviewer) {
  const raw = path.join(CLIP_DIR, `c${i}.aiff`);
  const wav = path.join(CLIP_DIR, `c${i}.wav`);
  // `say -o` can wedge (seen: 21 min on one clip while another process used
  // speech synthesis). Bound it and retry, rather than hang the whole run.
  for (let attempt = 1; ; attempt++) {
    try { execFileSync('say', ['-v', voice, '-r', String(WPM), '-o', raw, text], { timeout: 30000 }); break; } catch (e) {
      if (attempt >= 3) throw new Error(`say failed 3x rendering clip ${i}: ${e.message}`);
      console.warn(`say stalled on clip ${i} (attempt ${attempt}); retrying`);
    }
  }
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', trim, '-ar', '48000', '-ac', '1', wav]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }).trim());
  return { wav, dur };
}
function playInterviewer(wav) {
  return new Promise((resolve, reject) => {
    const inputs = ['-re', '-i', wav];
    const filter = noise
      ? ['-filter_complex', `anoisesrc=color=pink:amplitude=${noise}:sample_rate=48000[n];[0:a][n]amix=inputs=2:duration=first:normalize=0,${PAN_ALL_16}`]
      : ['-af', PAN_ALL_16];
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...inputs, ...filter, '-f', 'audiotoolbox', '-audio_device_index', ffmpegDeviceIndex('BlackHole 16ch'), '-'], { stdio: 'ignore' });
    const start = Date.now();
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ start, end: Date.now() }) : reject(new Error(`ffmpeg exited ${code}`))));
  });
}
function speakUser(text) {
  return new Promise((resolve, reject) => {
    const p = spawn('say', ['-v', VOICE.user, '-a', sayDeviceId('BlackHole 2ch'), '-r', String(WPM), text], { stdio: 'ignore' });
    const start = Date.now();
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ start, end: Date.now() }) : reject(new Error(`say exited ${code}`))));
  });
}

// ── plan ─────────────────────────────────────────────────────────────────────
let steps = script;
if (only) {
  const keep = new Set(only.split(','));
  steps = [];
  let keeping = false;
  for (const s of script) {
    if (s.who === 'interviewer') keeping = keep.has(s.id);
    if (keeping) steps.push(s);
  }
}
let clipNo = 0;
for (const s of steps) {
  if (s.who !== 'interviewer') continue;
  // `voice` lets several participants share the meeting audio (team meet).
  s.clips = s.parts.map((p) => (typeof p === 'string' ? { ...renderClip(p, clipNo++, s.voice), text: p } : p));
}
console.log(`rendered ${clipNo} clips`);

// ── app ──────────────────────────────────────────────────────────────────────
const { evalIn, isGone } = await connect();
const e2e = (channel, ...a) => evalIn('launcher', ([c, rest]) => window.electronAPI.e2eInvoke(c, ...rest), [channel, a], 90000);

const INSTALL = () => {
  const w = window;
  try { w.__aaUnsub?.(); } catch { /* noop */ }
  w.__aa = { events: [] };
  const push = (e) => w.__aa.events.push({ t: Date.now(), ...e });
  const u1 = w.electronAPI.onIntelligenceTokenBatch((d) => {
    if (d?.kind !== 'suggested_answer') return;
    for (const it of d.items ?? []) push({ k: 'token', gen: it.generationId ?? null, q: it.question ?? null, len: String(it.token ?? '').length, tok: String(it.token ?? '').slice(0, 60) });
  });
  const u2 = w.electronAPI.onIntelligenceSuggestedAnswer((d) => push({ k: 'final', gen: d.generationId ?? null, q: d.question ?? null, answer: d.answer ?? '', emittedAt: d.emittedAt ?? null }));
  const u3 = w.electronAPI.onIntelligenceSuggestedAnswerDiscard((d) => push({ k: 'discard', reason: d?.reason ?? null }));
  w.__aaUnsub = () => { u1(); u2(); u3(); };
  return true;
};
const drain = async (win) => evalIn(win, () => { const e = window.__aa?.events ?? []; if (window.__aa) window.__aa.events = []; return e; });

const inputs = await evalIn('launcher', () => window.electronAPI.getInputDevices());
const outputs = await evalIn('launcher', () => window.electronAPI.getOutputDevices());
const mic = inputs.find((d) => /blackhole 2ch/i.test(d.name));
const sys = outputs.find((d) => /blackhole 16ch/i.test(d.name));
if (!mic || !sys) throw new Error('BlackHole devices not visible to Natively');

await evalIn('launcher', () => window.electronAPI.endMeeting()).catch(() => {});
await sleep(2500);
const started = await evalIn('launcher', (a) => window.electronAPI.startMeeting({ audio: a }), { inputDeviceId: mic.id, outputDeviceId: sys.id }, 90000);
if (started && started.success === false) throw new Error(`startMeeting failed: ${started.error}`);
await sleep(3000);
for (const win of ['launcher', 'overlay']) await evalIn(win, INSTALL);

const outDir = path.join(HERE, 'results');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${label}.json`);
const out = { label, script: scriptName, wpm: WPM, noise, startedAt: new Date().toISOString(), t0: Date.now(), turns: [], events: [], notes: [] };
const save = () => fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

// Warm-up: both channels must be live before the scored turns (the relay's
// first final can lag the first utterance). Not scored.
const warm = renderClip('Okay, just a quick sound check before we begin.', 'warm');
await playInterviewer(warm.wav);
await speakUser('Sounds good, I can hear you.');
await sleep(4000);
for (const win of ['launcher', 'overlay']) out.events.push(...(await drain(win)).map((e) => ({ ...e, win, phase: 'warmup' })));
out.warmupEnd = Date.now();
save();

let lastFirstToken = null;   // for `after: 'firstToken'`
async function collect(ms, untilFinalAfter) {
  const t0 = Date.now();
  const got = [];
  while (Date.now() - t0 < ms) {
    for (const win of ['overlay', 'launcher']) got.push(...(await drain(win)).map((e) => ({ ...e, win })));
    if (untilFinalAfter && got.some((e) => e.k === 'final' && e.win === 'overlay' && e.t > untilFinalAfter)) break;
    if (isGone()) break;
    await sleep(150);
  }
  return got;
}

for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (isGone()) { out.notes.push('APP_GONE'); break; }
  if (s.who === 'user') {
    const r = await speakUser(s.text);
    out.turns.push({ who: 'user', text: s.text, ...r });
    out.events.push(...(await collect(1200)));
    save();
    continue;
  }
  if (s.after === 'firstToken' && lastFirstToken) {
    const wait = lastFirstToken + (s.delayMs ?? 1500) - Date.now();
    if (wait > 0) await sleep(wait);
  }
  const plays = [];
  for (const c of s.clips) {
    if (c.pause) { await sleep(c.pause); continue; }
    plays.push(await playInterviewer(c.wav));
  }
  const speechStart = plays[0].start;
  const speechEnd = plays[plays.length - 1].end;
  const turn = { who: 'interviewer', id: s.id, expect: s.expect, q: s.q ?? null, text: s.parts.filter((p) => typeof p === 'string').join(' '), speechStart, speechEnd, partEnds: plays.map((p) => p.end) };
  // A follow-up that is spoken WHILE the previous answer streams must not
  // wait here for it: the next step is the measurement.
  const next = steps[i + 1];
  const nextIsInterrupt = next?.who === 'interviewer' && next.after === 'firstToken';
  if (s.expect === 'silent') {
    const ev = await collect(SILENT_WATCH_MS);
    out.events.push(...ev);
  } else if (nextIsInterrupt) {
    const ev = [];
    const tStart = Date.now();
    while (Date.now() - tStart < ANSWER_WAIT_MS) {
      ev.push(...(await collect(300)));
      const ft = ev.find((e) => e.k === 'token' && e.win === 'overlay' && e.t > speechEnd);
      if (ft) { lastFirstToken = ft.t; break; }
    }
    out.events.push(...ev);
  } else {
    const ev = await collect(ANSWER_WAIT_MS, speechEnd);
    const ft = ev.find((e) => e.k === 'token' && e.win === 'overlay' && e.t > speechEnd);
    if (ft) lastFirstToken = ft.t;
    out.events.push(...ev);
    // Let a trailing final land before the candidate speaks.
    out.events.push(...(await collect(800)));
  }
  out.turns.push(turn);
  save();
  console.log(`${s.id} (${s.expect}) spoken ${((speechEnd - speechStart) / 1000).toFixed(1)}s`);
}
out.events.push(...(await collect(6000)));
out.finishedAt = Date.now();
save();
await evalIn('launcher', () => window.electronAPI.endMeeting()).catch(() => {});
console.log(`results: ${path.relative(process.cwd(), outFile)}`);
process.exit(0);
