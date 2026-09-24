// tests/meeting-memory/live-memory-harness.mjs
//
// LIVE conversation-memory harness for the meeting overlay. Measures how far
// back the overlay can recall, in the real app, against a real model.
//
// Prerequisites (see tests/meeting-memory/README.md):
//   NATIVELY_E2E=1 NATIVELY_TEST_TRANSCRIPT_INJECTION=1 npm run dev:agent
// which writes ./agent-browser.json with the CDP port. This script only
// ATTACHES over CDP (never launches Electron — a Playwright launch uses a
// different safeStorage key and cannot read the profile's credentials).
//
// Usage:
//   node tests/meeting-memory/live-memory-harness.mjs <scenario> [--reps N] [--label name]
//   scenarios: typed | typed-quiet | typed-wta | typed-long | wta-followup | hour | interview | cross-meeting | all
//   --mode <templateType>   run with a mode of that template active (e.g. technical-interview)
//
// For every turn it records the answer, the model that served it, the V3
// conversation ring (key, scope, turn count) and — for probes — whether the
// planted fact was PRESENT in the composed prompt. That split is the point:
// "absent from the prompt" and "present but not used" need different fixes.

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TYPED_CHAT_FACTS, TYPED_CHAT_SCRIPT, TYPED_LONG_SCRIPT, CHATTER, HOUR_FACTS, buildHourTranscript, WTA_FOLLOWUP,
  INTERVIEW_FACTS, INTERVIEW_PROBES, buildInterviewTranscript, denialRe, score,
  CONSTRAINT_FACTS, CONSTRAINT_PROBES, CONSTRAINT_LEAK_RE, buildConstraintTranscript,
  buildSessionHourTranscript, renderSessionScreenshot, SESSION_PLANTS, SESSION_FILLER, SESSION_PROBES, distinctiveWords,
} from './scenarios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');

const args = process.argv.slice(2);
const scenario = args[0] ?? 'typed';
const reps = Number(args[args.indexOf('--reps') + 1]) || 1;
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'run';
const modeTemplate = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : null;
const fillerTurns = args.includes('--filler') ? Number(args[args.indexOf('--filler') + 1]) : 42;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout: ${what}`)), ms); })])
    .finally(() => clearTimeout(t));
}

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-browser.json'), 'utf8'));
const browser = await withTimeout(chromium.connectOverCDP(`http://127.0.0.1:${cfg.cdp}`), 20000, 'connectOverCDP');
// The app can go away mid-run (two unexplained `before-quit reason=user-quit`
// exits on 2026-09-24). Stop instead of recording every later turn as a failure.
let appGone = false;
browser.on('disconnected', () => { appGone = true; });

/** A LIVE page for a window, re-resolved every call — the overlay can be recreated between turns. */
async function page(win) {
  for (let i = 0; i < 40; i++) {
    const p = browser.contexts().flatMap((c) => c.pages()).find((pg) => {
      try { return !pg.isClosed() && new URL(pg.url()).searchParams.get('window') === win; } catch { return false; }
    });
    if (p) return p;
    await sleep(250);
  }
  throw new Error(appGone ? 'APP_GONE: the app quit mid-run' : `no live page for window=${win}`);
}
const evalIn = async (win, fn, arg, ms = 30000) => withTimeout((await page(win)).evaluate(fn, arg), ms, `evaluate in ${win}`);
const e2e = (channel, ...a) => evalIn('launcher', ([c, rest]) => window.electronAPI.e2eInvoke(c, ...rest), [channel, a], 60000);
const probe = (opts = {}) => e2e('__e2e__:memory-probe', opts);

async function modelUsed() {
  try { const r = await e2e('__e2e__:last-provider-model'); return r?.model ?? null; } catch { return null; }
}

async function inject(segments) {
  for (let i = 0; i < segments.length; i += 400) {
    const batch = segments.slice(i, i + 400);
    const r = await evalIn('launcher', (s) => window.electronAPI.debugInjectTranscript(s), batch, 60000);
    if (!r?.success) throw new Error(`inject failed: ${JSON.stringify(r)}`);
  }
}

let chatterIdx = 0;
async function injectChatter(n = 3) {
  const segs = [];
  for (let i = 0; i < n; i++) {
    const [speaker, text] = CHATTER[chatterIdx++ % CHATTER.length];
    segs.push({ speaker, text, timestamp: Date.now() - (n - i) * 1500 });
  }
  await inject(segs);
}

