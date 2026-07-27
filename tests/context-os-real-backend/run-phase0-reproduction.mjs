// Phase 0 reproduction harness for the answer-pipeline-rebuild effort.
//
// Drives the REAL manual-chat surface (gemini-chat-stream) through a real
// Electron process against the REAL natively-api backend and real provider
// keys. No mocks. Reproduces 3 known bugs:
//   Case 1: "write the code for odd even"          (no profile loaded)
//   Case 2: "what is an api"                        (profile p01 loaded)
//   Case 3: "what is a qraphql query"                (profile p01 loaded)
//
// Usage:
//   bash tests/e2e-modes/ensure-backend.sh   # only if not already running on :3000
//   node tests/context-os-real-backend/run-phase0-reproduction.mjs
//
// Env overrides:
//   PHASE0_REPS=3            reps per case
//   PHASE0_TIMEOUT_MS=45000  per-request hard timeout

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (s) => crypto.createHash('sha1').update(s || '').digest('hex').slice(0, 12);
const REPS = Number(process.env.PHASE0_REPS || 3);
const TIMEOUT_MS = Number(process.env.PHASE0_TIMEOUT_MS || 45_000);
const BACKEND_URL = process.env.NATIVELY_API_URL || 'http://127.0.0.1:3000';

const P01_DIR = path.join(repoRoot, 'test-fixtures/profiles/p01');
const P01_META = JSON.parse(fs.readFileSync(path.join(P01_DIR, 'meta.json'), 'utf8'));
// Sentinel strings — fictional, unique to p01. Their presence in an answer to a
// generic/non-candidate question is unambiguous evidence of a profile leak.
const SENTINELS = [
  P01_META.candidate_name,           // "Marcus J. Holloway"
  'Holloway',
  P01_META.current_employer,          // "Stripe, Inc."
  'Stripe',
  P01_META.projects?.[0]?.name,       // "Merchant Settlement Reconciliation Pipeline"
].filter(Boolean);

const outDir = path.join(repoRoot, 'test-results/context-os-real-backend', `phase0-repro-${now().replace(/[:.]/g, '-')}`);
fs.mkdirSync(outDir, { recursive: true });
const docsDir = path.join(repoRoot, 'docs/answer-pipeline-rebuild');
fs.mkdirSync(docsDir, { recursive: true });

const preview = (s, n = 80) => String(s || '').slice(0, n).replace(/\s+/g, ' ');
// Defensive redaction for anything accidentally captured in electron stdout/stderr/console
// logs (this harness runs against real provider keys). Never expect these to fire, but a
// prior incident in this repo (.env parse leaking a key into a transcript) makes this cheap
// insurance worthwhile.
const redactSecrets = (s) => String(s)
  .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_GOOGLE_KEY]')
  .replace(/sk-[0-9A-Za-z_-]{10,}/g, '[REDACTED_SK_KEY]')
  .replace(/Bearer\s+[0-9A-Za-z._-]{10,}/gi, 'Bearer [REDACTED]')
  .replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]');

async function ensureBackendUp() {
  const probe = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-natively-local-test': 'local-test' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'reply with exactly: pong' }] }),
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  if (await probe()) return { started: false };
  console.log('[phase0] backend not responding on', BACKEND_URL, '— starting via ensure-backend.sh');
  const { spawn } = await import('node:child_process');
  const child = spawn('bash', [path.join(repoRoot, 'tests/e2e-modes/ensure-backend.sh')], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (await probe()) return { started: true };
  }
  throw new Error('Backend did not become healthy within 60s of starting ensure-backend.sh');
}

