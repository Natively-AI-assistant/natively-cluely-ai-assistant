// tests/meeting-memory/live-audio/live-audio-harness.mjs
//
// One-hour LIVE meeting through the real capture stack and real STT:
//   interviewer → `say` rendered to a file, played by ffmpeg on ALL 16 channels of
//                 BlackHole 16ch → the meeting's OUTPUT device, so the CoreAudio
//                 process tap captures it (system-audio channel);
//   candidate   → `say` into BlackHole 2ch  → the meeting's MIC.
// All 16 channels, not `say -a` (runs before 2026-09-24): the tap mixes the output
// device down to mono by AVERAGING its channels, so `say`'s voice arrived 24 dB
// quiet (RMS ~330 vs ~5,000) — under the relay VAD gate, which then dropped whole
// questions. That measured the rig, not a call. (BlackHole 16ch cannot be the mic
// instead: its input read silence here whatever was played into it.)
// Nothing is injected. Probes use the overlay's own entry points: What-to-answer
// (no question: resolved from the live transcript, like Cmd+Enter), typed
// questions through the real overlay input, and the live index's semantic search.
//
// Prereqs: `brew install --cask blackhole-2ch blackhole-16ch` and `brew install ffmpeg`; the app running via
// `NATIVELY_E2E=1 node scripts/dev-agent.mjs` with ambientChatEnabled=false in the
// isolated profile; the dev Electron allowed to use the microphone and to record
// system audio.
//
//   node tests/meeting-memory/live-audio/live-audio-harness.mjs [--minutes N] [--label name]

import { chromium } from 'playwright-core';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHour, FACTS, WPM as HOUR_WPM, TURN_GAP_S as HOUR_GAP } from './interview-hour.mjs';
import { buildMock, WPM as MOCK_WPM, TURN_GAP_S as MOCK_GAP } from './mock-tech-interview.mjs';
import { denialRe, distinctiveWords, renderSessionScreenshot } from '../scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'live-audio';
const maxMinutes = args.includes('--minutes') ? Number(args[args.indexOf('--minutes') + 1]) : Infinity;
const scriptName = args.includes('--script') ? args[args.indexOf('--script') + 1] : 'hour';
const WPM = scriptName === 'mock' ? MOCK_WPM : HOUR_WPM;
const TURN_GAP_S = scriptName === 'mock' ? MOCK_GAP : HOUR_GAP;
const VOICE = { interviewer: 'Samantha', user: 'Daniel' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout: ${what}`)), ms); })]).finally(() => clearTimeout(t));
}

// ── audio devices ────────────────────────────────────────────────────────────
function sayDeviceId(name) {
  const out = execFileSync('say', ['-a', '?'], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.includes(name));
  if (!line) throw new Error(`say has no output device "${name}" — is BlackHole installed?\n${out}`);
  return line.trim().split(/\s+/)[0];
}
const SAY_DEV = { interviewer: sayDeviceId('BlackHole 16ch'), user: sayDeviceId('BlackHole 2ch') };
function ffmpegDeviceIndex(name) {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'anullsrc', '-t', '0.05', '-f', 'audiotoolbox', '-list_devices', 'true', '-'], { encoding: 'utf8' });
  const m = String(out.stderr).match(new RegExp(`\\[(\\d+)\\]\\s+${name}\\b`));
  if (!m) throw new Error(`ffmpeg sees no audio device "${name}" (brew install ffmpeg)`);
  return m[1];
}
// Resolved PER LINE, by name: indexes shift when a device comes or goes. A run
// on 2026-09-25 lost 93 interviewer lines from minute 15 when "iPhone
// Microphone" (index 0, a Continuity device) dropped out and index 1 became
// BlackHole 2ch. Never play to anything but the named virtual device.
ffmpegDeviceIndex('BlackHole 16ch'); // fail fast at start if it is missing
const PAN_ALL_16 = `pan=16c|${Array.from({ length: 16 }, (_, i) => `c${i}=c0`).join('|')}`;

function speak(who, text) {
  return new Promise((resolve, reject) => {
    let p;
    if (who === 'interviewer') {
      const f = path.join(os.tmpdir(), `mm-interviewer-${process.pid}.aiff`);
      execFileSync('say', ['-v', VOICE[who], '-r', String(WPM), '-o', f, text]);
      p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-i', f, '-af', PAN_ALL_16, '-f', 'audiotoolbox', '-audio_device_index', ffmpegDeviceIndex('BlackHole 16ch'), '-'], { stdio: 'ignore' });
    } else {
      p = spawn('say', ['-v', VOICE[who], '-a', sayDeviceId('BlackHole 2ch'), '-r', String(WPM), text], { stdio: 'ignore' });
    }
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${who === 'interviewer' ? 'ffmpeg' : 'say'} exited ${code}`))));
  });
}

