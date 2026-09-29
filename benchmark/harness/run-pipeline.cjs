// benchmark/harness/run-pipeline.cjs
//
// ONE benchmark job = one post-meeting summary generation for one conversation through
// one configuration. Runs under Electron-as-Node (ELECTRON_RUN_AS_NODE=1, same ABI as the
// app) against the REAL bundled production modules (benchmark/build/pipeline.cjs).
//
// It reproduces MeetingPersistence.processAndSaveMeeting's V3 branch step for step
// (mode sections, mode auto-detect meta, MeetingContextAssembler.assembleSummary with the
// production flag values, V3 -> summaryData mapping, title from notes, post-call
// enhancements) minus the DB write / IPC / telemetry side effects.
//
// The LLM seam is the real LLMHelper.generateMeetingSummary on a prototype instance:
//   rung 0 custom provider  -> none configured
//   rung 1 Natively API     -> REAL generateWithNatively -> local natively-api (e2e auth)
//   rungs 2+ (Codex, Antigravity, Groq, Gemini, Ollama) -> disabled AND recorded; any
//            attempt marks the run CONTAMINATED.
// Only deadlines are changed (lifted; production values recorded per call).
//
// usage: run-pipeline.cjs <job.json>

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const zlib = require('zlib');

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ROOT = path.resolve(__dirname, '../..');
const BENCH_TIMEOUT_MS = job.electron_timeout_ms;

// Must be set before the bundle loads (NATIVELY_API_URL is read at module init).
process.env.NATIVELY_API_URL = `http://127.0.0.1:${job.port}`;
process.env.NATIVELY_E2E = '1';
process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN = job.local_test_token;

// Long-timeout global dispatcher for the harness->local-server hop (Node fetch defaults
// to a 300s headers timeout, which would cut slow configs off inside the harness).
const undici = require(path.join(ROOT, 'node_modules/undici'));
undici.setGlobalDispatcher(new undici.Agent({ headersTimeout: 1_900_000, bodyTimeout: 1_900_000 }));

const events = [];
const calls = [];
const fetches = [];
const contamination = [];
const als = new AsyncLocalStorage();
const t0 = performance.now();
const rel = () => Math.round(performance.now() - t0);

const origFetch = globalThis.fetch;
globalThis.fetch = async function (input, init = {}) {
  const url = typeof input === 'string' ? input : (input?.url || String(input));
  const ctx = als.getStore() || {};
  const isLocal = url.startsWith(process.env.NATIVELY_API_URL);
  const hdrs = init.headers || {};
  const reqId = hdrs['X-Request-Id'] || hdrs['x-request-id'] || null;
  const rec = { call_id: ctx.callId ?? null, url_path: isLocal ? new URL(url).pathname : '[external]', req_id: reqId, t_start_ms: rel() };
  if (!isLocal) {
    let host = ''; try { host = new URL(url).host; } catch { }
    contamination.push({ kind: 'electron_external_fetch', host, call_id: ctx.callId ?? null });
    rec.blocked_host = host;
    fetches.push(rec);
    throw new Error(`bench: external fetch blocked (${host})`);
  }
  let body = null;
  try { body = JSON.parse(init.body); } catch { }
  rec.request = body ? { purpose: body.purpose ?? null, language: body.language ?? null, fast_mode: body.fast_mode ?? null, system_chars: (body.system || '').length, messages: (body.messages || []).map(m => ({ role: m.role, chars: String(m.content || '').length })) } : null;
  try {
    const res = await origFetch(input, init);
    rec.status = res.status;
    rec.t_headers_ms = rel();
    // Clone to read the server model without consuming the caller's body.
    const clone = res.clone();
    clone.json().then(j => { rec.server_model = j?.model ?? null; rec.t_body_ms = rel(); }).catch(() => { });
    fetches.push(rec);
    return res;
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 200);
    rec.t_error_ms = rel();
    fetches.push(rec);
    throw e;
  }
};

