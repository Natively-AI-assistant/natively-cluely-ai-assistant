// Phase 0/2 reproduction+coverage harness for the answer-pipeline-rebuild effort.
//
// Drives the REAL manual-chat surface (gemini-chat-stream) through a real
// Electron process against the REAL natively-api backend and real provider
// keys. No mocks.
//
// Covers BOTH leak directions, not just one:
//   - "forbidden" cases: generic/technical questions that must NEVER surface
//     profile content (the original 3 reported bugs + additional coverage of
//     the same bug class across other generic-technical vocabulary and
//     trivial-code requests).
//   - "required" cases: genuine experience/profile questions that MUST still
//     surface profile content. Added 2026-07-27 per code-review finding: every
//     prior assertion in this harness tested only the absence direction, so a
//     fix that over-broadly forbids profile everywhere would pass all of them
//     undetected.
//
// The original 3 P0 cases (case1/case2/case3) are the ones with confirmed
// live root causes (see docs/answer-pipeline-rebuild/01_CONFIRMED_ROOT_CAUSES.md)
// and are the ones that should be run at high rep count (PHASE0_REPS, spec
// default 20) for the determinism gate. The expansion cases added alongside
// them are coverage/regression breadth, not yet individually root-caused, and
// default to a lower rep count (PHASE0_EXPANSION_REPS) to control real
// provider spend — raise it once quota/budget allows.
//
// Usage:
//   bash tests/e2e-modes/ensure-backend.sh   # only if not already running on :3000
//   node tests/context-os-real-backend/run-phase0-reproduction.mjs
//
// Env overrides:
//   PHASE0_REPS=3               reps per case for the 3 original P0 cases (spec: 20)
//   PHASE0_EXPANSION_REPS=3     reps per case for the expansion coverage cases
//   PHASE0_TIMEOUT_MS=45000     per-request hard timeout

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
const EXPANSION_REPS = Number(process.env.PHASE0_EXPANSION_REPS || 3);
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

    // The main process broadcasts chat tokens on a single untagged
    // 'gemini-stream-token' channel; a superseded/fire-and-forget losing branch
    // of `raceStreamWithDeadline` can keep emitting after its own request already
    // "finished" from the caller's point of view. Production already defends
    // against this at the renderer layer (src/lib/chatStreamGuard.mjs,
    // resolveChatStreamToken/resolveChatStreamDone: drop any token/done whose
    // streamId is older than the currently-adopted one). This harness MUST apply
    // the identical policy — accepting every token blindly (as an earlier version
    // of this script did) reproduced exactly the interleaving bug that guard
    // exists to prevent, producing garbled answers and impossibly-fast TFFT from
    // stale in-flight tokens. Inlined (not imported) because this closure runs
    // inside page.evaluate, a separate JS realm with no module loader access.
    const askManual = async (question) => raw(async ({ question, timeoutMs }) => {
      const api = window.electronAPI || window.api;
      return new Promise((resolve) => {
        const t0 = performance.now();
        const events = [];
        let settled = false;
        let activeStreamId = null;
        const resolveToken = (incomingId) => {
          if (typeof incomingId !== 'number') return { accept: true, activeId: activeStreamId };
          if (activeStreamId === null || incomingId === activeStreamId) return { accept: true, activeId: incomingId };
          if (incomingId > activeStreamId) return { accept: true, activeId: incomingId };
          return { accept: false, activeId: activeStreamId };
        };
        const resolveDone = (incomingId) => {
          if (typeof incomingId !== 'number') return { honor: true, activeId: null };
          if (activeStreamId === null || incomingId >= activeStreamId) return { honor: true, activeId: null };
          return { honor: false, activeId: activeStreamId };
        };
        const stop = () => { offToken?.(); offDone?.(); offError?.(); clearTimeout(timer); };
        const done = (result) => { if (settled) return; settled = true; stop(); resolve({ ...result, t0, events }); };
        const offToken = api.onGeminiStreamToken((token, meta) => {
          const decision = resolveToken(meta?.streamId);
          activeStreamId = decision.activeId;
          if (!decision.accept) return;
          events.push({ t: performance.now(), token });
        });
        const offDone = api.onGeminiStreamDone((payload) => {
          const decision = resolveDone(payload?.streamId);
          activeStreamId = decision.activeId;
          if (!decision.honor) return;
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

    const runCase = async (caseId, question, { expectProfileLoaded, expectSentinelPresent = false, reps = REPS }) => {
      for (let rep = 1; rep <= reps; rep++) {
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
            // A required-direction case (expectSentinelPresent) that errors out
            // never got its required profile content — that's unambiguously a
            // violation, not a neutral non-event. Without this, an error mid-run
            // would silently read as "clean" for exactly the direction this
            // harness expansion was built to catch (code-review finding, 2026-07-27).
            expectSentinelPresent,
            violation: expectSentinelPresent,
          });
          continue;
        }
        if (response.timedOut) {
          // No confirmed cancel/abort path exists for the underlying gemini-chat-stream
          // request. If it kept running past the timeout, the NEXT rep's fresh token
          // listeners on the same untagged IPC channel could pick up its stray tokens
          // and silently corrupt that rep's TFFT/answer. Hard-stop rather than risk
          // cross-rep contamination that would be invisible in the output.
          results.push({
            caseId, rep, question, real_backend: true, mock: false, timedOut: true, failed: true,
            expectSentinelPresent,
            violation: expectSentinelPresent,
          });
          throw new Error(`${caseId} rep ${rep} timed out after ${TIMEOUT_MS}ms — stopping run to avoid cross-rep stream contamination (no confirmed cancel path for gemini-chat-stream)`);
        }
        const wallMs = Date.now() - startedAt;
        const { rawMs, filteredMs } = computeTfft(response.t0, response.events);
        const providerModel = await invoke('__e2e__:last-provider-model').catch(() => null);
        const benchmarkAudit = await invoke('__e2e__:context-os-benchmark-audit').catch(() => null);
        const promptAudit = await invoke('__e2e__:context-os-prompt-audit').catch(() => null);
        const answer = response.answer || '';
        const sentinelHit = SENTINELS.find((s) => answer.toLowerCase().includes(String(s).toLowerCase())) || null;
        // Ground-truth fallback for the "required" direction (live-confirmed false
        // positive, 2026-07-27): a correct, profile-grounded answer can legitimately
        // paraphrase the candidate's experience (e.g. describe the Kafka/Flink
        // migration) without ever repeating a literal sentinel string (candidate
        // name, employer, project title) — confirmed via a real rep where
        // `promptAuditLatest.hasRawCandidateProfile` was true (profile WAS injected
        // and used) but zero sentinel strings appeared in the prose. Literal-string
        // matching alone cannot distinguish that from a genuine leak-direction bug;
        // when the prompt-audit ring fires, trust its ground truth over the text
        // heuristic for this direction. It does NOT change the forbidden direction
        // (a profile block should never be injected there in the first place, so no
        // equivalent false-positive risk exists on that side).
        const hasRawProfileEvidence = promptAudit?.audit?.at(-1)?.hasRawCandidateProfile === true;
        const requiredSatisfied = Boolean(sentinelHit) || (expectSentinelPresent && hasRawProfileEvidence);
        const violation = expectSentinelPresent ? !requiredSatisfied : Boolean(sentinelHit);
        const hasCodeFenceFirst = /^\s*```/.test(answer);
        // A genuine unwanted DSA-contract section (## Complexity heading, or the
        // contract's specific "Time Complexity: ... / Space Complexity: ..." dual
        // line pattern) is the actual bug (RC-7). A single incidental clause like
        // "this is O(1) because it's one arithmetic operation" inside an
        // otherwise-appropriate short explanation is NOT the bug — CODING_CONTRACT_IMPL
        // explicitly asks for a short explanation, and one clause mentioning
        // complexity naturally is normal prose, not a mandated dedicated section.
        const hasComplexitySection = /^\s*##\s*complexity\b/im.test(answer)
          || (/\btime complexity\b/i.test(answer) && /\bspace complexity\b/i.test(answer));
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
          expectSentinelPresent,
          sentinelLeak: Boolean(sentinelHit),
          sentinelMatched: sentinelHit,
          // Direction-aware violation: for "forbidden" cases (the majority),
          // any sentinel hit is a leak. For "required" cases (profile/experience
          // questions that must surface profile content), the violation is the
          // OPPOSITE — sentinel absence. Without this, a fix that over-broadly
          // forbids profile context everywhere would silently pass every
          // "forbidden" assertion in this harness while breaking real profile
          // Q&A, undetected (code-review finding, 2026-07-27).
          violation,
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
        console.log(`[phase0] ${caseId} rep ${rep}/${reps}: success=${response.success} tfft_raw=${rawMs?.toFixed(0)}ms tfft_filtered=${filteredMs?.toFixed(0)}ms sentinelLeak=${Boolean(sentinelHit)} violation=${violation} model=${providerModel?.model}`);
      }
    };

    // Case 1 FIRST, before any profile is ingested.
    await runCase('case1_odd_even', 'write the code for odd even', { expectProfileLoaded: false });

    // Additional trivial-code coverage (RC-7 bug class) — no profile loaded yet.
    // Forbidden: unwanted six-section DSA/complexity contract on simple utility code.
    const TRIVIAL_CODE_CASES = [
      ['case1b_reverse_string', 'write a function to reverse a string'],
      ['case1c_check_prime', 'write code to check if a number is prime'],
      ['case1d_array_max', 'write a function to find the max value in an array'],
      ['case1e_sum_list', 'write code to sum a list of numbers'],
    ];
    for (const [caseId, question] of TRIVIAL_CODE_CASES) {
      await runCase(caseId, question, { expectProfileLoaded: false, reps: EXPANSION_REPS });
    }

    // Ingest p01 profile for cases 2 & 3 and all subsequent cases.
    const ingest = await invoke('__e2e__:ingest-profile-doc', { filePath: path.join(P01_DIR, 'resume.pdf'), docType: 'resume' });
    if (!ingest?.success) {
      console.error('[phase0] profile ingestion failed:', ingest?.error);
    } else {
      console.log('[phase0] p01 resume ingested. hasStructuredResume=', ingest.hasStructuredResume);
    }

    await runCase('case2_what_is_api', 'what is an api', { expectProfileLoaded: true });
    await runCase('case3_qraphql', 'what is a qraphql query', { expectProfileLoaded: true });

    // Additional generic-technical coverage (RC-2 bug class) — profile loaded,
    // must NOT leak, same as case2/case3 but broader vocabulary from the
    // spec's core-generic question list.
    const GENERIC_TECHNICAL_CASES = [
      ['case2b_database_index', 'what is a database index'],
      ['case2c_dependency_injection', 'what is dependency injection'],
      ['case2d_race_condition', 'what is a race condition'],
      ['case2e_rest', 'what is REST'],
      ['case2f_big_o', 'what is Big O notation'],
      ['case2g_hash_map', 'what is a hash map'],
      ['case2h_ci_cd', 'what is CI/CD'],
      ['case2i_microservice', 'what is a microservice'],
      ['case2j_tcp_udp', 'what is the difference between TCP and UDP'],
    ];
    for (const [caseId, question] of GENERIC_TECHNICAL_CASES) {
      await runCase(caseId, question, { expectProfileLoaded: true, reps: EXPANSION_REPS });
    }

    // "Required" direction (code-review finding, 2026-07-27): genuine
    // experience/profile questions that MUST still surface profile content.
    // Every case above only tests that profile is absent; without these, an
    // over-broad forbid-profile-everywhere fix would pass 100% of this
    // harness while silently breaking real profile Q&A.
    const PROFILE_REQUIRED_CASES = [
      ['case3b_stripe_experience', 'tell me about your experience at Stripe'],
      ['case3c_project_walkthrough', 'walk me through the Merchant Settlement Reconciliation Pipeline project'],
      ['case3d_last_role', 'what did you do in your last role?'],
    ];
    for (const [caseId, question] of PROFILE_REQUIRED_CASES) {
      await runCase(caseId, question, { expectProfileLoaded: true, expectSentinelPresent: true, reps: EXPANSION_REPS });
    }

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
    const violations = rows.filter((r) => r.violation);
    const avgRaw = ok.length ? (ok.reduce((a, r) => a + (r.tfft_raw_ms || 0), 0) / ok.length).toFixed(0) : 'n/a';
    const avgFiltered = ok.length ? (ok.reduce((a, r) => a + (r.tfft_filtered_ms || 0), 0) / ok.length).toFixed(0) : 'n/a';
    return { rows, ok, violations, avgRaw, avgFiltered };
  };

  const CASE_LABELS = [
    ['case1_odd_even', 'Case 1 [P0] — "write the code for odd even" (no profile, forbidden: complexity bloat)'],
    ['case1b_reverse_string', 'Case 1b — "reverse a string" (no profile, forbidden: complexity bloat)'],
    ['case1c_check_prime', 'Case 1c — "check if a number is prime" (no profile, forbidden: complexity bloat)'],
    ['case1d_array_max', 'Case 1d — "find the max value in an array" (no profile, forbidden: complexity bloat)'],
    ['case1e_sum_list', 'Case 1e — "sum a list of numbers" (no profile, forbidden: complexity bloat)'],
    ['case2_what_is_api', 'Case 2 [P0] — "what is an api" (profile loaded, forbidden: profile leak)'],
    ['case3_qraphql', 'Case 3 [P0] — "what is a qraphql query" (profile loaded, forbidden: profile leak)'],
    ['case2b_database_index', 'Case 2b — "what is a database index" (forbidden: profile leak)'],
    ['case2c_dependency_injection', 'Case 2c — "what is dependency injection" (forbidden: profile leak)'],
    ['case2d_race_condition', 'Case 2d — "what is a race condition" (forbidden: profile leak)'],
    ['case2e_rest', 'Case 2e — "what is REST" (forbidden: profile leak)'],
    ['case2f_big_o', 'Case 2f — "what is Big O notation" (forbidden: profile leak)'],
    ['case2g_hash_map', 'Case 2g — "what is a hash map" (forbidden: profile leak)'],
    ['case2h_ci_cd', 'Case 2h — "what is CI/CD" (forbidden: profile leak)'],
    ['case2i_microservice', 'Case 2i — "what is a microservice" (forbidden: profile leak)'],
    ['case2j_tcp_udp', 'Case 2j — "TCP vs UDP" (forbidden: profile leak)'],
    ['case3b_stripe_experience', 'Case 3b — "experience at Stripe" (REQUIRED: profile must appear)'],
    ['case3c_project_walkthrough', 'Case 3c — "Merchant Settlement Reconciliation Pipeline" (REQUIRED: profile must appear)'],
    ['case3d_last_role', 'Case 3d — "what did you do in your last role" (REQUIRED: profile must appear)'],
  ];

  const md = [];
  md.push('# Phase 0/2 — Reproduction + Coverage Results (real backend, real providers)');
  md.push('');
  md.push(`Generated: ${now()}  \nBackend: ${BACKEND_URL} (${backendState.started ? 'started by this run' : 'already running'})  \nReps per P0 case: ${REPS}  \nReps per expansion case: ${EXPANSION_REPS}`);
  md.push('');
  md.push('Direction legend: **forbidden** = sentinel (profile content) must NEVER appear; a hit is a violation. **REQUIRED** = sentinel must appear; an absence is a violation.');
  md.push('');
  let totalViolations = 0;
  for (const [caseId, label] of CASE_LABELS) {
    const rows = results.filter((r) => r.caseId === caseId);
    if (!rows.length) continue; // case wasn't run this pass (e.g. profile ingestion failed)
    const { ok, violations, avgRaw, avgFiltered } = summarize(caseId);
    totalViolations += violations.length;
    md.push(`## ${label}`);
    md.push('');
    md.push(`- Reps: ${rows.length}, succeeded: ${ok.length}, **violations: ${violations.length}/${rows.length}**`);
    md.push(`- Avg TFFT raw: ${avgRaw}ms, avg TFFT filtered: ${avgFiltered}ms`);
    if (/^case1/.test(caseId)) {
      const fenceFirst = rows.filter((r) => r.hasCodeFenceFirst).length;
      const complexity = rows.filter((r) => r.hasComplexitySection).length;
      md.push(`- Code-fence-first: ${fenceFirst}/${rows.length}; complexity/Big-O section present: ${complexity}/${rows.length}`);
    }
    md.push('');
    md.push('| rep | success | model | tfft_raw_ms | tfft_filtered_ms | sentinelLeak | violation | sourceOwner | sourceAuthority | answerPolicy | preview |');
    md.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      md.push(`| ${r.rep} | ${r.success} | ${r.providerModel || 'n/a'} | ${r.tfft_raw_ms?.toFixed(0) ?? 'n/a'} | ${r.tfft_filtered_ms?.toFixed(0) ?? 'n/a'} | ${r.sentinelLeak} | ${r.violation ? '**YES**' : 'no'} | ${r.benchmarkAuditTerminal?.sourceOwner ?? 'n/a'} | ${r.benchmarkAuditTerminal?.sourceAuthority ?? 'n/a'} | ${r.benchmarkAuditTerminal?.answerPolicy ?? 'n/a'} | ${JSON.stringify(r.answerPreview)} |`);
    }
    md.push('');
  }
  md.push('## Notes');
  md.push('');
  md.push(`- **Total violations across all cases/reps this run: ${totalViolations}.**`);
  md.push('- `benchmarkAuditTerminal` / `promptAuditLatest` are populated only if `recordContextOsBenchmarkAudit` / the `NATIVELY_CONTEXT_OS_PROMPT_AUDIT` ring actually fire on the manual-chat (no-mode) code path — if these are consistently null/empty, that itself is evidence the manual-chat path uses a different (unaudited) trace mechanism, per Phase 1 RC-3.');
  md.push('- Sentinel strings checked (fictional p01 identity, never real user data): ' + SENTINELS.map((s) => `"${s}"`).join(', '));
  md.push('- No API keys, .env content, or full personal profile text are logged by this script or its outputs.');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md.join('\n'));
  fs.writeFileSync(path.join(repoRoot, 'docs/answer-pipeline-rebuild/00_REPRODUCTION.md'), md.join('\n'));

  console.log(`[phase0] done. ${totalViolations} violation(s) across ${results.length} rep(s). Results written to`, outDir, 'and docs/answer-pipeline-rebuild/00_REPRODUCTION*.');
  if (totalViolations > 0) {
    console.error(`[phase0] FAILING: ${totalViolations} violation(s) detected — see summary.md for which cases/reps.`);
    process.exitCode = 1;
  }
  if (runError) {
    console.error('[phase0] Run ended early due to an error (partial results above are real, not fabricated):', runError.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[phase0] FATAL:', error?.stack || error);
  process.exitCode = 1;
});