async function main() {
  const backendState = await ensureBackendUp();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase0-repro-'));
  const launchEnv = {
    ...process.env,
    NODE_ENV: 'development',
    NATIVELY_E2E: '1',
    NATIVELY_E2E_LOCAL_TEST_TOKEN: process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN || 'local-test',
    NATIVELY_API_URL: BACKEND_URL,
    NATIVELY_TEST_USERDATA: userDataDir,
    NATIVELY_CONTEXT_OS_BENCHMARK_AUDIT: '1',
    NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1',
    NATIVELY_CONTEXT_OS: '1',
    NATIVELY_CONTEXT_OS_MANUAL_CHAT: '1',
    NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '1',
    NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES: '1',
    NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION: '1',
    OLLAMA_URL: 'http://127.0.0.1:1',
  };
  const launchArgs = ['dist-electron/electron/main.js', `--user-data-dir=${userDataDir}`];
  const results = [];
  let app;
  let runError = null;
  try {
    app = await electron.launch({ args: launchArgs, env: launchEnv, timeout: 60_000, cwd: repoRoot });
    const electronLogPath = path.join(outDir, 'electron-console.log');
    const appendLog = (prefix, data) => fs.appendFileSync(electronLogPath, `[${now()}] ${prefix}${redactSecrets(data)}\n`);
    app.process().stdout?.on('data', (d) => appendLog('stdout ', d));
    app.process().stderr?.on('data', (d) => appendLog('stderr ', d));
    app.on('console', (m) => appendLog('renderer ', `${m.type()}: ${m.text()}`));
    await app.firstWindow({ timeout: 30_000 });
    const pageOf = async () => app.windows()[0] || app.firstWindow({ timeout: 30_000 });
    const raw = async (callback, arg) => {
      let lastError;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const win = await pageOf();
          await win.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
          return await win.evaluate(callback, arg);
        } catch (error) {
          lastError = error;
          const msg = String(error?.message || error);
          const retryable = /Execution context was destroyed|navigation|Target page.*closed/i.test(msg);
          if (!retryable || attempt === 5) throw error;
          await sleep(750);
        }
      }
      throw lastError;
    };
    const invoke = (channel, ...args) => raw(async ({ channel, args }) => {
      const api = window.electronAPI || window.api;
      return api.e2eInvoke(channel, ...args);
    }, { channel, args });

    try {
    const enablePro = await invoke('__e2e__:enable-pro');
    if (!enablePro?.success) throw new Error(`enable-pro failed: ${enablePro?.error}`);
    const providerSet = await raw(() => (window.electronAPI || window.api).setModel('natively'));
    if (!providerSet?.success) throw new Error(`setModel(natively) failed: ${providerSet?.error}`);

    const askManual = async (question) => raw(async ({ question, timeoutMs }) => {
      const api = window.electronAPI || window.api;
      return new Promise((resolve) => {
        const t0 = performance.now();
        const events = [];
        let settled = false;
        const stop = () => { offToken?.(); offDone?.(); offError?.(); clearTimeout(timer); };
        const done = (result) => { if (settled) return; settled = true; stop(); resolve({ ...result, t0, events }); };
        const offToken = api.onGeminiStreamToken((token) => { events.push({ t: performance.now(), token }); });
        const offDone = api.onGeminiStreamDone((payload) => {
          const text = events.map((e) => e.token).join('');
          done({ success: true, answer: payload?.finalText || text });
        });
        const offError = api.onGeminiStreamError((error) => {
          const text = events.map((e) => e.token).join('');
          done({ success: false, error: String(error), answer: text });
        });
        const timer = setTimeout(() => {
          const text = events.map((e) => e.token).join('');
          done({ success: false, timedOut: true, answer: text });
        }, timeoutMs);
        api.streamGeminiChat(question, undefined, undefined, undefined)
          .catch((error) => done({ success: false, error: String(error?.message || error), answer: '' }));
      });
    }, { question, timeoutMs: TIMEOUT_MS });

    // Raw = first token event, unfiltered. Filtered = first point where
    // cumulative text (after stripping a leading fence marker) is unambiguously
    // non-empty. A naive "strip a full ``` fence, check length" approach fails
    // open when the fence itself streams across multiple small token events
    // (e.g. "`" then "``" then "```python" then "\n") — a cumulative value of
    // just 1-2 backticks doesn't match a `^\s*```...` regex at all, so nothing
    // gets stripped and the un-stripped partial-fence text is wrongly counted
    // as "real content". FENCE_PREFIX_RE explicitly recognizes "still could be
    // an incomplete opening fence" and holds off deciding until either real
    // content follows or the stream ends.
    const FENCE_PREFIX_RE = /^`{1,3}[a-zA-Z0-9]*\n?$/;
    const FENCE_LINE_RE = /^\s*```[a-zA-Z0-9]*\n?/;
    const computeTfft = (t0, events) => {
      if (!events.length) return { rawMs: null, filteredMs: null };
      const rawMs = events[0].t - t0;
      let cumulative = '';
      let filteredMs = null;
      for (const ev of events) {
        cumulative += ev.token;
        if (filteredMs !== null) continue;
        const noLeadingWs = cumulative.replace(/^\s+/, '');
        if (noLeadingWs.length === 0) continue; // whitespace-only so far
        if (FENCE_PREFIX_RE.test(noLeadingWs)) continue; // could still be an incomplete opening fence
        const stripped = cumulative.replace(FENCE_LINE_RE, '').trim();
        if (stripped.length > 0) filteredMs = ev.t - t0;
      }
      // Stream ended while still "ambiguously fence-only" (e.g. a fence with no
      // body) — fall back to raw rather than reporting an impossible null.
      if (filteredMs === null) filteredMs = rawMs;
      return { rawMs, filteredMs };
    };

    const runCase = async (caseId, question, { expectProfileLoaded }) => {
      for (let rep = 1; rep <= REPS; rep++) {
        await invoke('__e2e__:reset-session').catch(() => {});
        await invoke('__e2e__:context-os-benchmark-audit-clear').catch(() => {});
        await invoke('__e2e__:context-os-prompt-audit-clear').catch(() => {});
        const startedAt = Date.now();
        let response;
        try {
          response = await askManual(question);
        } catch (error) {
          results.push({
            caseId, rep, question, real_backend: true, mock: false, error: String(error?.message || error),
            failed: true,
          });
          continue;
        }
        if (response.timedOut) {
          // No confirmed cancel/abort path exists for the underlying gemini-chat-stream
          // request. If it kept running past the timeout, the NEXT rep's fresh token
          // listeners on the same untagged IPC channel could pick up its stray tokens
          // and silently corrupt that rep's TFFT/answer. Hard-stop rather than risk
          // cross-rep contamination that would be invisible in the output.
          results.push({ caseId, rep, question, real_backend: true, mock: false, timedOut: true, failed: true });
          throw new Error(`${caseId} rep ${rep} timed out after ${TIMEOUT_MS}ms — stopping run to avoid cross-rep stream contamination (no confirmed cancel path for gemini-chat-stream)`);
        }
        const wallMs = Date.now() - startedAt;
        const { rawMs, filteredMs } = computeTfft(response.t0, response.events);
        const providerModel = await invoke('__e2e__:last-provider-model').catch(() => null);
        const benchmarkAudit = await invoke('__e2e__:context-os-benchmark-audit').catch(() => null);
        const promptAudit = await invoke('__e2e__:context-os-prompt-audit').catch(() => null);
        const answer = response.answer || '';
        const sentinelHit = SENTINELS.find((s) => answer.toLowerCase().includes(String(s).toLowerCase())) || null;
        const hasCodeFenceFirst = /^\s*```/.test(answer);
        const hasComplexitySection = /\b(time complexity|space complexity|complexity analysis|big[- ]o)\b/i.test(answer);
        results.push({
          caseId,
          rep,
          question,
          real_backend: true,
          mock: false,
          cold_or_warm: rep === 1 ? 'cold' : 'warm',
          success: Boolean(response.success),
          timedOut: Boolean(response.timedOut),
          error: response.error || null,
          wallMs,
          tfft_raw_ms: rawMs,
          tfft_filtered_ms: filteredMs,
          outputChars: answer.length,
          answerPreview: preview(answer, 100),
          providerModel: providerModel?.model ?? null,
          expectProfileLoaded,
          sentinelLeak: Boolean(sentinelHit),
          sentinelMatched: sentinelHit,
          hasCodeFenceFirst,
          hasComplexitySection,
          benchmarkAuditRecordCount: benchmarkAudit?.records?.length ?? 0,
          benchmarkAuditTerminal: benchmarkAudit?.records?.at(-1)
            ? {
                sourceOwner: benchmarkAudit.records.at(-1).sourceOwner,
                sourceAuthority: benchmarkAudit.records.at(-1).sourceAuthority,
                answerPolicy: benchmarkAudit.records.at(-1).answerPolicy,
                terminal: benchmarkAudit.records.at(-1).terminal,
                providerDispatch: benchmarkAudit.records.at(-1).providerDispatch,
              }
            : null,
          promptAuditLatest: promptAudit?.audit?.at(-1)
            ? {
                hasRawCandidateProfile: promptAudit.audit.at(-1).hasRawCandidateProfile,
                hasRawLongTermMemory: promptAudit.audit.at(-1).hasRawLongTermMemory,
                hasRawUploadedReference: promptAudit.audit.at(-1).hasRawUploadedReference,
                factualBlockCount: promptAudit.audit.at(-1).factualBlockCount,
                governedByTypedPack: promptAudit.audit.at(-1).governedByTypedPack,
                userContentLen: promptAudit.audit.at(-1).userContentLen,
              }
            : null,
        });
        console.log(`[phase0] ${caseId} rep ${rep}/${REPS}: success=${response.success} tfft_raw=${rawMs?.toFixed(0)}ms tfft_filtered=${filteredMs?.toFixed(0)}ms sentinelLeak=${Boolean(sentinelHit)} model=${providerModel?.model}`);
      }
    };

    // Case 1 FIRST, before any profile is ingested.
    await runCase('case1_odd_even', 'write the code for odd even', { expectProfileLoaded: false });

    // Ingest p01 profile for cases 2 & 3.
    const ingest = await invoke('__e2e__:ingest-profile-doc', { filePath: path.join(P01_DIR, 'resume.pdf'), docType: 'resume' });
    if (!ingest?.success) {
      console.error('[phase0] profile ingestion failed:', ingest?.error);
    } else {
      console.log('[phase0] p01 resume ingested. hasStructuredResume=', ingest.hasStructuredResume);
    }

    await runCase('case2_what_is_api', 'what is an api', { expectProfileLoaded: true });
    await runCase('case3_qraphql', 'what is a qraphql query', { expectProfileLoaded: true });

    await invoke('__e2e__:clear-profile').catch(() => {});
    } catch (error) {
      runError = error;
      console.error('[phase0] run error — persisting partial results collected so far:', error?.stack || error);
    }
  } finally {
    await app?.close().catch(() => {});
  }

  // ---- Persist results ----
  const rawJsonPath = path.join(outDir, 'raw-results.json');
  fs.writeFileSync(rawJsonPath, JSON.stringify({ generatedAt: now(), backendUrl: BACKEND_URL, reps: REPS, timeoutMs: TIMEOUT_MS, sentinelsChecked: SENTINELS, results }, null, 2));
  const docsRawPath = path.join(repoRoot, 'docs/answer-pipeline-rebuild/00_REPRODUCTION_RAW.json');
  fs.writeFileSync(docsRawPath, JSON.stringify({ generatedAt: now(), backendUrl: BACKEND_URL, reps: REPS, timeoutMs: TIMEOUT_MS, sentinelsChecked: SENTINELS, results }, null, 2));

  const summarize = (caseId) => {
    const rows = results.filter((r) => r.caseId === caseId);
    const ok = rows.filter((r) => r.success);
    const leaks = rows.filter((r) => r.sentinelLeak);
    const avgRaw = ok.length ? (ok.reduce((a, r) => a + (r.tfft_raw_ms || 0), 0) / ok.length).toFixed(0) : 'n/a';
    const avgFiltered = ok.length ? (ok.reduce((a, r) => a + (r.tfft_filtered_ms || 0), 0) / ok.length).toFixed(0) : 'n/a';
    return { rows, ok, leaks, avgRaw, avgFiltered };
  };

  const md = [];
  md.push('# Phase 0 — Reproduction Results (real backend, real providers)');
  md.push('');
  md.push(`Generated: ${now()}  \nBackend: ${BACKEND_URL} (${backendState.started ? 'started by this run' : 'already running'})  \nReps per case: ${REPS}`);
  md.push('');
  for (const [caseId, label] of [
    ['case1_odd_even', 'Case 1 — "write the code for odd even" (no profile)'],
    ['case2_what_is_api', 'Case 2 — "what is an api" (profile p01 loaded)'],
    ['case3_qraphql', 'Case 3 — "what is a qraphql query" (profile p01 loaded)'],
  ]) {
    const { rows, ok, leaks, avgRaw, avgFiltered } = summarize(caseId);
    md.push(`## ${label}`);
    md.push('');
    md.push(`- Reps: ${rows.length}, succeeded: ${ok.length}, sentinel leaks: ${leaks.length}/${rows.length}`);
    md.push(`- Avg TFFT raw: ${avgRaw}ms, avg TFFT filtered: ${avgFiltered}ms`);
    if (caseId === 'case1_odd_even') {
      const fenceFirst = rows.filter((r) => r.hasCodeFenceFirst).length;
      const complexity = rows.filter((r) => r.hasComplexitySection).length;
      md.push(`- Code-fence-first: ${fenceFirst}/${rows.length}; complexity/Big-O section present: ${complexity}/${rows.length}`);
    }
    md.push('');
    md.push('| rep | success | model | tfft_raw_ms | tfft_filtered_ms | sentinelLeak | sourceOwner | sourceAuthority | answerPolicy | preview |');
    md.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      md.push(`| ${r.rep} | ${r.success} | ${r.providerModel || 'n/a'} | ${r.tfft_raw_ms?.toFixed(0) ?? 'n/a'} | ${r.tfft_filtered_ms?.toFixed(0) ?? 'n/a'} | ${r.sentinelLeak} | ${r.benchmarkAuditTerminal?.sourceOwner ?? 'n/a'} | ${r.benchmarkAuditTerminal?.sourceAuthority ?? 'n/a'} | ${r.benchmarkAuditTerminal?.answerPolicy ?? 'n/a'} | ${JSON.stringify(r.answerPreview)} |`);
    }
    md.push('');
  }
  md.push('## Notes');
  md.push('');
  md.push('- `benchmarkAuditTerminal` / `promptAuditLatest` are populated only if `recordContextOsBenchmarkAudit` / the `NATIVELY_CONTEXT_OS_PROMPT_AUDIT` ring actually fire on the manual-chat (no-mode) code path — if these are consistently null/empty, that itself is evidence the manual-chat path uses a different (unaudited) trace mechanism, per Phase 1 RC-3.');
  md.push('- Sentinel strings checked (fictional p01 identity, never real user data): ' + SENTINELS.map((s) => `"${s}"`).join(', '));
  md.push('- No API keys, .env content, or full personal profile text are logged by this script or its outputs.');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md.join('\n'));
  fs.writeFileSync(path.join(repoRoot, 'docs/answer-pipeline-rebuild/00_REPRODUCTION.md'), md.join('\n'));

  console.log('[phase0] done. Results written to', outDir, 'and docs/answer-pipeline-rebuild/00_REPRODUCTION*.');
  if (runError) {
    console.error('[phase0] Run ended early due to an error (partial results above are real, not fabricated):', runError.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[phase0] FATAL:', error?.stack || error);
  process.exitCode = 1;
});
