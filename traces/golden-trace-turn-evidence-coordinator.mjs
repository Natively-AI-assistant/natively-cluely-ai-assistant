// GOLDEN TRACE — TurnEvidenceCoordinator live-wiring verification.
//
// The coordinator (electron/intelligence/context-os/TurnEvidenceCoordinator.ts,
// wired into ipcHandlers.ts's manual-chat handler 2026-07-17) is meant to
// govern a manual-chat turn whose canonical decision requires MULTIPLE
// evidence families at once (e.g. reference_files + profile_resume) — a
// scenario the doc-grounded-only typed-pack path (H1) never covered. Unit
// tests confirm the coordinator's own logic (3/3, TurnEvidenceCoordinator
// 2026_07_16.test.mjs), but no live trace has confirmed it actually FIRES
// on a real manual-chat turn with a real résumé + a real reference file
// both loaded — this trace does exactly that.
//
// Setup: a 'general' mode with an explicit user_selected sourceContract
// (switches: ['reference_files', 'profile'], defaultOwner: 'reference_files')
// so a turn requesting BOTH the résumé fact AND a reference-file fact hits
// requiredEvidenceKinds=['reference_files','profile_resume','projects'] —
// inside coordinatorInScopeKinds (ipcHandlers.ts ~2146). A real résumé
// (test-fixtures/profiles/p02) is ingested via __e2e__:ingest-profile-doc,
// and the real thesis PDF is attached as the mode's reference file.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const inputRoot = path.join(repoRoot, 'test-fixtures/modes-corpus/thesis');
const thesisPath = path.join(inputRoot, 'institutional_thesis.pdf');
const resumePath = path.join(repoRoot, 'test-fixtures/profiles/p02/resume.pdf');

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_E2E_REFERENCE_ROOT: inputRoot,
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1',
  NATIVELY_CONTEXT_OS_BENCHMARK_AUDIT: '1',
  NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE: '1', NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '1',
  NATIVELY_CONTEXT_OS: '1', NATIVELY_CONTEXT_OS_MANUAL_CHAT: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
  NATIVELY_API_URL: 'http://localhost:3000',
};

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
app.process().stdout.on('data', (d) => {
  const s = d.toString();
  if (s.includes('[TEC-DIAG]')) process.stdout.write(s);
});
app.process().stderr.on('data', (d) => {
  const s = d.toString();
  if (s.includes('[TEC-DIAG]')) process.stderr.write(s);
});
const win0 = await app.firstWindow({ timeout: 30000 });
win0.on('crash', () => console.error('[RENDERER-CRASH] window crashed'));
win0.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[RENDERER-CONSOLE-ERROR]', msg.text());
});
await win0.waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => {
  for (let a = 0; a < 5; a++) {
    try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); }
    catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => (window.electronAPI || window.api).setModel('natively'));

// Ingest the résumé FIRST so hasProfileFacts is true by the time the mode's
// contract is built and the turn fires.
const profileIngest = await R('__e2e__:ingest-profile-doc', { filePath: resumePath, docType: 'resume' });
console.log('PROFILE_INGEST', JSON.stringify({ success: profileIngest?.success, hasStructuredResume: profileIngest?.hasStructuredResume }));
if (!profileIngest?.success) { console.error('PROFILE_INGEST_FAILED', JSON.stringify(profileIngest)); await app.close(); process.exit(1); }

const mode = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'GoldenTrace TurnEvidenceCoordinator', templateType: 'general' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

// Build + persist an EXPLICIT user_selected contract granting BOTH
// reference_files and profile — this is the multi-family scenario the
// coordinator exists for (a 'general' mode's default contract otherwise
// resolves to ask_if_ambiguous, which never reaches coordinatorInScopeKinds).
const contract = await RAW(async ({ modeId }) => {
  const api = window.electronAPI || window.api;
  return api.modesBuildUserSourceContract({
    modeId,
    templateType: 'general',
    switches: ['reference_files', 'profile'],
  });
}, { modeId: mode.id });
console.log('BUILT_CONTRACT', JSON.stringify(contract));
await RAW(async ({ id, contract }) => (window.electronAPI || window.api).modesUpdate(id, { sourceContract: contract }), { id: mode.id, contract });

