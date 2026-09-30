// Drives the REAL Natively answer paths inside an isolated dev:agent instance.
//
//   hotkey  = the other party's line reaches the transcript, then generateWhatToSay() with NO
//             question — exactly what Cmd+Enter does (handleWhatToSay in NativelyInterface.tsx).
//   typed   = window.electronAPI.streamGeminiChat(...) called FROM THE OVERLAY renderer, so the
//             main-process handler sees the overlay's own webContents as sender (the surface the
//             typed box really uses). Conversation context is passed in the overlay's own format.
//
// Timing boundary (documented in the run header too):
//   t0 = performance.now() in the calling renderer immediately before the IPC invoke.
//   ttft_ms          = t0 -> first model-generated content chunk delivered to that renderer.
//                      Includes IPC hop + context assembly/retrieval + prompt build + provider TTFT.
//   total_latency_ms = t0 -> final answer received by the renderer (stream-done event for typed,
//                      resolved invoke for hotkey), i.e. after any production post-processing.
// Nothing in the production code path is modified. The prompt recorder (NATIVELY_PROMPT_DEBUG) is
// a dev-only fetch wrapper that tees the response body; it is on for metadata capture.
import { sha256 } from './metrics.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function setupProfile(c, { deepseekKey }) {
  // Exactly ONE LLM key in the profile, no setModel(): the app's own default routing decides.
  const r = await c.launcher.evaluate(`(async () => {
    const api = window.electronAPI; const out = {};
    out.before = await api.getCurrentLlmConfig();
    out.ds = await api.setDeepseekApiKey(${JSON.stringify(deepseekKey)});
    out.pro = await api.e2eInvoke('__e2e__:enable-pro');
    out.cfg = await api.getCurrentLlmConfig();
    return out;
  })()`);
  if (!r?.ds?.success) throw new Error('could not set DeepSeek key: ' + JSON.stringify(r?.ds));
  return { before: r.before, config: r.cfg, pro: r.pro };
}

export async function recorderEnabled(c) {
  const d = await c.invoke('__e2e__:prompt-debug', { clear: false, last: 1 });
  return !!d?.enabled;
}

export async function listModes(c) {
  return c.launcher.evaluate(`window.electronAPI.modesGetAll()`);
}

/** The built-in mode of a template (custom modes share templateType — never match on that alone). */
export async function builtinModeId(c, templateType) {
  const modes = await listModes(c);
  const m = modes.find(x => x.templateType === templateType && (x.isBuiltin ?? x.builtIn) === true);
  if (!m) throw new Error(`no built-in mode for ${templateType}`);
  return m.id;
}

/**
 * A custom mode with the SAME template as the built-in, carrying one synthetic reference file —
 * what a user gets by creating a mode from the template and uploading a document.
 */
export async function contextModeId(c, templateType, ctx) {
  const name = `BM ${templateType} ${ctx.id}`;
  let modes = await listModes(c);
  let m = modes.find(x => x.name === name);
  if (!m) {
    const r = await c.launcher.evaluate(`window.electronAPI.modesCreate({ name: ${JSON.stringify(name)}, templateType: ${JSON.stringify(templateType)} })`);
    m = r?.mode ?? r;
    if (!m?.id) { modes = await listModes(c); m = modes.find(x => x.name === name); }
    if (!m?.id) throw new Error('modesCreate failed for ' + name);
    const add = await c.invoke('__e2e__:add-reference-file', { modeId: m.id, fileName: ctx.file_name, content: ctx.text });
    if (!add?.success) throw new Error(`add-reference-file failed for ${ctx.id}: ${add?.error}`);
    await c.invoke('__e2e__:prewarm-mode', m.id);
    for (let i = 0; i < 40; i++) {
      const st = await c.invoke('__e2e__:index-status', m.id);
      const s = st?.statuses ?? [];
      if (s.length && s.every(x => x.status === 'ready')) break;
      await sleep(500);
    }
  }
  const st = await c.invoke('__e2e__:index-status', m.id);
  return { id: m.id, name, index: st?.statuses ?? [] };
}

export async function activateMode(c, modeId) {
  const r = await c.launcher.evaluate(`window.electronAPI.modesSetActive(${JSON.stringify(modeId)})`);
  return r;
}

export async function resetSession(c) {
  await c.invoke('__e2e__:reset-session');
}