// Capture the pipeline's own diagnostic warnings (polish rejections, V3 failures, fallbacks).
const WATCH_RE = /SummaryPolisher|MeetingContextAssembler|Natively API summary failed|Codex|Antigravity|Groq|Gemini|Ollama|FollowUp|title|Title|fallback|Fallback/;
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    if (WATCH_RE.test(line)) events.push({ t_ms: rel(), level, call_id: (als.getStore() || {}).callId ?? null, msg: line.slice(0, 400) });
    if (process.env.BENCH_VERBOSE) orig(...args);
  };
}

const m = require(path.join(ROOT, 'benchmark/build/pipeline.cjs'));
const { LLMHelper, MeetingContextAssembler, generateTitleFromSummaryWithSource, buildPostCallEnhancements, TEMPLATE_NOTE_SECTIONS, MeetingModeDetector, isIntelligenceFlagEnabled } = m;
const P = LLMHelper.prototype;

function classify(systemPrompt, context) {
  const s = String(systemPrompt || '');
  const c = String(context || '');
  if (s.startsWith('You are a meticulous meeting note-taker')) return 'chunk_extraction';
  const rep = /^You returned JSON that failed validation for "([^"]+)"/.exec(s);
  if (rep) return `repair:${rep[1]}`;
  if (s.startsWith('Rewrite the meeting summary below')) return 'polish_summary';
  if (s.startsWith('Write an overview of the ENTIRE meeting')) return 'polish_overview';
  if (s.startsWith("You are the user's assistant, drafting the follow-up")) return 'followup_draft';
  if (/title/i.test(s.slice(0, 400)) || /^(Key takeaways:|Overview:|Topics:)/.test(c)) return 'title';
  return 'other';
}

function makeHelper() {
  const h = Object.create(P);
  Object.assign(h, {
    customProvider: null, activeCurlProvider: null, groqFastTextMode: false,
    // Placeholder so generateWithNatively skips the CredentialsManager lazy-load (needs electron.app).
    // Auth header is still the e2e local-test header, which generateWithNatively checks FIRST.
    nativelyKey: 'bench-placeholder-not-a-key',
    aiResponseLanguage: 'auto',            // LLMHelper field default
    currentModelId: 'natively', useOllama: false, groqClient: null, client: null,
    isLocalOnlyMode: false, codexCliConfig: { enabled: false, timeoutMs: 0 },
  });
  // No settings store in the harness -> production defaults: no provider switched off,
  // default data-scope policy (post_call_summary allowed).
  h.isProviderDisabled = () => false;
  h.getProviderScopePolicy = () => undefined;
  // Fallback rungs: unavailable, and any attempt is recorded as contamination.
  h.isCodexAvailable = () => { contamination.push({ kind: 'fallback_rung_checked', rung: 'codex', call_id: (als.getStore() || {}).callId ?? null }); return false; };
  h.antigravityFallbackModel = () => { contamination.push({ kind: 'fallback_rung_checked', rung: 'antigravity', call_id: (als.getStore() || {}).callId ?? null }); return null; };
  h.generateContent = async () => { contamination.push({ kind: 'fallback_rung_attempted', rung: 'gemini_flash_lite', call_id: (als.getStore() || {}).callId ?? null }); throw new Error('bench: gemini fallback disabled'); };
  h.generateWithFlash = async () => { contamination.push({ kind: 'fallback_rung_attempted', rung: 'gemini_flash', call_id: (als.getStore() || {}).callId ?? null }); throw new Error('bench: gemini fallback disabled'); };
  // Deadlines only: lift, record the production value.
  h.withTimeout = function (promise, ms, name) {
    const c = calls.find(x => x.call_id === (als.getStore() || {}).callId);
    if (c) (c.production_outer_timeouts ||= []).push({ name, ms });
    return P.withTimeout.call(this, promise, BENCH_TIMEOUT_MS, name);
  };
  h.generateWithNatively = function (userMessage, systemPrompt, imagePaths, opts) {
    const c = calls.find(x => x.call_id === (als.getStore() || {}).callId);
    if (c) c.production_fetch_timeout_ms = opts?.timeoutMs ?? 8000;
    return P.generateWithNatively.call(this, userMessage, systemPrompt, imagePaths, { ...(opts || {}), timeoutMs: BENCH_TIMEOUT_MS });
  };
  let nextCall = 0;
  h.generateMeetingSummary = function (systemPrompt, context, groqSystemPrompt, opts) {
    const callId = ++nextCall;
    const rec = { call_id: callId, stage: classify(systemPrompt, context), purpose: opts?.purpose ?? null, system_chars: String(systemPrompt || '').length, context_chars: String(context || '').length, t_start_ms: rel() };
    calls.push(rec);
    return als.run({ callId }, async () => {
      try {
        const out = await P.generateMeetingSummary.call(this, systemPrompt, context, groqSystemPrompt, opts);
        rec.t_end_ms = rel();
        rec.output_chars = String(out || '').length;
        // Raw visible model output (never hidden reasoning), gzip+base64, for failure analysis.
        rec.output_gz_b64 = zlib.gzipSync(Buffer.from(String(out || ''), 'utf8')).toString('base64');
        return out;
      } catch (e) {
        rec.t_end_ms = rel();
        rec.error = String(e?.message || e).slice(0, 300);
        throw e;
      }
    });
  };
  return h;
}

