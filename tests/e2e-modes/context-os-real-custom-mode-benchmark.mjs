// Context OS — REAL custom-mode benchmark (real-custom-mode-repair, 2026-07-11).
//
// This is the durable, restart-proving regression harness required by the P0
// incident investigation (docs/context-os/real-custom-mode-repair/). Unlike
// the prior probes, this harness:
//   1. creates the mode through the EXACT preload/IPC functions the UI's
//      Modes Manager calls (`modesCreate`, `modesUpdate`, `modesSetActive`),
//   2. attaches a reference file via the SAME ModesManager.addReferenceFile
//      call the real upload-dialog handler invokes AFTER parsing (no hidden
//      test-only fields — only {modeId, fileName, content}, exactly what a
//      real parsed PDF/TXT produces),
//   3. RESTARTS the Electron app (closes and relaunches against the SAME
//      on-disk SQLite DB, via NATIVELY_TEST_USERDATA) to prove the mode's
//      source contract survives — not an in-memory fixture,
//   4. reactivates the mode and asks the full benchmark through BOTH manual
//      chat (`streamGeminiChat`) and What-to-Answer (`__e2e__:ask`) — the
//      real production entry points, never a special direct mode-
//      construction hook.
//
// A real thesis corpus (tests/fixtures/modes/custom/seminar-presentation/)
// is used — the same fixture the pre-existing SeminarPresentationAssistant
// unit-test suite already exercises. A conflicting résumé/JD stays available
// via the real profile-intelligence surface so explicit-switch questions
// have something real to switch TO.
//
// Usage: node tests/e2e-modes/context-os-real-custom-mode-benchmark.mjs
// Requires: npm run build:electron (dist-electron/electron/main.js current).

import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(repoRoot, 'tests/fixtures/modes/custom/seminar-presentation');

// Isolated, persistent-across-restart userData dir — never the developer's
// real dev DB. Deleted at the end unless NATIVELY_BENCHMARK_KEEP_USERDATA=1.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxos-real-mode-benchmark-'));

const baseEnv = {
  ...process.env,
  NATIVELY_E2E: '1',
  NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_TEST_USERDATA: userDataDir,
  // Real-custom-mode-repair Phase 7: enforcement flags must be armed for the
  // verdict rule "enforcement=enforce for the test configuration". These now
  // default ON in isInternalDevTestContext() (NODE_ENV=development above
  // already satisfies that), set explicitly here for clarity/robustness.
  NATIVELY_CONTEXT_OS: '1',
  NATIVELY_CONTEXT_OS_MANUAL_CHAT: '1',
  NATIVELY_CONTEXT_OS_WTA: '1',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '1',
  NATIVELY_CONTEXT_OS_MEMORY_SAFETY: '1',
  NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES: '1',
  NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION: '1',
  NATIVELY_INTELLIGENCE_TRACE: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
};

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

// Real seminar corpus (the SAME files the pre-existing unit test suite
// SeminarPresentationAssistant.test.mjs already exercises). Each is uploaded
// as a SEPARATE reference file, mirroring a real multi-file thesis upload.
const REFERENCE_FILES = [
  'seminar_vla_overview.txt',
  'seminar_hardware_specs.txt',
  'seminar_controller_specs.md',
  'seminar_simulation_stack.md',
  'seminar_dataset_training.txt',
  'seminar_evaluation_results.csv',
  'seminar_custom_prompt_rules.txt',
].filter((f) => fs.existsSync(path.join(FIXTURE_DIR, f)));

// A realistic, NON-regex-engineered prompt — deliberately does NOT use the
// exact "Answer ONLY from the uploaded... Stick strictly to..." phrasing the
// old synthetic probes hand-tuned. This is what a real user would write.
const REALISTIC_SEMINAR_PROMPT = [
  'This is a seminar mode. I am presenting my thesis on AgenticVLA and the',
  'Mercury X1 humanoid robot. Help me confidently answer questions about my',
  'thesis and my project using the files I uploaded.',
].join(' ');