async function startMeeting() {
  await endMeeting(); // a leftover meeting from an aborted run would be reused
  // Silent virtual devices when installed. With `{}` the meeting captured the
  // Mac's DEFAULT output device, so whatever was playing (a football stream,
  // 2026-09-25) was transcribed into the test meeting — it resolved a
  // what-to-answer probe to the commentary, and it is the user's audio.
  const devices = await evalIn('launcher', async () => ({
    inputs: await window.electronAPI.getInputDevices(), outputs: await window.electronAPI.getOutputDevices(),
  }), undefined, 30000).catch(() => ({ inputs: [], outputs: [] }));
  const mic = devices.inputs.find((d) => /blackhole 2ch/i.test(d.name));
  const sys = devices.outputs.find((d) => /blackhole 16ch/i.test(d.name));
  if (!mic || !sys) console.warn('  (BlackHole devices not found — the meeting will capture the default devices)');
  const audio = mic && sys ? { inputDeviceId: mic.id, outputDeviceId: sys.id } : {};
  const r = await evalIn('launcher', (a) => window.electronAPI.startMeeting({ audio: a }), audio, 60000);
  if (r && r.success === false) throw new Error(`startMeeting failed: ${r.error}`);
  await page('overlay');
  await sleep(2500);
}
async function endMeeting() {
  try { await evalIn('launcher', () => window.electronAPI.endMeeting(), undefined, 60000); } catch { /* best effort */ }
  await sleep(3000);
}

/** One typed turn through the REAL overlay input. Resolves on stream done/error. */
async function typedTurn(text) {
  const overlay = await page('overlay');
  await withTimeout(overlay.evaluate(() => {
    const w = window;
    try { w.__mmUnsub?.(); } catch { /* noop */ }
    w.__mm = { tok: '', done: null, err: null };
    const u1 = w.electronAPI.onGeminiStreamToken((t) => { w.__mm.tok += t; });
    const u2 = w.electronAPI.onGeminiStreamDone((d) => { w.__mm.done = (d && typeof d.finalText === 'string') ? d.finalText : w.__mm.tok; });
    const u3 = w.electronAPI.onGeminiStreamError((e) => { w.__mm.err = String(e); });
    w.__mmUnsub = () => { u1(); u2(); u3(); };
  }), 10000, 'install stream listeners');
  // The input's own React handlers, driven through DOM events. Playwright's
  // locator.fill() waits on rAF-based actionability checks, which never settle
  // in a background Electron window (Chromium throttles rAF there).
  const typed = await withTimeout(overlay.evaluate(async (value) => {
    const el = document.querySelector('[data-testid="overlay-chat-input"]');
    if (!el) return 'no-input';
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150)); // let React commit inputValue
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return 'ok';
  }, text), 15000, 'type into overlay input');
  if (typed !== 'ok') throw new Error(`overlay input: ${typed}`);
  const t0 = Date.now();
  let state = null;
  while (Date.now() - t0 < 120000) {
    state = await withTimeout(overlay.evaluate(() => window.__mm), 10000, 'poll stream');
    if (state?.done !== null || state?.err !== null) break;
    await sleep(400);
  }
  await sleep(1200); // answer-side sinks (recordAnswerSummary) run after done
  const answer = state?.done ?? null;
  return { answer, error: state?.err ?? (answer === null ? 'timeout' : null), ms: Date.now() - t0 };
}

/** A typed turn WITH a screenshot, through the IPC the meeting overlay uses when a
 *  screenshot is attached (streamGeminiChat(message, imagePaths)). */
async function typedTurnWithImage(text, imagePath) {
  const overlay = await page('overlay');
  await withTimeout(overlay.evaluate(({ value, img }) => {
    const w = window;
    try { w.__mmUnsub?.(); } catch { /* noop */ }
    w.__mm = { tok: '', done: null, err: null };
    const u1 = w.electronAPI.onGeminiStreamToken((t) => { w.__mm.tok += t; });
    const u2 = w.electronAPI.onGeminiStreamDone((d) => { w.__mm.done = (d && typeof d.finalText === 'string') ? d.finalText : w.__mm.tok; });
    const u3 = w.electronAPI.onGeminiStreamError((e) => { w.__mm.err = String(e); });
    w.__mmUnsub = () => { u1(); u2(); u3(); };
    w.electronAPI.streamGeminiChat(value, [img]).catch((e) => { w.__mm.err = String(e); });
  }, { value: text, img: imagePath }), 15000, 'start image turn');
  const t0 = Date.now();
  let state = null;
  while (Date.now() - t0 < 150000) {
    state = await withTimeout(overlay.evaluate(() => window.__mm), 10000, 'poll stream');
    if (state?.done !== null || state?.err !== null) break;
    await sleep(400);
  }
  await sleep(1200);
  const answer = state?.done ?? null;
  return { answer, error: state?.err ?? (answer === null ? 'timeout' : null), ms: Date.now() - t0 };
}