const upload = await R('__e2e__:upload-reference-file-from-path', { modeId: mode.id, filePath: thesisPath });
if (!upload?.success) { console.error('UPLOAD_FAILED', JSON.stringify(upload)); await app.close(); process.exit(1); }
await R('__e2e__:reindex-embeddings', mode.id).catch(() => null);
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  const status = await R('__e2e__:index-status', mode.id).catch(() => null);
  ready = status?.statuses?.length > 0 && status.statuses.every((s) => s.status === 'ready');
  if (!ready) await new Promise((r) => setTimeout(r, 1500));
}
console.log('INDEX_READY', ready);
if (!ready) {
  await app.close();
  throw new Error('Reference index did not become ready; TurnEvidenceCoordinator trace was not evaluated.');
}

const askManual = async (question, timeoutMs = 60000) => {
  return await RAW(async ({ question, timeoutMs }) => {
    const api = window.electronAPI || window.api;
    return new Promise((resolve) => {
      let text = ''; let settled = false;
      const stop = () => { offToken?.(); offDone?.(); offError?.(); clearTimeout(timer); };
      const done = (result) => { if (settled) return; settled = true; stop(); resolve(result); };
      const offToken = api.onGeminiStreamToken((token) => { text += token; });
      const offDone = api.onGeminiStreamDone((payload) => done({ success: true, answer: payload?.finalText || text }));
      const offError = api.onGeminiStreamError((error) => done({ success: false, error: String(error), answer: text }));
      const timer = setTimeout(() => done({ success: false, timedOut: true, answer: text }), timeoutMs);
      api.streamGeminiChat(question, undefined, undefined, undefined).catch((error) => done({ success: false, error: String(error?.message || error), answer: text }));
    });
  }, { question, timeoutMs });
};

// A mixed question requiring BOTH families: a résumé fact (candidate's own
// background) AND a reference-file fact (the thesis's Mercury X1 weight).
const question = 'What is my educational background, and what is the total weight of Mercury X1 from the uploaded thesis?';
await R('__e2e__:context-os-prompt-audit-clear');
await R('__e2e__:context-os-benchmark-audit-clear').catch(() => null);
const response = await askManual(question);
console.log('ANSWER', JSON.stringify(response?.answer?.slice(0, 400)));

const audit = await R('__e2e__:context-os-prompt-audit');
const auditEntry = audit?.audit?.[audit.audit.length - 1];
console.log('PROMPT_AUDIT_LAST', JSON.stringify(auditEntry));

const benchmarkAudit = await R('__e2e__:context-os-benchmark-audit').catch(() => null);
const terminalEntry = benchmarkAudit?.records?.[benchmarkAudit.records.length - 1];
console.log('BENCHMARK_AUDIT_LAST', JSON.stringify(terminalEntry));

console.log('TEC_TRACE_BEGIN');
console.log(JSON.stringify({
  question,
  answerPreview: (response?.answer || '').slice(0, 400),
  governedByTypedPack: auditEntry?.governedByTypedPack ?? null,
  hasTypedEvidencePack: auditEntry?.hasTypedEvidencePack ?? null,
  hasRawUploadedReference: auditEntry?.hasRawUploadedReference ?? null,
  hasRawCandidateProfile: auditEntry?.hasRawCandidateProfile ?? null,
  factualBlockCount: auditEntry?.factualBlockCount ?? null,
  mentionsUTAustin: /university of texas|ut austin/i.test(response?.answer || ''),
  mentions55kg: /55\s*kg/i.test(response?.answer || ''),
}, null, 2));
console.log('TEC_TRACE_END');

await app.close();