export async function injectLines(c, lines) {
  for (const t of lines) await c.invoke('__e2e__:inject-transcript', { speaker: t.speaker === 'other' ? 'interviewer' : 'user', text: t.text, final: true });
}

export async function clearRecorder(c) {
  await c.invoke('__e2e__:prompt-debug', { clear: true, last: 1 });
}

const HOTKEY_JS = (timeoutMs) => `(async () => {
  const api = window.electronAPI;
  const toks = []; let fin = null, finT = null;
  const gens = new Set();
  const off1 = api.onIntelligenceTokenBatch((d) => { if (d && d.kind === 'suggested_answer') { const t = performance.now(); for (const it of d.items || []) { toks.push([t, it.token]); if (it.generationId != null) gens.add(String(it.generationId)); } } });
  const off2 = api.onIntelligenceSuggestedAnswer((d) => { fin = d; finT = performance.now(); });
  const epochAt = () => performance.timeOrigin + performance.now();
  const t0 = performance.now(); const t0Epoch = performance.timeOrigin + t0;
  let ret = null, err = null, timedOut = false, tRet = null;
  const timer = new Promise(res => setTimeout(() => res('__timeout__'), ${timeoutMs}));
  try { const r = await Promise.race([api.generateWhatToSay(), timer]); if (r === '__timeout__') timedOut = true; else { ret = r; tRet = performance.now(); } } catch (e) { err = String(e); tRet = performance.now(); }
  await new Promise(r => setTimeout(r, 450));
  try { off1(); off2(); } catch {}
  return {
    t0Epoch, timedOut, err,
    ret: ret && typeof ret === 'object' ? { answer: ret.answer ?? null, error: ret.error ?? null, question: ret.question ?? null, keys: Object.keys(ret) } : ret,
    fin: fin ? { answer: fin.answer ?? null, question: fin.question ?? null } : null,
    finMs: finT == null ? null : finT - t0,
    retMs: tRet == null ? null : tRet - t0,
    tokens: toks.map(([t, s]) => [t - t0, s]), generationIds: [...gens],
  };
})()`;

const TYPED_JS = (question, context, timeoutMs) => `(async () => {
  const api = window.electronAPI;
  const toks = []; let done = null, doneT = null, errMsg = null, errT = null;
  const gens = new Set();
  const off1 = api.onGeminiStreamToken((tok, meta) => { toks.push([performance.now(), tok]); if (meta && meta.streamId != null) gens.add(String(meta.streamId)); });
  const off2 = api.onGeminiStreamDone((d) => { done = d || {}; doneT = performance.now(); });
  const off3 = api.onGeminiStreamError((e) => { errMsg = String(e); errT = performance.now(); });
  const t0 = performance.now(); const t0Epoch = performance.timeOrigin + t0;
  let invokeErr = null, tRet = null, timedOut = false;
  const timer = new Promise(res => setTimeout(() => res('__timeout__'), ${timeoutMs}));
  const finished = new Promise(res => { const iv = setInterval(() => { if (done || errMsg || (tRet != null && performance.now() - tRet > 2500)) { clearInterval(iv); res('ok'); } }, 10); });
  try {
    const call = api.streamGeminiChat(${JSON.stringify(question)}, undefined, ${JSON.stringify(context)}).then(() => { tRet = performance.now(); });
    const r = await Promise.race([Promise.all([call, finished]), timer]);
    if (r === '__timeout__') timedOut = true;
  } catch (e) { invokeErr = String(e); }
  await new Promise(r => setTimeout(r, 450));
  try { off1(); off2(); off3(); } catch {}
  return {
    t0Epoch, timedOut, err: invokeErr || errMsg,
    fin: done ? { answer: typeof done.finalText === 'string' ? done.finalText : null, incomplete: done.incomplete ?? null } : null,
    finMs: doneT == null ? null : doneT - t0,
    retMs: tRet == null ? null : tRet - t0,
    errMs: errT == null ? null : errT - t0,
    tokens: toks.map(([t, s]) => [t - t0, s]), generationIds: [...gens],
  };
})()`;