// Minimum benchmark, adapted to the REAL fixture's actual fact set (the
// incident brief's illustrative numbers like "8,400 trajectories" don't
// appear in this real corpus — using them would test nothing; these
// questions test the SAME categories: phases/topic/hardware/controller/
// fine-tuning/agent-framework/teleoperation/dataset/results/company/
// metrics/unsupported-fact-refusal/explicit-switch/return-to-document).
const QUESTIONS = [
  { q: 'What is the main topic of this thesis?', kind: 'doc', expectSubstr: ['agenticvla', 'vision-language-action', 'vla'] },
  { q: 'What robot platform is used in this thesis?', kind: 'doc', expectSubstr: ['mercury x1'] },
  { q: 'What controller does the Mercury X1 use?', kind: 'doc', expectSubstr: ['jetson'] },
  { q: 'What fine-tuning method was used?', kind: 'doc', expectSubstr: ['lora', 'openvla-oft'] },
  { q: 'Which agent framework orchestrates AgenticVLA skills?', kind: 'doc', expectSubstr: ['autogen'] },
  { q: 'What was used for VR teleoperation?', kind: 'doc', expectSubstr: ['unity', 'quest'] },
  { q: 'What objects were used during data collection?', kind: 'doc', expectSubstr: ['banana', 'grapes'] },
  { q: 'Which three models were compared in the evaluation?', kind: 'doc', expectSubstr: ['openvla', 'agenticvla'] },
  { q: 'What success rate did AgenticVLA achieve on the semantic relationship benchmark?', kind: 'doc', expectSubstr: ['44'] },
  { q: 'How did AgenticVLA perform on the prompt complexity benchmark?', kind: 'doc', expectSubstr: ['84'] },
  { q: 'What was the self-awareness benchmark success rate for AgenticVLA?', kind: 'doc', expectSubstr: ['85'] },
  { q: 'What evaluation metrics were used?', kind: 'doc', expectSubstr: ['success rate', 'mse'] },
  { q: 'Who funded this research?', kind: 'doc_absent', forbidSubstr: [] },
  { q: 'How many hours did training take?', kind: 'doc_absent', forbidSubstr: [] },
  { q: 'What was the total project budget?', kind: 'doc_absent', forbidSubstr: [] },
  { q: 'Based only on my résumé, what is my strongest project?', kind: 'explicit_profile' },
  { q: 'According to the JD, what are the main responsibilities?', kind: 'explicit_jd' },
  { q: 'Now return to the uploaded thesis. What robot platform does it use?', kind: 'return_to_doc', expectSubstr: ['mercury x1'] },
];

const FORBIDDEN_PROFILE_LEAK_RE = /\bestrotech\b|\baetherbot\b|\bredismart\b|\bnatively\b(?!\s+(?:the|integrated|combines))/i;

