#!/usr/bin/env node
// Context-limit probes (2026-10-04). Drives the real app over CDP with the same E2E hooks the benchmark uses and
// reads back, for every turn, what actually went to the provider (the dev-only prompt recorder). Nothing in the app
// is changed. Every fact is a unique sentence planted at a known position; a check is "is this sentence in the
// request?" — judge-free. Synthetic files live in evidence-rich/evidence/limits-probe/, outside the frozen corpus.
//
//   node evidence-rich/limits/probe.mjs start-app --root <app worktree>        (one dev:agent, fresh profile)
//   node evidence-rich/limits/probe.mjs ref-size   --mode general --sizes 500,1000,… [--surface typed|hotkey] [--format txt]
//   node evidence-rich/limits/probe.mjs ref-count  --mode sales --counts 1,2,5,10,20 --file-tokens 600
//   node evidence-rich/limits/probe.mjs typed      --sizes 1000,5000,…           (chars of the typed message)
//   node evidence-rich/limits/probe.mjs transcript --lines 20,60,…               (heard path, injected transcript)
//   node evidence-rich/limits/probe.mjs history    --turns 5,10,20,40            (typed path, a conversation)
//   node evidence-rich/limits/probe.mjs resume     --sizes 1500,3000,6000,12000  (profile résumé of that many tokens)
// Global: --route agentrouter|deepseek (default agentrouter; falls back to deepseek with the reason recorded)
// Output: evidence-rich/results/limits/<experiment>.jsonl, one line per question.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectApp } from '../../lib/cdp.mjs';
import * as app from '../../lib/app.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ER = path.join(HERE, '..');
const OUT = process.env.PROBE_OUT ? path.resolve(process.env.PROBE_OUT) : path.join(ER, 'results', 'limits'); fs.mkdirSync(OUT, { recursive: true });
const PROBE_DIR = path.join(ER, 'evidence', 'limits-probe'); fs.mkdirSync(PROBE_DIR, { recursive: true });
const [cmd, ...args] = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const nums = (k, d) => String(opt(k, d)).split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const envText = fs.readFileSync(process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const envKey = (n) => (envText.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');

// ── deterministic text ────────────────────────────────────────────────────────
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const WORDS = 'the team reviewed rota staffing calendar vendor budget quarter backlog tooling migration dashboard alerting cadence onboarding handover review cycle forecast capacity rollout policy audit release report meeting notes agenda workstream priorities estimate risk dependency survey feedback archive template checklist process baseline target summary update draft schedule'.split(' ');
/** Varied filler prose (no two sentences equal, so no chunk is a duplicate), ~4.6 chars per word. */
function filler(chars, seed) {
  const r = rng(seed); let out = ''; let n = 0;
  while (out.length < chars) { const len = 9 + Math.floor(r() * 9); const w = Array.from({ length: len }, () => WORDS[Math.floor(r() * WORDS.length)]); w[0] = w[0][0].toUpperCase() + w[0].slice(1); out += `${w.join(' ')} (item ${seed}-${++n}). `; if (n % 6 === 0) out += '\n\n'; }
  return out.slice(0, chars);
}
/** Seven facts, each about its own invented subject, asked by paraphrase. */
export const POSITIONS = [0, 0.10, 0.25, 0.50, 0.75, 0.90, 0.995];
const SUBJECTS = ['Harrowgate', 'Quenby', 'Talliston', 'Morrowfield', 'Brackwater', 'Elsington', 'Fennimarch'];
const factOf = (i, tag) => ({ marker: `${SUBJECTS[i]}-${tag}-${1000 + i * 97}`, sentence: `The ${SUBJECTS[i]} depot's gate release code is ${SUBJECTS[i].toUpperCase()}-${tag}-${1000 + i * 97}.`, question: `What code opens the gate at the ${SUBJECTS[i]} depot?` });
/** A document of ~tokens (chars/4, the app's own estimate) with the seven facts at POSITIONS. */
function docWithFacts(tokens, tag, seed) {
  const chars = tokens * 4; const facts = POSITIONS.map((_, i) => factOf(i, tag));
  const body = filler(chars, seed); let out = ''; let at = 0;
  POSITIONS.forEach((p, i) => { const cut = Math.min(body.length, Math.floor(p * body.length)); out += body.slice(at, cut) + (out ? '\n\n' : '') + facts[i].sentence + '\n\n'; at = cut; });
  out += body.slice(at);
  return { text: `Operations reference ${tag}\n\n${out}`, facts };
}

// ── app plumbing ──────────────────────────────────────────────────────────────
async function appUp(root) { try { const port = JSON.parse(fs.readFileSync(path.join(root, 'agent-browser.json'), 'utf8')).cdp; const l = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); return l.some((t) => String(t.url).includes('window=launcher')) && l.some((t) => /[?&]window=overlay$/.test(String(t.url))); } catch { return false; } }
async function startApp(root) {
  if (await appUp(root)) { console.log('app already up'); return; }
  fs.rmSync(path.join(root, '.agent', 'userdata'), { recursive: true, force: true });
  const log = path.join(OUT, `app-${Date.now()}.log`); const out = fs.openSync(log, 'a');
  fs.writeFileSync(path.join(OUT, '.app-log-path'), log);
  const child = spawn('npm', ['run', 'dev:agent'], { cwd: root, detached: true, stdio: ['ignore', out, out], env: { ...process.env, NATIVELY_E2E: '1', NATIVELY_PROMPT_DEBUG: '1', MEASURE_LATENCY: 'true', NATIVELY_E2E_REFERENCE_ROOT: path.join(ER, 'evidence') } });
  child.unref();
  for (let i = 0; i < 150; i++) { await sleep(2000); if (await appUp(root)) { await sleep(8000); console.log('app up; log', log); return; } }
  throw new Error('app did not come up');
}
let ROUTE = null;
async function connect() {
  const c = await connectApp();
  if (!(await app.recorderEnabled(c))) throw new Error('prompt recorder is off');
  const want = opt('route', 'agentrouter');
  if (want === 'agentrouter') {
    try { const p = await app.setupProfile(c, { agentrouterKey: envKey('AGENTROUTER_API_KEY') }); ROUTE = { route: 'agentrouter', config: p.config }; }
    catch (e) { ROUTE = { route: 'deepseek-direct', fallback_reason: `agentrouter setup failed: ${String(e.message).slice(0, 160)}` }; await app.setupProfile(c, { deepseekKey: envKey('DEEPSEEK_API_KEY') }); }
  } else { await app.setupProfile(c, { deepseekKey: envKey('DEEPSEEK_API_KEY') }); ROUTE = { route: 'deepseek-direct' }; }
  console.log('route', JSON.stringify(ROUTE).slice(0, 300));
  return c;
}
/** The built-in mode of that template, made ACTIVE (a turn answers in the active mode). */
const modeIdOf = async (c, k) => { const id = await app.builtinModeId(c, k); await app.activateMode(c, id); await sleep(400); return id; };
async function clearMode(c, modeId) { const files = (await c.launcher.evaluate(`window.electronAPI.modesGetReferenceFiles(${JSON.stringify(modeId)})`)) ?? []; for (const f of files) await c.launcher.evaluate(`window.electronAPI.modesDeleteReferenceFile(${JSON.stringify(f.id)})`); return files.length; }
async function upload(c, modeId, name, text) {
  const p = path.join(PROBE_DIR, name); fs.writeFileSync(p, text);
  const r = await c.invoke('__e2e__:upload-reference-file-from-path', { modeId, filePath: p });
  if (!r?.success) return { ok: false, error: r?.error ?? 'unknown' };
  await c.invoke('__e2e__:prewarm-mode', modeId).catch(() => null);
  let st = null;
  for (let i = 0; i < 240; i++) { const all = (await c.invoke('__e2e__:index-status', modeId))?.statuses ?? []; st = all.find((s) => s.fileId === r.file.id); if (st && ['ready', 'failed', 'ocr_required'].includes(st.status)) break; if (i === 40 && st?.status === 'lexical_only') await c.invoke('__e2e__:reindex-embeddings', modeId).catch(() => null); await sleep(500); }
  return { ok: true, id: r.file.id, content: String(r.file.content ?? ''), status: st?.status ?? null, chunks: st?.chunkCount ?? null, statusRaw: st };
}
function logOffset() { const f = fs.readFileSync(path.join(OUT, '.app-log-path'), 'utf8').trim(); return { f, at: fs.existsSync(f) ? fs.statSync(f).size : 0 }; }
function traceSince(o) { try { const t = fs.readFileSync(o.f, 'utf8').slice(o.at); const m = [...t.matchAll(/\[V3\] (\{.*\})/g)].map((x) => { try { return JSON.parse(x[1]); } catch { return null; } }).filter(Boolean); return m.at(-1) ?? null; } catch { return null; } }
/** One turn: ask, then return what was sent and what came back. */
async function turn(c, surface, question) {
  await app.clearRecorder(c); const o = logOffset();
  const a = await app.timedAsk(c, { surface, question, timeoutMs: 120000 });
  const w = await app.collectWire(c); await sleep(300); const tr = traceSince(o);
  const m = w.main; const user = m ? (m.messages || []).map((x) => x.text || '').join('\n') : ''; const sys = m?.system || '';
  const s = m ? app.summariseWire(w, a.t0Epoch) : null;
  const verifier = w.records.filter((r) => r.messages?.length && r !== m).map((r) => (r.messages || []).map((x) => x.text || '').join('\n')).find((t) => /DRAFT REPLY:/.test(t)) ?? null;
  // Provider-reported input tokens: OpenAI style (usage.prompt_tokens) or Anthropic style (message_start usage.input_tokens,
  // the AgentRouter /v1/messages route), read from the recorded response body.
  const rawResp = String(m?.response ?? ''); const inToks = [...rawResp.matchAll(/[{,]"input_tokens":\s*(\d+)/g)].map((x) => Number(x[1])); const inTok = inToks.length ? Math.max(...inToks) : null;
  const cacheRead = Math.max(0, ...[...rawResp.matchAll(/"cache_read_input_tokens":\s*(\d+)/g)].map((x) => Number(x[1])));
  return { a, user, sys, verifier, usage: s?.response?.usage?.prompt_tokens != null ? s.response.usage : (inTok != null ? { prompt_tokens: inTok + cacheRead, anthropic_input_tokens: inTok, cache_read_input_tokens: cacheRead } : null), stopReason: [...rawResp.matchAll(/"(?:stop_reason|finish_reason)":\s*"([a-z_]+)"/g)].map((x) => x[1]).at(-1) ?? null, outputTokens: Math.max(0, ...[...rawResp.matchAll(/"(?:output_tokens|completion_tokens)":\s*(\d+)/g)].map((x) => Number(x[1]))), model: m?.model ?? null, provider: m?.provider ?? null, maxTokens: m?.params?.max_tokens ?? null, trace: tr, evidenceTags: [...user.matchAll(/<evidence\s[^>]*>/g)].map((x) => x[0].slice(0, 260)) };
}
const has = (hay, needle) => String(hay ?? '').includes(needle);
const write = (name, rec) => fs.appendFileSync(path.join(OUT, `${name}.jsonl`), JSON.stringify({ at: new Date().toISOString(), route: ROUTE, ...rec }) + '\n');
const summarise = (t) => ({ prompt_user_chars: t.user.length, prompt_system_chars: t.sys.length, provider_prompt_tokens: t.usage?.prompt_tokens ?? null, max_tokens: t.maxTokens, model: t.model, provider: t.provider, verifier_chars: t.verifier?.length ?? null, provider_stop_reason: t.stopReason, provider_output_tokens: t.outputTokens, raw_chars: String(t.a.raw ?? '').length, final_chars: String(t.a.final ?? '').length, trace: t.trace ? { path: t.trace.path, planned: t.trace.planned, evidence: t.trace.evidence, retrieval: t.trace.retrieval, readWhole: t.trace.readWhole ?? null } : null, evidence_tags: t.evidenceTags.length, answer: String(t.a.final ?? t.a.raw ?? '').slice(0, 300) });

// ── experiments ───────────────────────────────────────────────────────────────
async function refSize() {
  const c = await connect(); const mode = opt('mode', 'general'); const surface = opt('surface', 'typed'); const modeId = await modeIdOf(c, mode);
  for (const tokens of nums('sizes', '500,1000,1350,1450,2000,4000,8000,11800,12500,16000,32000,64000')) {
    await clearMode(c, modeId); await app.resetSession(c);
    const tag = `S${tokens}`; const doc = docWithFacts(tokens, tag, tokens);
    const up = await upload(c, modeId, `ref-${mode}-${tokens}.txt`, doc.text);
    const parsed = doc.facts.map((f) => has(up.content, f.sentence));
    for (let i = 0; i < doc.facts.length; i++) {
      const f = doc.facts[i]; const t = await turn(c, surface, f.question);
      write(`ref-size-${mode}-${surface}`, { experiment: 'ref-size', mode, surface, file_tokens_est: tokens, file_chars: doc.text.length, position: POSITIONS[i], marker: f.marker,
        A_parsed: parsed[i], extracted_chars: up.content.length, B_index_status: up.status, chunks: up.chunks, E_in_request: has(t.user, f.sentence), in_answer: has(t.a.final ?? t.a.raw, f.marker.split('-').slice(1).join('-')) || has(t.a.final ?? t.a.raw, f.marker),
        V_in_verifier: t.verifier ? has(t.verifier, f.sentence) : null, ...summarise(t) });
      process.stdout.write(`${tokens}@${POSITIONS[i]}:${has(t.user, f.sentence) ? 'Y' : 'n'} `);
    }
    console.log(`| ${tokens} tokens: parsed ${parsed.filter(Boolean).length}/7, ${up.status}, chunks ${up.chunks}`);
  }
}
const STEMS = ['Ash', 'Bel', 'Cor', 'Dun', 'Elm', 'Fal', 'Gor', 'Hal', 'Ivo', 'Jar', 'Kel', 'Lor', 'Mar', 'Nor', 'Ost', 'Pen', 'Quil', 'Ros', 'Sel', 'Tor', 'Ulm', 'Ven'];
/** File k of n: filler with ONE fact about a subject only this file names, at the middle. */
function ownDoc(tokens, n, k) {
  const subj = `${STEMS[k]}brook`; const code = `${subj.toUpperCase()}-N${n}-${3000 + k * 17}`;
  const fact = { sentence: `The ${subj} depot's gate release code is ${code}.`, marker: code, question: `What code opens the gate at the ${subj} depot?` };
  const body = filler(tokens * 4, n * 100 + k); const cut = Math.floor(body.length / 2);
  return { text: `Operations reference ${subj}\n\n${body.slice(0, cut)}\n\n${fact.sentence}\n\n${body.slice(cut)}`, fact };
}
async function refCount() {
  const c = await connect(); const mode = opt('mode', 'sales'); const surface = opt('surface', 'typed'); const modeId = await modeIdOf(c, mode); const per = Number(opt('file-tokens', 600));
  for (const n of nums('counts', '1,2,5,10,20')) {
    await clearMode(c, modeId); await app.resetSession(c);
    const ups = []; const docs = [];
    for (let k = 0; k < n; k++) { const d = ownDoc(per, n, k); docs.push(d); ups.push(await upload(c, modeId, `count-${mode}-${per}-${n}-${k}.txt`, d.text)); }
    const which = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    for (const k of which) {
      const f = docs[k].fact; const t = await turn(c, surface, f.question);
      const ans = String(t.a.final ?? t.a.raw ?? '');
      write(`ref-count-${mode}-${surface}`, { experiment: 'ref-count', mode, surface, files: n, file_tokens_est: per, corpus_tokens_est: n * per, which_file: k, A_parsed: has(ups[k].content, f.sentence), B_index_status: ups[k].status, chunks: ups[k].chunks, E_in_request: has(t.user, f.sentence), in_answer: has(ans, f.marker), files_in_request: docs.filter((d) => has(t.user, d.fact.sentence)).length, ...summarise(t) });
      process.stdout.write(`${n}:${k}:${has(t.user, f.sentence) ? 'Y' : 'n'}(${docs.filter((d) => has(t.user, d.fact.sentence)).length} files) `);
    }
    console.log(`| ${n} files of ${per}`);
  }
}
async function typed() {
  const c = await connect(); const modeId = await modeIdOf(c, opt('mode', 'general')); await clearMode(c, modeId);
  for (const chars of nums('sizes', '1000,5000,10000,25000,50000,100000')) {
    await app.resetSession(c);
    const tail = `Last line of my note: the courier reference I need repeated back is PELLWORTH-${chars}.`;
    const head = `Here is a long note I pasted from my files. `;
    const raw = filler(Math.max(0, chars - head.length - tail.length - 2), chars);
    const mids = [0.25, 0.5, 0.75].map((p) => ({ p, m: `MIDMARK${Math.round(p * 100)}Q${chars}` }));
    let body = raw; for (const x of [...mids].reverse()) { const at = Math.floor(x.p * raw.length); body = body.slice(0, at) + ` ${x.m} ` + body.slice(at); }
    const msg = `${head}${body}\n${tail}`;
    const sq = (t) => String(t).replace(/\s+/g, ' ');
    const t = await turn(c, 'typed', msg);
    write('typed-input', { experiment: 'typed-input', sent_chars: msg.length, sent_newlines: (msg.match(/\n/g) ?? []).length, whole_message_verbatim: has(t.user, msg), whole_message_whitespace_collapsed: sq(t.user).includes(sq(msg).trim()), mids_in_request: mids.filter((x) => has(t.user, x.m)).length, head_in_request: has(t.user, head.trim()), tail_in_request: has(t.user, `PELLWORTH-${chars}`), tail_in_answer: has(t.a.final ?? t.a.raw, `PELLWORTH-${chars}`), user_chars_in_request: t.user.length, err: t.a.err ?? null, ...summarise(t) });
    console.log(`${chars} chars: verbatim ${has(t.user, msg)}, ws-collapsed ${sq(t.user).includes(sq(msg).trim())}, mids ${mids.filter((x) => has(t.user, x.m)).length}/3, tail in request ${has(t.user, `PELLWORTH-${chars}`)}, request user chars ${t.user.length}, err ${t.a.err ?? '-'}`);
  }
}
async function transcript() {
  const c = await connect(); const modeId = await modeIdOf(c, opt('mode', 'team-meet')); await clearMode(c, modeId);
  for (const nLines of nums('lines', '20,60,120,240')) {
    await app.resetSession(c);
    const facts = [{ at: 1, s: `For the record, the project codename is ATLASVINE-${nLines}.` }, { at: Math.floor(nLines / 2), s: `Quick note, the launch target moved to the ninth of November, reference LAUNCH-${nLines}.` }, { at: nLines - 3, s: `And Maya Ortholan owns the rollout, ticket OWNER-${nLines}.` }];
    const lines = []; for (let i = 0; i < nLines; i++) { const f = facts.find((x) => x.at === i); lines.push({ speaker: i % 2 ? 'other' : 'user', text: f ? f.s : filler(160, nLines * 1000 + i).replace(/\n/g, ' ') }); }
    await app.injectLines(c, lines);
    const t = await turn(c, 'hotkey', 'Sorry, remind me what the project codename is, when we are launching, and who owns it?');
    const r = { experiment: 'transcript', mode: opt('mode', 'team-meet'), lines: nLines, transcript_chars: lines.reduce((n, l) => n + l.text.length, 0), ...summarise(t) };
    for (const f of facts) r[`line_${f.at}_in_request`] = has(t.user, f.s.split(',').at(-1).trim().slice(0, 40));
    write('transcript', r); console.log(nLines, 'lines:', facts.map((f) => `${f.at}:${r[`line_${f.at}_in_request`] ? 'Y' : 'n'}`).join(' '), 'user chars', t.user.length);
  }
}
async function history() {
  const c = await connect(); const modeId = await modeIdOf(c, opt('mode', 'general')); await clearMode(c, modeId);
  for (const turns of nums('turns', '5,10,20,40')) {
    await app.resetSession(c);
    const facts = { 1: `Note this: the venue for the offsite is Cardowan Hall, code VENUE-${turns}.`, [Math.floor(turns / 2)]: `Also, the budget cap is nineteen thousand, code BUDGET-${turns}.`, [turns - 1]: `Last thing, the caterer is Pell & Rook, code CATER-${turns}.` };
    for (let k = 1; k <= turns; k++) { await turn(c, 'typed', facts[k] ?? `Thinking out loud about item ${k}: ${filler(220, turns * 100 + k).replace(/\n/g, ' ')} Just acknowledge briefly.`); }
    const t = await turn(c, 'typed', 'Remind me: what is the venue, the budget cap and the caterer we settled on?');
    const r = { experiment: 'history', turns, ...summarise(t) }; for (const [k, s] of Object.entries(facts)) r[`turn_${k}_in_request`] = has(t.user, s.match(/code [A-Z]+-\d+/)[0]);
    write('history', r); console.log(turns, 'turns:', Object.keys(facts).map((k) => `${k}:${r[`turn_${k}_in_request`] ? 'Y' : 'n'}`).join(' '), 'user chars', t.user.length);
  }
}
async function resume() {
  const c = await connect(); const modeId = await modeIdOf(c, 'looking-for-work'); await clearMode(c, modeId);
  for (const tokens of nums('sizes', '1500,3000,6000,12000')) {
    await c.invoke('__e2e__:clear-profile'); await app.resetSession(c);
    const tag = `R${tokens}`; const doc = docWithFacts(tokens, tag, tokens + 7);
    const cv = `Jordan Ashcombe\nPlatform engineer, Lisbon\n\nSummary\nBackend engineer.\n\nExperience\n${doc.text}\n\nSkills\nGo, PostgreSQL, Kafka.\n\nEducation\nBSc Computer Science, 2012.`;
    const p = path.join(PROBE_DIR, `resume-${tokens}.txt`); fs.writeFileSync(p, cv);
    const ing = await c.invoke('__e2e__:ingest-profile-doc', { filePath: p, docType: 'resume' });
    const state = await c.invoke('__e2e__:profile-state').catch(() => null); const stateText = JSON.stringify(state ?? {});
    for (let i = 0; i < doc.facts.length; i++) {
      const f = doc.facts[i]; const t = await turn(c, 'typed', f.question.replace('What code opens', 'In my last role, what code opened'));
      write('resume', { experiment: 'resume', resume_tokens_est: tokens, position: POSITIONS[i], ingest_ok: !!ing?.success, extraction_mode: state?.resumeExtractionMode ?? state?.extractionMode ?? null, A_in_stored_profile: has(stateText, f.sentence.slice(0, 50)), E_in_request: has(t.user, f.sentence), whole_profile_item: /Document \(whole\)/.test(t.user), ...summarise(t) });
      process.stdout.write(`${tokens}@${POSITIONS[i]}:${has(t.user, f.sentence) ? 'Y' : 'n'} `);
    }
    console.log(`| résumé ${tokens}`);
  }
}

async function aggregate() {
  // One question that needs ALL seven facts: what a whole-file read gives vs what retrieval gives, either side of 12,000.
  const c = await connect(); const mode = opt('mode', 'general'); const modeId = await modeIdOf(c, mode);
  for (const tokens of nums('sizes', '4000,11800,12500,32000')) {
    await clearMode(c, modeId); await app.resetSession(c);
    const tag = `A${tokens}`; const doc = docWithFacts(tokens, tag, tokens + 3); const up = await upload(c, modeId, `agg-${mode}-${tokens}.txt`, doc.text);
    const t = await turn(c, opt('surface', 'typed'), 'List the gate release code for every depot mentioned in the operations reference.');
    const ans = String(t.a.final ?? t.a.raw ?? ''); const inReq = doc.facts.filter((f) => has(t.user, f.sentence)).length; const inAns = doc.facts.filter((f) => has(ans, f.marker.split('-').slice(1).join('-'))).length;
    write(`aggregate-${mode}`, { experiment: 'aggregate', mode, file_tokens_est: tokens, chunks: up.chunks, facts_in_request: inReq, facts_in_answer: inAns, ...summarise(t) });
    console.log(`${tokens} tokens: facts in request ${inReq}/7, in answer ${inAns}/7, items ${t.trace?.evidence}`);
  }
}
async function outputCap() {
  // A request whose honest answer is far longer than 16,000 characters: where does the shown answer stop, and is it marked?
  const c = await connect(); const modeId = await modeIdOf(c, 'general'); await clearMode(c, modeId); await app.resetSession(c);
  const n = Number(opt('items', 600));
  const list = Array.from({ length: n }, (_, i) => `R${String(i + 1).padStart(4, '0')} ${['amber', 'cobalt', 'violet', 'olive', 'coral'][i % 5]} crate`).join('; ');
  const t = await turn(c, 'typed', `I am checking a copy job. Write out every entry of this inventory list, one entry per line, numbered, exactly as given, nothing skipped and no commentary: ${list}`);
  const ans = String(t.a.final ?? t.a.raw ?? ''); const lastSeen = (ans.match(/R(\d{4})/g) ?? []).at(-1) ?? null;
  write('output-cap', { items_asked: n, last_entry_shown: lastSeen, experiment: 'output-cap', answer_chars: ans.length, last_line: ans.trim().split('\n').at(-1)?.slice(0, 80), incomplete: t.a.incomplete ?? null, err: t.a.err ?? null, ...summarise(t), answer: ans.slice(-200) });
  console.log(`answer chars ${ans.length}; last line ${JSON.stringify(ans.trim().split('\n').at(-1)?.slice(0, 60))}; incomplete flag ${t.a.incomplete ?? '-'}`);
}

/** Résumé + JD together, either side of the 6,000 combined whole-profile switch; JD facts at top/middle/bottom. */
async function piCombined() {
  const c = await connect(); const modeId = await modeIdOf(c, opt('mode', 'looking-for-work')); await clearMode(c, modeId);
  for (const [rt, jt] of String(opt('pairs', '2500:2500,3500:3500,1000:8000')).split(',').map((x) => x.split(':').map(Number))) {
    await c.invoke('__e2e__:clear-profile'); await app.resetSession(c);
    const rd = docWithFacts(rt, `PR${rt}`, rt + 11); const jd = docWithFacts(jt, `PJ${jt}`, jt + 13);
    const cv = `Jordan Ashcombe\nPlatform engineer\n\nExperience\n${rd.text}\n\nSkills\nGo, PostgreSQL.`;
    const jdText = `Senior Platform Engineer — Job Description\n\nAbout the role\n${jd.text.replace(/depot's gate release code/g, "site's badge-office reference")}\n\nRequirements\nGo, Kafka.`;
    const pr = path.join(PROBE_DIR, `pi-resume-${rt}.txt`), pj = path.join(PROBE_DIR, `pi-jd-${jt}.txt`); fs.writeFileSync(pr, cv); fs.writeFileSync(pj, jdText);
    const i1 = await c.invoke('__e2e__:ingest-profile-doc', { filePath: pr, docType: 'resume' }); const i2 = await c.invoke('__e2e__:ingest-profile-doc', { filePath: pj, docType: 'jd' });
    for (const i of [0, 3, 6]) {
      const fr = rd.facts[i]; const t1 = await turn(c, 'typed', fr.question.replace('What code opens', 'In my last role, what code opened'));
      const fj = jd.facts[i]; const jsent = fj.sentence.replace("depot's gate release code", "site's badge-office reference"); const t2 = await turn(c, 'typed', `For this job, what is the badge-office reference for the ${SUBJECTS[i]} site?`);
      for (const [t, kind, sent] of [[t1, 'resume', fr.sentence], [t2, 'jd', jsent]]) write('pi-combined', { experiment: 'pi-combined', resume_tokens_est: rt, jd_tokens_est: jt, sum: rt + jt, ingest_ok: !!(i1?.success && i2?.success), kind, position: POSITIONS[i], E_in_request: has(t.user, sent), whole_items: (t.user.match(/Document \(whole\)/g) ?? []).length, ...summarise(t) });
      process.stdout.write(`${rt}+${jt}@${POSITIONS[i]}: cv ${has(t1.user, fr.sentence) ? 'Y' : 'n'} jd ${has(t2.user, jsent) ? 'Y' : 'n'}  `);
    }
    console.log(`| résumé ${rt} + JD ${jt}`);
  }
}
/** Everything at once (looking-for-work, heard): which source is in the request when all are large? */
async function pressure() {
  const c = await connect(); const modeId = await modeIdOf(c, 'looking-for-work'); await clearMode(c, modeId);
  await c.invoke('__e2e__:clear-profile'); await app.resetSession(c);
  const rd = docWithFacts(5500, 'XR', 91); const cv = `Jordan Ashcombe\nPlatform engineer\n\nExperience\n${rd.text}\n\nSkills\nGo.`; const pr = path.join(PROBE_DIR, 'pressure-resume.txt'); fs.writeFileSync(pr, cv);
  await c.invoke('__e2e__:ingest-profile-doc', { filePath: pr, docType: 'resume' });
  const ref = docWithFacts(11800, 'XF', 92); const up = await upload(c, modeId, 'pressure-ref.txt', ref.text.replace(/depot's gate release code/g, "warehouse's dock number"));
  const lines = []; for (let i = 0; i < 80; i++) lines.push({ speaker: i % 2 ? 'other' : 'user', text: i === 2 ? 'Early on: our hiring manager is Priya Lindqvist, reference HM-PRESSURE.' : i === 76 ? 'Just now: the panel interview moved to Thursday, reference PANEL-PRESSURE.' : filler(160, 9000 + i).replace(/\n/g, ' ') });
  await app.injectLines(c, lines);
  const asks = [['resume end', rd.facts[6].question.replace('What code opens', 'In my last role, what code opened'), rd.facts[6].sentence], ['resume start', rd.facts[0].question.replace('What code opens', 'In my last role, what code opened'), rd.facts[0].sentence],
    ['reference end', `What is the dock number at the ${SUBJECTS[6]} warehouse?`, ref.facts[6].sentence.replace("depot's gate release code", "warehouse's dock number")],
    ['transcript recent', 'When did they say the panel interview is?', 'reference PANEL-PRESSURE'], ['transcript old', 'Who did they say the hiring manager is?', 'reference HM-PRESSURE']];
  for (const [kind, q, sent] of asks) {
    const t = await turn(c, 'hotkey', q);
    const r = { experiment: 'pressure', kind, E_in_request: has(t.user, sent), resume_whole: /Document \(whole\)/.test(t.user), reference_whole_file: has(t.user, ref.facts[0].sentence.replace("depot's gate release code", "warehouse's dock number")) && has(t.user, ref.facts[6].sentence.replace("depot's gate release code", "warehouse's dock number")), ref_status: up.status, ...summarise(t) };
    write('pressure', r); console.log(kind.padEnd(18), 'in request', r.E_in_request, '| résumé whole', r.resume_whole, '| reference whole', r.reference_whole_file, '| user chars', t.user.length, '| provider tokens', r.provider_prompt_tokens);
  }
}

const root = opt('root', '/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/er-main');
if (cmd === 'start-app') await startApp(root);
else if (cmd === 'ref-size') await refSize(); else if (cmd === 'ref-count') await refCount(); else if (cmd === 'typed') await typed();
else if (cmd === 'aggregate') await aggregate(); else if (cmd === 'output-cap') await outputCap();
else if (cmd === 'pi-combined') await piCombined(); else if (cmd === 'pressure') await pressure();
else if (cmd === 'transcript') await transcript(); else if (cmd === 'history') await history(); else if (cmd === 'resume') await resume();
else { console.error('start-app | ref-size | ref-count | typed | transcript | history | resume'); process.exit(2); }
process.exit(0);