/** One timed ask. `surface` is 'hotkey' | 'typed'. Returns raw measurements only. */
export async function timedAsk(c, { surface, question, uiContext = '', timeoutMs = 90000 }) {
  if (surface === 'hotkey') {
    await c.invoke('__e2e__:inject-transcript', { speaker: 'interviewer', text: question, final: true });
    const r = await c.launcher.evaluate(HOTKEY_JS(timeoutMs), timeoutMs + 30000);
    const raw = r.tokens.map(x => x[1]).join('');
    const finalText = r.fin?.answer ?? r.ret?.answer ?? null;
    return {
      surface, t0Epoch: r.t0Epoch, timedOut: r.timedOut, err: r.err || r.ret?.error || null,
      raw, final: finalText,
      firstTokenMs: r.tokens[0]?.[0] ?? null, lastTokenMs: r.tokens.at(-1)?.[0] ?? null,
      firstChunk: r.tokens[0]?.[1] ?? null, tokenEvents: r.tokens.length, generationIds: r.generationIds,
      totalMs: r.retMs, finalEventMs: r.finMs, heardQuestion: r.fin?.question ?? r.ret?.question ?? null,
    };
  }
  const r = await c.overlay.evaluate(TYPED_JS(question, uiContext, timeoutMs), timeoutMs + 30000);
  const raw = r.tokens.map(x => x[1]).join('');
  return {
    surface, t0Epoch: r.t0Epoch, timedOut: r.timedOut, err: r.err,
    raw, final: r.fin?.answer ?? null,
    firstTokenMs: r.tokens[0]?.[0] ?? null, lastTokenMs: r.tokens.at(-1)?.[0] ?? null,
    firstChunk: r.tokens[0]?.[1] ?? null, tokenEvents: r.tokens.length, generationIds: r.generationIds,
    totalMs: r.finMs ?? r.retMs, finalEventMs: r.finMs, heardQuestion: null,
  };
}

// ---- wire capture: what actually went to the provider ----
function parseStream(text) {
  const out = { usage: null, finish_reason: null, response_model: null, response_id: null, system_fingerprint: null };
  if (!text) return out;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const body = line.slice(5).trim();
    if (!body || body === '[DONE]') continue;
    let j; try { j = JSON.parse(body); } catch { continue; }
    if (j.usage) out.usage = j.usage;
    if (j.usageMetadata) out.usage = { gemini: j.usageMetadata };
    const fr = j.choices?.[0]?.finish_reason; if (fr) out.finish_reason = fr;
    if (j.model) out.response_model = j.model;
    if (j.id) out.response_id = j.id;
    if (j.system_fingerprint) out.system_fingerprint = j.system_fingerprint;
  }
  if (!out.usage) { try { const j = JSON.parse(text); out.usage = j.usage ?? j.usageMetadata ?? null; out.response_model = j.model ?? null; } catch { /* stream */ } }
  return out;
}

export async function collectWire(c) {
  await sleep(350); // the recorder tees the body and persists after the stream ends
  const d = await c.invoke('__e2e__:prompt-debug', { clear: true, last: 60 });
  const records = d?.records ?? [];
  const chat = records.filter(r => r.messages?.length);
  // The GENERATION is the first prompt-bearing request. Later ones (e.g. the production 'corrected answer' pass on
  // document-grounded turns) are recorded in `records`/other_requests and counted, never attributed to the generation.
  const main = chat.find(r => r.note && !/cachedContents/.test(r.path || '')) ?? chat[0] ?? null;
  return { enabled: !!d?.enabled, records, main, chatCount: chat.length, notes: d?.notes ?? [] };
}

export function summariseWire(w, t0Epoch) {
  const m = w.main;
  if (!m) return null;
  const s = parseStream(m.response);
  const dispatchEpoch = Date.parse(m.ts);
  return {
    provider: m.provider, model: m.model, host: m.host, path: m.path, stream: m.stream, status: m.status ?? null,
    params: m.params, system_sha: m.systemSha, system_chars: (m.system || '').length,
    request_seq: m.seq, dispatch_ms_after_t0: Number.isFinite(dispatchEpoch) ? Math.round(dispatchEpoch - t0Epoch) : null,
    note: m.note ? { surface: m.note.surface, promptSource: m.note.promptSource, action: m.note.action ?? null, mode: m.note.mode ?? null, chatSurface: m.note.chatSurface ?? null, tier: m.note.tier ?? null, extra: m.note.extra ?? null, systemMatchesWire: m.note.systemMatchesWire, userMatchesWire: m.note.userMatchesWire } : null,
    response: s,
    responseChars: m.responseChars ?? null,
    requests: w.records.filter(r => r.messages?.length).map(r => ({ provider: r.provider, model: r.model, status: r.status ?? null, hasNote: !!r.note, path: r.path, systemSha: r.systemSha })),
  };
}