// ── app ──────────────────────────────────────────────────────────────────────
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-browser.json'), 'utf8'));
const browser = await withTimeout(chromium.connectOverCDP(`http://127.0.0.1:${cfg.cdp}`), 20000, 'connectOverCDP');
let appGone = false;
browser.on('disconnected', () => { appGone = true; });
async function page(win) {
  for (let i = 0; i < 40; i++) {
    const p = browser.contexts().flatMap((c) => c.pages()).find((pg) => {
      try { return !pg.isClosed() && new URL(pg.url()).searchParams.get('window') === win; } catch { return false; }
    });
    if (p) return p;
    await sleep(250);
  }
  throw new Error(appGone ? 'APP_GONE' : `no live page for window=${win}`);
}
const evalIn = async (win, fn, arg, ms = 30000) => withTimeout((await page(win)).evaluate(fn, arg), ms, `evaluate in ${win}`);
const e2e = (channel, ...a) => evalIn('launcher', ([c, rest]) => window.electronAPI.e2eInvoke(c, ...rest), [channel, a], 90000);
const probe = (opts = {}) => e2e('__e2e__:memory-probe', opts);

/** A typed turn WITH a screenshot — the IPC the meeting overlay uses when one is attached. */
async function typedTurnWithImage(text, imagePath) {
  const overlay = await page('overlay');
  await overlay.evaluate(({ value, img }) => {
    const w = window;
    try { w.__mmUnsub?.(); } catch { /* noop */ }
    w.__mm = { tok: '', done: null, err: null };
    const u1 = w.electronAPI.onGeminiStreamToken((t) => { w.__mm.tok += t; });
    const u2 = w.electronAPI.onGeminiStreamDone((d) => { w.__mm.done = (d && typeof d.finalText === 'string') ? d.finalText : w.__mm.tok; });
    const u3 = w.electronAPI.onGeminiStreamError((e) => { w.__mm.err = String(e); });
    w.__mmUnsub = () => { u1(); u2(); u3(); };
    w.electronAPI.streamGeminiChat(value, [img]).catch((e) => { w.__mm.err = String(e); });
  }, { value: text, img: imagePath });
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < 150000) {
    st = await overlay.evaluate(() => window.__mm);
    if (st?.done !== null || st?.err !== null) break;
    await sleep(400);
  }
  await sleep(1200);
  return { answer: st?.done ?? null, error: st?.err ?? (st?.done == null ? 'timeout' : null), ms: Date.now() - t0 };
}
const SCREEN_PNG = await renderSessionScreenshot(path.join(os.tmpdir(), `mm-live-screen-${process.pid}.png`));