/** What-to-answer through the overlay's own IPC call (Cmd+Enter equivalent). */
async function wtaTurn(question) {
  const t0 = Date.now();
  const r = await evalIn('overlay', (q) => window.electronAPI.generateWhatToSay(q), question, 150000);
  await sleep(1500);
  return { answer: r?.answer ?? null, error: r?.error ?? null, resolvedQuestion: r?.question ?? null, ms: Date.now() - t0 };
}

/** Snapshot of memory state + the last composed prompt. */
async function memoryState() {
  const r = await probe({ prompts: 1 });
  const key = r.conversationSessionId;
  const st = r.states.find((s) => s.key === key) ?? null;
  const last = r.prompts[r.prompts.length - 1] ?? null;
  return {
    engineKey: key,
    liveMeetingId: r.liveMeetingId,
    allKeys: r.states.map((s) => ({ key: s.key, scopeId: s.scopeId, turns: s.turns.length })),
    prompt: last,
  };
}

/** Where in the prompt a fact sits: the evidence block (retrieval) or the history block (memory). */
function factLocation(prompt, re) {
  const user = prompt?.user ?? '';
  const ev = user.indexOf('# Evidence');
  const evidence = ev >= 0 ? user.slice(ev) : '';
  return {
    factInPrompt: re.test(`${prompt?.system ?? ''}\n${user}`),
    factInEvidence: re.test(evidence),
    factInHistory: re.test(prompt?.conversationSummary ?? ''),
  };
}

// Scoring lives in scenarios.mjs so summarize.mjs can re-score saved answers.

// ── scenarios ───────────────────────────────────────────────────────────────

async function runTyped({ chatter = true, wtaInterleave = false, script = TYPED_CHAT_SCRIPT } = {}) {
  await startMeeting();
  const turns = [];
  const plantedAt = {};
  for (let i = 0; i < script.length; i++) {
    const step = script[i];
    if (chatter) await injectChatter(3);
    // Cross-surface: a what-to-answer turn on the SAME ring between typed turns,
    // the way a user presses Cmd+Enter mid-meeting.
    if (wtaInterleave && (i === 2 || i === 5 || i === 8)) {
      const w = await wtaTurn('What should I say about our onboarding timeline?');
      const m = await memoryState();
      turns.push({ i: `${i}w`, kind: 'wta', text: 'What should I say about our onboarding timeline?', answer: w.answer?.slice(0, 400), error: w.error, ms: w.ms, ring: m.allKeys, engineKey: m.engineKey, liveMeetingId: m.liveMeetingId, promptScope: m.prompt?.scope ?? null, promptSurface: m.prompt?.surface ?? null });
      console.log(`  [${i}w] wta ${w.ms}ms ring=${JSON.stringify(m.allKeys)}`);
    }
    const r = await typedTurn(step.text);
    const m = await memoryState();
    const rec = {
      i: i + 1, kind: step.kind, fact: step.fact ?? null, text: step.text,
      answer: r.answer, error: r.error, ms: r.ms, model: await modelUsed(),
      engineKey: m.engineKey, liveMeetingId: m.liveMeetingId, ring: m.allKeys,
      promptSurface: m.prompt?.surface ?? null, promptScope: m.prompt?.scope ?? null,
      conversationChars: m.prompt?.conversationSummary?.length ?? 0,
    };
    if (step.kind === 'plant') {
      plantedAt[step.fact] = i + 1;
      // Did the assistant push back on the user's own statement when it was made?
      rec.pushback = Boolean(r.answer) && denialRe.test(r.answer);
    }
    if (step.kind === 'probe') {
      const f = TYPED_CHAT_FACTS[step.fact];
      rec.distance = i + 1 - plantedAt[step.fact];
      const promptText = `${m.prompt?.system ?? ''}\n${m.prompt?.user ?? ''}`;
      rec.factInPrompt = f.re.test(promptText);
      rec.factInConversationBlock = f.re.test(m.prompt?.conversationSummary ?? '');
      rec.result = score(r.answer, f.re);
      rec.promptUser = m.prompt?.user ?? null;
    }
    turns.push(rec);
    console.log(`  [${i + 1}] ${step.kind}${step.fact ? `:${step.fact}` : ''} ${r.ms}ms ${rec.result ?? ''}${rec.distance !== undefined ? ` d=${rec.distance} inPrompt=${rec.factInPrompt}` : ''} ring=${JSON.stringify(m.allKeys)} live=${m.liveMeetingId}`);
  }
  await endMeeting();
  return { turns };
}