export function wireEvidenceFlags(w) {
  const m = w.main;
  const text = m ? (m.messages || []).map(x => x.text).join('\n') : '';
  // Evidence tags carry source_type AND provenance. A user document attached to a mode is
  // provenance="MODE_REFERENCE_FILE" whatever its type (a resume file is source_type RESUME).
  const tags = [...text.matchAll(/<evidence\s[^>]*>/g)].map(t => t[0]);
  const attr = (tag, k) => new RegExp(`${k}="([^"]*)"`).exec(tag)?.[1] ?? null;
  const parsed = tags.map(t => ({ type: attr(t, 'source_type'), provenance: attr(t, 'provenance') }));
  const referenceEvidence = parsed.some(e => e.provenance === 'MODE_REFERENCE_FILE' || e.type === 'REFERENCE_FILE');
  const profileEvidence = parsed.some(e => e.provenance !== 'MODE_REFERENCE_FILE' && /^(RESUME|CANDIDATE_FILE|JOB_DESCRIPTION|PROFILE)/.test(e.type ?? ''));
  return { referenceEvidence, profileEvidence, evidenceTypes: [...new Set(parsed.map(e => `${e.type}/${e.provenance}`))] };
}

export const rowHash = sha256;

// ---- Profile Intelligence (résumé + JD) seeding, E2E hooks only ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function piDocs(profiles, ref) {
  if (!ref) return [];
  const base = profiles.find(p => ref === p.id || ref.startsWith(p.id + '-'));
  if (!base) throw new Error('unknown pi_ref ' + ref);
  if (ref.endsWith('-RESUME')) return [{ docType: 'resume', ...base.resume }];
  if (ref.endsWith('-JD')) return [{ docType: 'jd', ...base.jd }];
  return [{ docType: 'resume', ...base.resume }, { docType: 'jd', ...base.jd }];
}

/** Make the app's PI state exactly `ref` (null = no résumé/JD). Returns what the app reports. */
export async function ensurePi(c, profiles, ref) {
  const clr = await c.invoke('__e2e__:clear-profile');
  if (!clr?.success) throw new Error('clear-profile failed: ' + JSON.stringify(clr));
  const docs = piDocs(profiles, ref);
  const ingests = [];
  for (const d of docs) {
    const file = path.join(os.tmpdir(), `aq-${process.pid}-${d.docType}-${d.file_name}`);
    fs.writeFileSync(file, d.text);
    const r = await c.invoke('__e2e__:ingest-profile-doc', { filePath: file, docType: d.docType });
    ingests.push({ docType: d.docType, success: !!r?.success, error: r?.error ?? null });
    if (!r?.success) throw new Error(`ingest ${d.docType} failed for ${ref}: ${r?.error}`);
  }
  let st = null;
  for (let i = 0; i < 120; i++) {
    st = await c.launcher.evaluate(`window.electronAPI.profileGetStatus()`).catch(() => null);
    const busy = st?.resume_indexing_in_flight || st?.jd_indexing_in_flight || st?.aot_pipeline_running;
    const wantR = docs.some(d => d.docType === 'resume'), wantJ = docs.some(d => d.docType === 'jd');
    if (!busy && (!wantR || st?.profileFactsReady) && (!wantJ || st?.jdFactsReady)) break;
    await sleep(1000);
  }
  const state = await c.invoke('__e2e__:profile-state').catch(() => null);
  return {
    ref, ingests,
    hasStructuredResume: state?.hasStructuredResume ?? null, hasStructuredJD: state?.hasStructuredJD ?? null,
    resumeName: state?.resumeName ?? null, jdCompany: state?.jdCompany ?? null, jdTitle: state?.jdTitle ?? null,
    resumeExtractionMode: state?.resumeExtractionMode ?? null,
    busyAtStart: !!(st?.resume_indexing_in_flight || st?.jd_indexing_in_flight || st?.aot_pipeline_running),
  };
}

/** Full prompt text of the generation request (system + user messages). */
export function promptText(w) {
  const m = w.main;
  return m ? [m.system || '', ...(m.messages || []).map(x => x.text || '')].join('\n') : '';
}