async function typedTurn(text) {
  const overlay = await page('overlay');
  await overlay.evaluate(() => {
    const w = window;
    try { w.__mmUnsub?.(); } catch { /* noop */ }
    w.__mm = { tok: '', done: null, err: null };
    const u1 = w.electronAPI.onGeminiStreamToken((t) => { w.__mm.tok += t; });
    const u2 = w.electronAPI.onGeminiStreamDone((d) => { w.__mm.done = (d && typeof d.finalText === 'string') ? d.finalText : w.__mm.tok; });
    const u3 = w.electronAPI.onGeminiStreamError((e) => { w.__mm.err = String(e); });
    w.__mmUnsub = () => { u1(); u2(); u3(); };
  });
  const ok = await overlay.evaluate(async (value) => {
    const el = document.querySelector('[data-testid="overlay-chat-input"]');
    if (!el) return false;
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return true;
  }, text);
  if (!ok) throw new Error('overlay input missing');
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < 120000) {
    st = await overlay.evaluate(() => window.__mm);
    if (st?.done !== null || st?.err !== null) break;
    await sleep(400);
  }
  await sleep(1200);
  return { answer: st?.done ?? null, error: st?.err ?? (st?.done == null ? 'timeout' : null), ms: Date.now() - t0 };
}

async function wtaTurn() {
  const t0 = Date.now();
  const r = await evalIn('overlay', () => window.electronAPI.generateWhatToSay(), undefined, 150000);
  await sleep(1500);
  return { answer: r?.answer ?? null, error: r?.error ?? null, resolvedQuestion: r?.question ?? null, ms: Date.now() - t0 };
}