(async () => {
  const conv = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmark/transcripts', `${job.conversation_id}.segments.json`), 'utf8'));
  const data = { transcript: conv.segments, durationMs: conv.durationMs };
  const flags = Object.fromEntries(['meetingSummaryV3', 'meetingSummaryLlmPolish', 'followUpDraftV2', 'meetingModeAutoDetect', 'meetingMemoryV2'].map(k => [k, isIntelligenceFlagEnabled(k)]));
  const llm = makeHelper();
  const tl = {};
  const result = { job, flags, started_at: new Date().toISOString() };

  // ── processAndSaveMeeting: mode sections (snapshot of a built-in mode, canonical template,
  //    no custom context / reference files -> buildSummarySafeModeContextBlock returns '') ──
  const templateType = job.mode;
  const modeSnapshot = { id: `bench-${templateType}`, name: templateType, templateType };
  const modeNoteSections = TEMPLATE_NOTE_SECTIONS[templateType] ?? [];
  const modeContextBlock = '';
  let title = 'Untitled Session';

  let detectedMode;
  if (flags.meetingModeAutoDetect && data.transcript.length > 2) {
    const detection = new MeetingModeDetector().detect({ transcript: data.transcript, calendarTitle: undefined });
    if (detection.confidence > 0 && detection.templateType !== 'general') {
      detectedMode = { templateType: detection.templateType, confidence: detection.confidence };
    }
  }

  let summaryData = { actionItems: [], keyPoints: [] };
  tl.pipeline_start_ms = rel();
  const statusTimes = [];
  const assembler = new MeetingContextAssembler(llm);
  const v3StartedMs = Date.now();
  const assembled = await assembler.assembleSummary({
    transcript: data.transcript,
    title,
    modeTemplateType: modeSnapshot.templateType,
    modeNoteSections,
    modeContextBlock,
    modeMeta: {
      selectedModeId: modeSnapshot.id, selectedModeName: modeSnapshot.name, selectedTemplateType: modeSnapshot.templateType,
      ...(detectedMode ? { detectedModeName: detectedMode.templateType, detectedConfidence: detectedMode.confidence } : {}),
      summaryModeUsed: modeSnapshot.templateType,
    },
    startedAtMs: v3StartedMs,
    startedAtIso: new Date(v3StartedMs).toISOString(),
    generateFollowUpDraft: flags.followUpDraftV2,
    polishSummary: flags.meetingSummaryLlmPolish,
    onStatusUpdate: status => statusTimes.push({ status, t_ms: rel() }),
  });
  tl.assemble_end_ms = rel();
  result.v3_meta = assembled.meta;

  if (assembled.summary) {
    const v3 = assembled.summary;
    // Verbatim mapping from MeetingPersistence.processAndSaveMeeting (V3 branch).
    summaryData = {
      schemaVersion: 3,
      title: v3.title,
      tldr: v3.tldr,
      whatChanged: v3.whatChanged,
      overview: v3.overview,
      sectionsV3: v3.sections,
      sections: v3.sections.map(section => ({ title: section.title, bullets: section.bullets.map(bullet => bullet.text) })),
      decisions: v3.decisions,
      actionItemsV3: v3.actionItems,
      actionItems: v3.actionItems.map(item => item.text),
      actionItemsStructured: v3.actionItems.map((item, i) => ({
        id: item.id || `action_${i}`,
        text: item.text,
        ...(item.owner ? { owner: item.owner } : {}),
        ...(item.deadline ? { deadline: item.deadline } : {}),
        ...(typeof item.sourceTimestampMs === 'number' ? { sourceTimestamp: item.sourceTimestampMs } : {}),
      })),
      openQuestions: v3.openQuestions,
      risks: v3.risks,
      followUpDraft: v3.followUpDraft,
      timeline: v3.timeline,
      people: v3.people,
      topics: v3.topics,
      sourceQuality: v3.sourceQuality,
      mode: v3.mode,
      generation: v3.generation,
      recipes: v3.recipes,
      keyPoints: v3.tldr,
      actionItemsTitle: 'Action Items',
      keyPointsTitle: 'TLDR',
    };
  } else {
    result.v3_failed = true;   // production would fall to the legacy single-pass path; recorded as a failed run
  }

  // Title from finished notes (no calendar/user title).
  tl.title_start_ms = rel();
  let titleSource = null;
  if (summaryData.schemaVersion === 3) {
    const t = await generateTitleFromSummaryWithSource(llm, summaryData);
    titleSource = t.source;
    if (t.title) { title = t.title; summaryData.title = t.title; }
  }
  tl.title_end_ms = rel();

  if (summaryData.schemaVersion === 3) {
    const post = buildPostCallEnhancements({ transcript: data.transcript, modeTemplateType: modeSnapshot.templateType, summaryData });
    summaryData = {
      ...summaryData,
      coachingInsights: post.coachingInsights,
      actionItemsStructured: Array.isArray(summaryData.actionItemsStructured) && summaryData.actionItemsStructured.length > 0 ? summaryData.actionItemsStructured : post.actionItemsStructured,
      followUpDraft: summaryData.followUpDraft || post.followUpDraft,
    };
  }
  tl.pipeline_end_ms = rel();
  // let any pending body-clone reads settle
  await new Promise(r => setTimeout(r, 50));

  Object.assign(result, {
    finished_at: new Date().toISOString(),
    title, title_source: titleSource,
    timeline_ms: tl, status_times: statusTimes,
    calls, fetches, events, contamination,
    summary: summaryData,
  });
  fs.mkdirSync(path.dirname(job.output_path), { recursive: true });
  fs.writeFileSync(job.output_path, JSON.stringify(result, null, 1));
  process.stdout.write(JSON.stringify({ ok: !result.v3_failed, calls: calls.length, contamination: contamination.length, pipeline_ms: tl.pipeline_end_ms - tl.pipeline_start_ms }) + '\n');
  process.exit(0);
})().catch(e => {
  fs.mkdirSync(path.dirname(job.output_path), { recursive: true });
  fs.writeFileSync(job.output_path.replace(/\.json$/, '.crash.json'), JSON.stringify({ job, error: String(e?.stack || e), calls, fetches, events, contamination }, null, 1));
  process.stdout.write(JSON.stringify({ ok: false, crash: String(e?.message || e) }) + '\n');
  process.exit(2);
});