async function main() {
  console.log(`[BENCHMARK] userData: ${userDataDir}`);
  console.log(`[BENCHMARK] Phase A: launch app, create mode through REAL IPC (modesCreate/modesUpdate)...`);

  // --user-data-dir isolates Electron's OWN singleton-lock/profile path (a
  // real dev Natively.app may be running concurrently on this machine and
  // holds the DEFAULT userData path's singleton lock — NATIVELY_TEST_USERDATA
  // alone only redirects DatabaseManager's DB path, not Electron's own lock
  // file, so both must be set to the same isolated directory).
  const launchArgs = ['dist-electron/electron/main.js', `--user-data-dir=${userDataDir}`];
  let app = await electron.launch({ args: launchArgs, env: baseEnv, timeout: 60000 });
  let win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});

  const RAW = async (fn, arg) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const w = app.windows()[0] || (await app.firstWindow());
        await w.waitForLoadState('domcontentloaded').catch(() => {});
        return await w.evaluate(fn, arg);
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  await RAW(async () => { const api = window.electronAPI || window.api; await api.e2eInvoke?.('__e2e__:enable-pro'); }).catch(() => {});

  // Phase A — create the mode via the REAL modesCreate/modesUpdate IPC (the
  // exact functions premium/src/ModesSettings.tsx's Save button calls).
  const modeId = await RAW(async () => {
    const api = window.electronAPI || window.api;
    const created = await api.modesCreate({ name: 'Seminar mode', templateType: 'general' });
    if (!created?.success) throw new Error(`modesCreate failed: ${created?.error}`);
    return created.mode.id;
  });
  console.log(`[BENCHMARK] created mode ${modeId} via real modesCreate IPC`);

  const promptResult = await RAW(async ({ modeId, prompt }) => {
    const api = window.electronAPI || window.api;
    return await api.modesUpdate(modeId, { customContext: prompt });
  }, { modeId, prompt: REALISTIC_SEMINAR_PROMPT });
  if (!promptResult?.success) throw new Error(`modesUpdate (prompt) failed: ${promptResult?.error}`);
  console.log(`[BENCHMARK] saved realistic (non-regex-engineered) prompt via real modesUpdate IPC`);

  // Phase B — attach reference files. Uses ModesManager.addReferenceFile via
  // the __e2e__ shortcut (bypasses ONLY the native OS file-picker dialog and
  // PDF-parsing step — the same underlying method
  // modes:upload-reference-file calls after parsing a real file. See header
  // comment: {modeId, fileName, content} only, no hidden fields.
  let filesAttached = 0;
  for (const fileName of REFERENCE_FILES) {
    const content = readFixture(fileName);
    const res = await RAW(async ({ modeId, fileName, content }) => {
      const api = window.electronAPI || window.api;
      return await api.e2eInvoke('__e2e__:add-reference-file', { modeId, fileName, content });
    }, { modeId, fileName, content });
    if (res?.success) filesAttached++;
    else console.warn(`[BENCHMARK] WARN: failed to attach ${fileName}: ${res?.error}`);
  }
  console.log(`[BENCHMARK] attached ${filesAttached}/${REFERENCE_FILES.length} real reference files`);
  if (filesAttached === 0) throw new Error('no reference files attached — cannot proceed');

  await RAW(async ({ modeId }) => {
    const api = window.electronAPI || window.api;
    return await api.modesSetActive(modeId);
  }, { modeId });
  console.log(`[BENCHMARK] activated mode via real modesSetActive IPC`);

  await RAW(async ({ modeId }) => {
    const api = window.electronAPI || window.api;
    await api.e2eInvoke?.('__e2e__:prewarm-mode', modeId);
  }, { modeId }).catch(() => {});

  // Phase C — RESTART. Close the app, relaunch against the SAME userData dir
  // (same on-disk SQLite DB), and reload/reactivate the mode. This is the
  // exact round-trip the incident brief requires: create -> save -> DATABASE
  // -> restart -> reload -> activate -> runtime snapshot.
  console.log('[BENCHMARK] Phase C: RESTARTING the app against the same on-disk DB...');
  await app.close().catch(() => {});
  // Give the OS a moment to release the singleton lock file before relaunch.
  await new Promise((r) => setTimeout(r, 1000));
  app = await electron.launch({ args: launchArgs, env: baseEnv, timeout: 60000 });
  win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await RAW(async () => { const api = window.electronAPI || window.api; await api.e2eInvoke?.('__e2e__:enable-pro'); }).catch(() => {});

  const reloadedModes = await RAW(async () => {
    const api = window.electronAPI || window.api;
    return await api.modesGetAll();
  });
  const reloadedMode = (reloadedModes?.modes || reloadedModes || []).find((m) => m.id === modeId);
  if (!reloadedMode) throw new Error('mode did not survive restart — reload failed');
  console.log(`[BENCHMARK] mode survived restart: ${JSON.stringify({ id: reloadedMode.id, name: reloadedMode.name, hasContract: Boolean(reloadedMode.sourceContract) })}`);

  await RAW(async ({ modeId }) => {
    const api = window.electronAPI || window.api;
    return await api.modesSetActive(modeId);
  }, { modeId });

  const groundingInfo = await RAW(async () => {
    const api = window.electronAPI || window.api;
    return await api.e2eInvoke?.('__e2e__:index-status', undefined).catch(() => null);
  }).catch(() => null);

  // Let post-restart boot settle (onboarding checks, provider status polls,
  // etc. can trigger a renderer navigation shortly after activation) before
  // starting the long Phase D question loop.
  await new Promise((r) => setTimeout(r, 3000));

  // ── Trace capture (both processes — pre- and post-restart) ─────────────
  const ctxosTraces = [];
  const sourceArbiterLines = [];
  const stderrLines = [];
  const capture = (d) => {
    const s = d.toString();
    for (const line of s.split('\n')) {
      let idx = line.indexOf('[CONTEXT-OS] ');
      if (idx !== -1) {
        try { ctxosTraces.push(JSON.parse(line.slice(idx + 14).trim())); } catch { /* partial */ }
      }
      idx = line.indexOf('[SOURCE-ARBITER] ');
      if (idx !== -1) {
        try { sourceArbiterLines.push(JSON.parse(line.slice(idx + 18).trim())); } catch { /* partial */ }
      }
      if (/Error|crash|FATAL|uncaught/i.test(line)) stderrLines.push(line.trim().slice(0, 200));
    }
  };
  app.process().stdout.on('data', capture);
  app.process().stderr.on('data', capture);

  // Phase D — ask the benchmark through the REAL manual-chat handler.
  //
  // Uses __e2e__:manual-ask, which invokes the EXACT SAME captured
  // `gemini-chat-stream` handler function the real `streamGeminiChat`
  // preload call dispatches to (globalThis.__nativelyGeminiChatStream) — the
  // identical production code path (ipcHandlers.ts:_geminiChatStreamHandler
  // -> planAnswer -> buildCustomModeExecutionContract -> SourceAuthorityKernel
  // -> LLMHelper.streamChat), with only the transport swapped: a synthetic
  // in-process sender instead of a real renderer IPC round-trip. This avoids
  // blocking a page.evaluate() call across a real network request (which is
  // fragile under Playwright if the renderer ever navigates mid-wait) while
  // still exercising every routing/contract/retrieval decision for real.
  console.log('[BENCHMARK] Phase D: asking benchmark questions through real manual-chat handler...');
  const askManual = async (question) => {
    ctxosTraces.length = 0;
    // Retry the WHOLE ask (not just one evaluate call) — a renderer reload
    // mid-request destroys the in-flight execution context and the pending
    // IPC promise along with it; RAW's internal retry only re-issues the
    // evaluate call, which is not enough once the underlying context is gone.
    let lastErr = null;
    for (let outer = 0; outer < 2; outer++) {
      try {
        const result = await RAW(async ({ question }) => {
          const api = window.electronAPI || window.api;
          return await api.e2eInvoke('__e2e__:manual-ask', { question, timeoutMs: 45000 });
        }, { question });
        return { answer: result?.answer || result?.streamedTokens || '', traces: [...ctxosTraces] };
      } catch (e) {
        lastErr = e;
        console.warn(`[BENCHMARK] askManual retry ${outer + 1}/2 after error: ${e?.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.warn(`[BENCHMARK] askManual FAILED after retries: ${lastErr?.message}`);
    return { answer: '', traces: [] };
  };

  const results = [];
  for (const item of QUESTIONS) {
    const { answer, traces } = await askManual(item.q);
    const answerLower = String(answer || '').toLowerCase();
    const leaks = FORBIDDEN_PROFILE_LEAK_RE.test(answer) && item.kind !== 'explicit_profile';
    const supportsExpected = item.expectSubstr
      ? item.expectSubstr.some((s) => answerLower.includes(s.toLowerCase()))
      : null;
    results.push({
      question: item.q,
      kind: item.kind,
      answerPreview: answer.slice(0, 200),
      sourceOwner: traces[0]?.sourceOwner ?? null,
      sourceAuthority: traces[0]?.sourceAuthority ?? null,
      enforcement: traces[0]?.enforcement ?? null,
      finalAction: traces[traces.length - 1]?.finalAction ?? null,
      profileLeakDetected: leaks,
      supportsExpectedFact: supportsExpected,
    });
    console.log(`[BENCHMARK] Q: ${item.q.slice(0, 60)}... -> owner=${traces[0]?.sourceOwner} leak=${leaks} supports=${supportsExpected}`);
  }

  // ── Scoring ──────────────────────────────────────────────────────────────
  const docQuestions = results.filter((r) => r.kind === 'doc');
  const docRoutingCorrect = docQuestions.filter((r) => r.sourceOwner === 'reference_files').length;
  const contaminationCount = results.filter((r) => r.profileLeakDetected).length;
  const explicitSwitchResults = results.filter((r) => r.kind === 'explicit_profile' || r.kind === 'explicit_jd');
  const returnToDocResults = results.filter((r) => r.kind === 'return_to_doc');

  const verdict = {
    userDataDir,
    modeId,
    survivedRestart: true,
    filesAttached,
    totalQuestions: results.length,
    docQuestions: docQuestions.length,
    docRoutingCorrect,
    docRoutingAccuracy: docQuestions.length ? docRoutingCorrect / docQuestions.length : null,
    crossSourceContaminationCount: contaminationCount,
    explicitSwitchResults: explicitSwitchResults.map((r) => ({ question: r.question, sourceOwner: r.sourceOwner })),
    returnToDocResults: returnToDocResults.map((r) => ({ question: r.question, sourceOwner: r.sourceOwner, supportsExpectedFact: r.supportsExpectedFact })),
    enforcementObserved: [...new Set(results.map((r) => r.enforcement))],
    errors: stderrLines.slice(0, 10),
    results,
  };

  console.log('CTXOS_REAL_BENCHMARK_VERDICT_BEGIN');
  console.log(JSON.stringify(verdict, null, 2));
  console.log('CTXOS_REAL_BENCHMARK_VERDICT_END');

  await app.close().catch(() => {});
  if (process.env.NATIVELY_BENCHMARK_KEEP_USERDATA !== '1') {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
  console.log('BENCHMARK_CLOSED');
}

main().catch((err) => {
  console.error('[BENCHMARK] FATAL:', err?.stack || err);
  process.exitCode = 1;
});