async function runWtaFollowup() {
  await startMeeting();
  await injectChatter(4);
  await inject([{ speaker: WTA_FOLLOWUP.first[0], text: WTA_FOLLOWUP.first[1], timestamp: Date.now() }]);
  const a1 = await wtaTurn(undefined);
  const m1 = await memoryState();
  const algos1 = [...new Set((a1.answer ?? '').toLowerCase().match(WTA_FOLLOWUP.algorithms) ?? [])];
  console.log(`  wta#1 ${a1.ms}ms algos=${algos1} q="${a1.resolvedQuestion}"`);
  // Real wall-clock gap, with the meeting still talking.
  const until = Date.now() + WTA_FOLLOWUP.gapSeconds * 1000;
  while (Date.now() < until) { await injectChatter(1); await sleep(10000); }
  await inject([{ speaker: WTA_FOLLOWUP.second[0], text: WTA_FOLLOWUP.second[1], timestamp: Date.now() }]);
  const a2 = await wtaTurn(undefined);
  const m2 = await memoryState();
  const algos2 = [...new Set((a2.answer ?? '').toLowerCase().match(WTA_FOLLOWUP.algorithms) ?? [])];
  const promptText = `${m2.prompt?.system ?? ''}\n${m2.prompt?.user ?? ''}`;
  const firstQInPrompt = promptText.includes('rate limiter for a public API');
  const secondPromptUser = m2.prompt?.user ?? null;
  const firstAnswerInPrompt = Boolean(a1.answer) && promptText.includes((a1.answer ?? '').replace(/\s+/g, ' ').trim().slice(20, 70));
  console.log(`  wta#2 ${a2.ms}ms algos=${algos2} firstQInPrompt=${firstQInPrompt} firstAnswerInPrompt=${firstAnswerInPrompt}`);
  await endMeeting();
  return {
    first: { answer: a1.answer, algos: algos1, resolvedQuestion: a1.resolvedQuestion, ring: m1.allKeys },
    second: { answer: a2.answer, algos: algos2, resolvedQuestion: a2.resolvedQuestion, ring: m2.allKeys, promptSurface: m2.prompt?.surface ?? null },
    secondPromptUser,
    firstQuestionInSecondPrompt: firstQInPrompt,
    firstAnswerInSecondPrompt: firstAnswerInPrompt,
    // "Which algorithm did you pick?" answered with a generic survey while
    // saying it does not know the earlier pick is a LOSS, even though the survey
    // names the right algorithm among the others.
    secondDenies: denialRe.test(a2.answer ?? ''),
    recalledChoice: !denialRe.test(a2.answer ?? '') && algos1.length > 0 && (a2.answer ?? '').toLowerCase().includes(algos1[0]),
  };
}

async function hourMeeting() {
  await startMeeting();
  await inject(buildHourTranscript(Date.now()));
  // Let the JIT indexer embed the hour before asking.
  const t0 = Date.now();
  let live = null;
  while (Date.now() - t0 < 120000) {
    live = (await probe()).liveMeetingId;
    if (live) break;
    await sleep(2000);
  }
  await sleep(45000);
  return live;
}

/** One surface per meeting: asking typed probes first put their answers into
 *  the what-to-answer probes' speech window and ring, so a what-to-answer
 *  "recall" could come from the typed answer rather than from retrieval. */