// ── scoring ──────────────────────────────────────────────────────────────────
function factOf(expect) {
  if (typeof expect === 'string') return FACTS[expect];
  if (expect instanceof RegExp) return { re: expect };
  return expect;  // { re, also }
}
const contentWords = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
/** Share of the asked question's content words present in the question the prompt actually answered. */
function questionOverlap(asked, promptQ) {
  const a = [...new Set(contentWords(asked))];
  if (!a.length) return 1;
  const p = new Set(contentWords(promptQ));
  return a.filter((w) => p.has(w)).length / a.length;
}
const promptQuestionOf = (u) => (String(u ?? '').match(/# Question\n([\s\S]*?)(?:\n\n#|$)/)?.[1] ?? '').trim();
function score(answer, expect) {
  if (!answer) return 'error';
  const f = factOf(expect);
  if (denialRe.test(answer)) return 'denied';
  return f.re.test(answer) && (!f.also || f.also.test(answer)) ? 'recalled' : 'wrong';
}
const where = (promptUser, re) => {
  const u = promptUser ?? '';
  const ev = u.indexOf('# Evidence');
  const conv = u.indexOf('# Conversation so far');
  return {
    inEvidence: ev >= 0 && re.test(u.slice(ev)),
    inHistory: conv >= 0 && re.test(u.slice(conv, ev > conv ? ev : undefined)),
  };
};

// ── run ──────────────────────────────────────────────────────────────────────
const built = scriptName === 'mock' ? buildMock() : buildHour();
const { steps } = built;
const estMinutes = built.estMinutes ?? null;
const outDir = path.join(ROOT, 'tests', 'meeting-memory', 'results');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${label}-${Date.now()}.json`);
const out = { label, script: scriptName, questions: built.questions ?? null, estMinutes, startedAt: new Date().toISOString(), devices: {}, probes: [], timeline: [], notes: [], says: [] };
const save = () => fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

const inputs = await evalIn('launcher', () => window.electronAPI.getInputDevices());
const outputs = await evalIn('launcher', () => window.electronAPI.getOutputDevices());
const mic = inputs.find((d) => /blackhole 2ch/i.test(d.name));
const sys = outputs.find((d) => /blackhole 16ch/i.test(d.name));
if (!mic || !sys) throw new Error(`BlackHole devices not visible to Natively: inputs=${JSON.stringify(inputs)} outputs=${JSON.stringify(outputs)}`);
out.devices = { mic, sys, say: SAY_DEV };

await evalIn('launcher', () => window.electronAPI.endMeeting()).catch(() => {});
await sleep(3000);
const started = await evalIn('launcher', (a) => window.electronAPI.startMeeting({ audio: a }), { inputDeviceId: mic.id, outputDeviceId: sys.id }, 90000);
if (started && started.success === false) throw new Error(`startMeeting failed: ${started.error}`);
await page('overlay');
await sleep(4000);
const t0 = Date.now();
const minute = () => +(((Date.now() - t0) / 60000).toFixed(2));

// Both channels must produce transcript before the hour starts.
// The interviewer channel's final for an utterance can arrive only when the NEXT
// interviewer utterance starts (relay VAD gate vs 20% keepalive cadence — see the
// run notes), so the warm-up speaks the interviewer twice.
await speak('interviewer', 'Hello, can you hear me clearly on your side?');
await speak('user', 'Yes, I can hear you clearly, thank you.');
await speak('interviewer', 'Great, let us get started then.');
let warm = null;
const warmStart = Date.now();
const fillers = ['Just checking the connection once more.', 'Alright, one more second.', 'Okay, I think we are ready.', 'Thanks for your patience.'];
for (let i = 0; i < 75; i++) {
  warm = (await probe()).transcript;
  if ((warm?.bySpeaker?.interviewer ?? 0) > 0 && (warm?.bySpeaker?.user ?? 0) > 0) break;
  if (i > 0 && i % 15 === 0) await speak('interviewer', fillers[(i / 15 - 1) % fillers.length]);
  await sleep(1000);
}
out.warmupSeconds = Math.round((Date.now() - warmStart) / 1000);
out.warmup = warm;
save();
if (!((warm?.bySpeaker?.interviewer ?? 0) > 0 && (warm?.bySpeaker?.user ?? 0) > 0)) {
  throw new Error(`a channel produced no transcript during warm-up: ${JSON.stringify(warm)}`);
}
console.log('warm-up ok', JSON.stringify(warm.bySpeaker));

const snap = async (tag) => {
  try {
    const r = await probe();
    out.timeline.push({ minute: minute(), tag, liveIndex: r.liveIndex, transcript: { count: r.transcript?.count, bySpeaker: r.transcript?.bySpeaker }, liveMeetingId: r.liveMeetingId });
    save();
  } catch (e) { out.notes.push(`snapshot failed at ${minute()}: ${e.message}`); }
};
const ticker = setInterval(() => { snap('tick'); }, 60000);

for (const step of steps) {
  if (minute() > maxMinutes) break;
  if (appGone) { out.notes.push('APP_GONE'); break; }
  try {
    if (step.kind === 'say') {
      const start = Date.now();
      await speak(step.who, step.text);
      out.says.push({ who: step.who, text: step.text, start, end: Date.now() });
      await sleep(TURN_GAP_S * 1000);
    } else if (step.kind === 'wta') {
      await sleep(2500);  // a person's reaction time; lets the STT final land
      const r = await wtaTurn();
      const m = await probe({ prompts: 1 });
      const f = factOf(step.expect);
      const promptUser = m.prompts?.[0]?.user ?? null;
      const rec = { kind: 'wta', id: step.id, minute: minute(), note: step.note, ...r, result: score(r.answer, step.expect),
        ...where(promptUser, (step.memory ?? f.re)), promptUser, liveIndex: m.liveIndex };
      if (step.asked) {
        rec.asked = step.asked;
        rec.promptQuestion = promptQuestionOf(promptUser);
        rec.questionOverlap = +questionOverlap(step.asked, rec.promptQuestion).toFixed(2);
        rec.denied = Boolean(r.answer) && denialRe.test(r.answer);
        rec.relevant = Boolean(r.answer) && f.re.test(r.answer);
        if (step.memory) {
          rec.memoryNeeded = true;
          rec.memoryRecalled = Boolean(r.answer) && step.memory.test(r.answer) && (!step.also || step.also.test(r.answer));
        }
        if (step.code) rec.codeProduced = /```|\bdef |\bfunction\b|=>|\bfor\s*\(|\bfunc\b/.test(r.answer ?? '');
        if (step.story) rec.storyBeforeTold = true;
      }
      out.probes.push(rec); save();
      console.log(`[${rec.minute}] ${step.id} ${rec.relevant === undefined ? rec.result : `rel=${rec.relevant}`}${rec.memoryNeeded ? ` mem=${rec.memoryRecalled}` : ''}${rec.questionOverlap !== undefined ? ` q=${rec.questionOverlap}` : ''} (${r.ms}ms)`);
    } else if (step.kind === 'typed') {
      const r = step.image ? await typedTurnWithImage(step.text, SCREEN_PNG) : await typedTurn(step.text);
      const m = await probe({ prompts: 1 });
      const rec = { kind: step.plant ? 'plant' : 'typed', id: step.id, minute: minute(), text: step.text, ...r };
      if (step.from) {
        // Recall of an earlier ANSWER: its distinctive words must come back.
        const src = out.probes.find((p) => p.id === step.from);
        const words = distinctiveWords(src?.answer, src?.text ?? src?.asked ?? '', step.text);
        const hit = words.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(r.answer ?? ''));
        const inP = words.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(m.prompts?.[0]?.user ?? ''));
        Object.assign(rec, { result: !r.answer ? 'error' : hit.length >= 3 ? 'recalled' : denialRe.test(r.answer) ? 'denied' : 'wrong',
          fromWords: { total: words.length, hit: hit.length, inPrompt: inP.length, sample: hit.slice(0, 8) }, original: src?.answer ?? null });
      } else if (!step.plant) {
        const f = factOf(step.expect);
        Object.assign(rec, { result: score(r.answer, step.expect), ...where(m.prompts?.[0]?.user, f.re) });
      }
      rec.promptUser = m.prompts?.[0]?.user ?? null;
      out.probes.push(rec); save();
      console.log(`[${rec.minute}] ${step.id} ${rec.result ?? 'planted'} (${r.ms}ms)`);
    } else if (step.kind === 'index') {
      const r = await e2e('__e2e__:live-index-search', { query: step.query, topK: 3 });
      const f = factOf(step.expect);
      const top = r?.chunks ?? [];
      const rec = { kind: 'index', id: step.id, minute: minute(), query: step.query, ok: r?.success ?? false, error: r?.error ?? null,
        hitRank: top.findIndex((c) => f.re.test(c.text) && (!f.also || f.also.test(c.text))), top };
      out.probes.push(rec); save();
      console.log(`[${rec.minute}] ${step.id} rank=${rec.hitRank} ${rec.error ?? ''}`);
    } else if (step.kind === 'act' && step.name === 'fail-embeds') {
      await e2e('__e2e__:fail-live-embeds', step.arg);
      out.notes.push(`injected ${step.arg} live-index embedding failures at minute ${minute()}`);
      await snap('fail-embeds');
    } else if (step.kind === 'mark') {
      await snap(`section ${step.minute} (est ${step.estMin})`);
      console.log(`--- minute ${minute()} (script ${step.minute}, est ${step.estMin})`);
    }
  } catch (e) {
    out.notes.push(`step ${step.kind} ${step.id ?? ''} failed at ${minute()}: ${e.message}`);
    save();
    if (appGone || String(e.message).includes('APP_GONE')) break;
  }
}
clearInterval(ticker);
await snap('end');

// The full real transcript and the live index's own chunks, before the meeting
// ends (post-meeting processing replaces the live chunks).
try {
  const full = await probe({ transcriptTail: 100000 });
  out.transcript = full.transcript?.last ?? [];
} catch (e) { out.notes.push(`transcript dump failed: ${e.message}`); }
try {
  const db = path.join(ROOT, '.agent', 'userdata', 'natively.db');
  const rows = execFileSync('sqlite3', ['-readonly', '-json', db, "select chunk_index, speaker, cleaned_text from chunks where meeting_id='live-meeting-current' order by chunk_index"], { encoding: 'utf8' });
  out.liveChunks = rows.trim() ? JSON.parse(rows) : [];
} catch (e) { out.notes.push(`chunk dump failed: ${e.message}`); }
save();

await evalIn('launcher', () => window.electronAPI.endMeeting()).catch(() => {});
out.finishedAt = new Date().toISOString();
save();
console.log(`results: ${path.relative(ROOT, outFile)}`);
process.exit(0);