async function runHour() {
  const results = [];
  const live = {};
  for (const surface of ['typed', 'wta']) {
    live[surface] = await hourMeeting();
    for (const [key, f] of Object.entries(HOUR_FACTS)) {
      const r = surface === 'typed' ? await typedTurn(f.question) : await wtaTurn(f.question);
      const m = await memoryState();
      const rec = {
        fact: key, minute: f.minute, surface, answer: r.answer, error: r.error, ms: r.ms,
        result: score(r.answer, f.re), ...factLocation(m.prompt, f.re),
        promptSurface: m.prompt?.surface ?? null, promptUser: m.prompt?.user ?? null,
      };
      results.push(rec);
      console.log(`  ${surface.padEnd(5)} ${key}@${f.minute}m ${rec.result} inEvidence=${rec.factInEvidence} inHistory=${rec.factInHistory}`);
    }
    await endMeeting();
  }
  return { liveMeetingId: live, results };
}

/** A live interview, both channels, answered by what-to-answer with NO typed
 *  question — the interviewer's follow-up is resolved from the transcript. */
async function runInterview() {
  await startMeeting();
  await inject(buildInterviewTranscript(Date.now()));
  const t0 = Date.now();
  let live = null;
  while (Date.now() - t0 < 90000) {
    live = (await probe()).liveMeetingId;
    if (live) break;
    await sleep(2000);
  }
  await sleep(20000);
  const results = [];
  for (const p of INTERVIEW_PROBES) {
    const f = INTERVIEW_FACTS[p.fact];
    await inject([{ speaker: 'interviewer', text: p.text, timestamp: Date.now() }]);
    await sleep(1500);
    const r = await wtaTurn(undefined);
    const m = await memoryState();
    const rec = {
      fact: p.fact, probe: p.text, answer: r.answer, error: r.error, ms: r.ms, resolvedQuestion: r.resolvedQuestion,
      result: score(r.answer, f.re), ...factLocation(m.prompt, f.re),
      promptSurface: m.prompt?.surface ?? null, promptUser: m.prompt?.user ?? null,
    };
    results.push(rec);
    console.log(`  ${p.fact.padEnd(8)} ${rec.result} inPrompt=${rec.factInPrompt} inEvidence=${rec.factInEvidence} inHistory=${rec.factInHistory} surface=${rec.promptSurface}`);
    // The user answers out loud, as they would.
    await inject([{ speaker: 'user', text: (r.answer ?? '').replace(/\[\[GIST\]\].*$/s, '').slice(0, 400) || 'Sure.', timestamp: Date.now() }]);
  }
  await endMeeting();
  return { liveMeetingId: live, results };
}

/** A design round: the interviewer sets unguessable constraints 26 minutes
 *  back, then asks design questions that need them WITHOUT pointing back, plus
 *  concept controls that must stay clean. Answered by what-to-answer. */
async function runConstraints() {
  await startMeeting();
  await inject(buildConstraintTranscript(Date.now()));
  const t0 = Date.now();
  let live = null;
  while (Date.now() - t0 < 90000) {
    live = (await probe()).liveMeetingId;
    if (live) break;
    await sleep(2000);
  }
  await sleep(20000);
  const results = [];
  for (const p of CONSTRAINT_PROBES) {
    await inject([{ speaker: 'interviewer', text: p.text, timestamp: Date.now() }]);
    await sleep(1500);
    const r = await wtaTurn(undefined);
    const m = await memoryState();
    const f = p.control ? null : CONSTRAINT_FACTS[p.fact];
    const leaked = p.control && CONSTRAINT_LEAK_RE.test(r.answer ?? '');
    const rec = {
      fact: p.fact ?? 'control', control: Boolean(p.control), probe: p.text, answer: r.answer, error: r.error, ms: r.ms,
      resolvedQuestion: r.resolvedQuestion,
      result: p.control ? (!r.answer ? 'error' : denialRe.test(r.answer) ? 'denied' : leaked ? 'leaked' : 'clean') : score(r.answer, f.re),
      ...(f ? factLocation(m.prompt, f.re) : {}),
      promptSurface: m.prompt?.surface ?? null, promptUser: m.prompt?.user ?? null,
    };
    results.push(rec);
    console.log(`  ${rec.fact.padEnd(9)} ${rec.result} inPrompt=${rec.factInPrompt} inEvidence=${rec.factInEvidence} ms=${r.ms}`);
    await inject([{ speaker: 'user', text: (r.answer ?? '').replace(/\[\[GIST\]\].*$/s, '').slice(0, 400) || 'Sure.', timestamp: Date.now() }]);
  }
  await endMeeting();
  return { liveMeetingId: live, results };
}

/** One turn of the session scenario on its surface. */
async function sessionTurn(step, imagePath) {
  if (step.surface === 'typed') return typedTurn(step.text);
  if (step.surface === 'typed-image') return typedTurnWithImage(step.text, imagePath);
  await inject([{ speaker: 'interviewer', text: step.interviewer, timestamp: Date.now() }]);
  await sleep(1500);
  return wtaTurn(undefined);
}

/** A one-hour session: every kind of content planted early, the ring rolled past
 *  it by `filler` turns, then a follow-up about each (SESSION_PROBES). */
async function runSessionHour({ filler = 42 } = {}) {
  const img = await renderSessionScreenshot(path.join(os.tmpdir(), `mm-session-screen-${process.pid}.png`));
  await startMeeting();
  await inject(buildSessionHourTranscript(Date.now()));
  const t0 = Date.now();
  let live = null;
  while (Date.now() - t0 < 90000) {
    live = (await probe()).liveMeetingId;
    if (live) break;
    await sleep(2000);
  }
  await sleep(20000);
  const planted = {};
  for (const p of SESSION_PLANTS) {
    const r = await sessionTurn(p, img);
    planted[p.id] = { question: p.text ?? p.interviewer, answer: r.answer, ms: r.ms };
    console.log(`  plant ${p.id.padEnd(14)} ${r.ms} ms · ${(r.answer ?? r.error ?? '').replace(/\s+/g, ' ').slice(0, 110)}`);
  }
  for (let i = 0; i < filler; i++) {
    const q = SESSION_FILLER[i % SESSION_FILLER.length];
    const r = await sessionTurn(i % 2 ? { surface: 'typed', text: q } : { surface: 'wta', interviewer: q }, img);
    if (i % 10 === 9) console.log(`  filler ${i + 1}/${filler} (${r.ms} ms)`);
  }
  const before = await memoryState();
  const ringTurns = before.allKeys.find((k) => k.key === before.engineKey)?.turns ?? null;
  const results = [];
  for (const pr of SESSION_PROBES) {
    const r = await sessionTurn(pr, img);
    const m = await memoryState();
    const promptText = `${m.prompt?.system ?? ''}\n${m.prompt?.user ?? ''}`;
    let result, inPrompt, detail = null;
    if (pr.re) {
      result = score(r.answer, pr.re);
      if (result === 'recalled' && pr.also && !pr.also.test(r.answer)) result = 'partial';
      inPrompt = pr.re.test(promptText);
    } else {
      const src = planted[pr.from];
      const words = distinctiveWords(src?.answer, src?.question ?? '', pr.text ?? pr.interviewer ?? '');
      const hit = words.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(r.answer ?? ''));
      const inP = words.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(promptText));
      detail = { words: words.length, hit: hit.length, inPrompt: inP.length, sample: hit.slice(0, 8) };
      result = !r.answer ? 'error' : denialRe.test(r.answer) && hit.length < 3 ? 'denied' : hit.length >= 3 ? 'recalled' : 'wrong';
      inPrompt = words.length > 0 && inP.length / words.length >= 0.4;
    }
    results.push({ id: pr.id, surface: pr.surface, probe: pr.text ?? pr.interviewer, answer: r.answer, ms: r.ms, result, inPrompt, detail,
      promptSurface: m.prompt?.surface ?? null, promptUser: m.prompt?.user ?? null, conversationSummary: m.prompt?.conversationSummary ?? null });
    console.log(`  probe ${pr.id.padEnd(18)} ${pr.surface.padEnd(5)} ${result.padEnd(8)} inPrompt=${inPrompt} ${r.ms} ms${detail ? ` words ${detail.hit}/${detail.words}` : ''}`);
  }
  await endMeeting();
  return { liveMeetingId: live, filler, ringTurnsAtProbe: ringTurns, planted, results };
}

/** Meeting A is told a secret; meeting B (a different meeting) is asked for it.
 *  B must NOT know it — anything else is one meeting's conversation leaking
 *  into the next. Measured with no active mode, the default state. */
async function runCrossMeeting() {
  await startMeeting();
  await injectChatter(2);
  await typedTurn('Just between us for this call: the vendor shortlist codename is PINEAPPLE-SEVEN. Acknowledge briefly.');
  await endMeeting();
  await startMeeting();
  await injectChatter(2);
  const r = await typedTurn('What was the vendor shortlist codename I told you?');
  const m = await memoryState();
  const promptText = `${m.prompt?.system ?? ''}\n${m.prompt?.user ?? ''}`;
  const rec = {
    leakInPrompt: /PINEAPPLE/i.test(promptText),
    leakInHistory: /PINEAPPLE/i.test(m.prompt?.conversationSummary ?? ''),
    answerLeaks: /PINEAPPLE/i.test(r.answer ?? ''),
    answer: r.answer, engineKey: m.engineKey, ring: m.allKeys,
  };
  console.log(`  cross-meeting leakInPrompt=${rec.leakInPrompt} answerLeaks=${rec.answerLeaks} key=${rec.engineKey}`);
  await endMeeting();
  return rec;
}

/** Activate (creating if needed) a mode of the given template; null deactivates. */
async function activateMode(templateType) {
  if (templateType === null) {
    await evalIn('launcher', () => window.electronAPI.modesSetActive(null)).catch(() => {});
    return;
  }
  if (!templateType) return;
  // Never call __e2e__:enable-pro here: it WRITES a fake trial token through
  // CredentialsManager, and before dev:agent passed --user-data-dir that write
  // landed in the developer's real credentials.enc (2026-09-24). The isolated
  // profile carries a copied license; a pro_required failure below is loud.
  const all = await evalIn('launcher', () => window.electronAPI.modesGetAll());
  const list = Array.isArray(all) ? all : (all?.modes ?? []);
  let mode = list.find((m) => (m.templateType ?? m.template_type) === templateType);
  if (!mode) {
    const r = await evalIn('launcher', (t) => window.electronAPI.modesCreate({ name: `Harness ${t}`, templateType: t }), templateType);
    if (!r?.success) throw new Error(`modesCreate failed: ${JSON.stringify(r)}`);
    mode = r.mode;
  }
  const r = await evalIn('launcher', (id) => window.electronAPI.modesSetActive(id), mode.id);
  if (!r?.success) throw new Error(`modesSetActive failed: ${JSON.stringify(r)}`);
  console.log(`mode active: ${mode.name} (${templateType})`);
}

// ── main ────────────────────────────────────────────────────────────────────

const identity = await probe();
if (!identity?.success) throw new Error('memory-probe hook missing — is this the harness build with NATIVELY_E2E=1?');

const plan = scenario === 'all' ? ['typed', 'typed-quiet', 'typed-wta', 'typed-long', 'wta-followup', 'hour', 'interview', 'cross-meeting'] : [scenario];
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const out = { label, mode: modeTemplate ?? 'general (no active mode)', startedAt: new Date().toISOString(), runs: [] };
const outFile = path.join(RESULTS_DIR, `${label}-${scenario}${modeTemplate ? `-${modeTemplate}` : ''}-${Date.now()}.json`);
await activateMode(modeTemplate);
for (const sc of plan) {
  for (let rep = 1; rep <= reps; rep++) {
    console.log(`\n=== ${sc} rep ${rep}/${reps}`);
    let data;
    try {
      if (sc === 'typed') data = await runTyped({ chatter: true });
      else if (sc === 'typed-quiet') data = await runTyped({ chatter: false });
      else if (sc === 'typed-wta') data = await runTyped({ chatter: true, wtaInterleave: true });
      else if (sc === 'typed-long') data = await runTyped({ chatter: true, script: TYPED_LONG_SCRIPT });
      else if (sc === 'wta-followup') data = await runWtaFollowup();
      else if (sc === 'hour') data = await runHour();
      else if (sc === 'interview') data = await runInterview();
      else if (sc === 'constraints') data = await runConstraints();
      else if (sc === 'session-hour') data = await runSessionHour({ filler: fillerTurns });
      else if (sc === 'session-hour-short') data = await runSessionHour({ filler: 6 });
      else if (sc === 'cross-meeting') data = await runCrossMeeting();
      else throw new Error(`unknown scenario ${sc}`);
    } catch (e) {
      data = { error: String(e?.stack || e) };
      console.error(`  FAILED: ${e?.message || e}`);
      if (appGone || String(e?.message).startsWith('APP_GONE')) {
        out.runs.push({ scenario: sc, rep, ...data, appGone: true });
        fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
        console.error('  the app is gone — stopping; relaunch with npm run dev:agent and rerun');
        process.exit(2);
      }
      await endMeeting();
    }
    out.runs.push({ scenario: sc, rep, ...data });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  }
}
if (modeTemplate) await activateMode(null);
console.log(`\nresults: ${path.relative(ROOT, outFile)}`);
// No browser.close(): on a CDP-attached browser it can take the app down with it.
process.exit(0);
