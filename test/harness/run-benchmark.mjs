// test/harness/run-benchmark.mjs
//
// Grounding-campaign Phase 2 benchmark runner. Extends the existing
// tests/context-os-real-backend/run-200q-benchmark.mjs pattern (real
// Electron, real natively-api backend forced onto MiniMax-M3, same
// __e2e__:* IPC surface) with the categories that harness doesn't cover:
// C3 (mode+resume grounding), C4 (mode+JD grounding), C6 (adversarial
// prompt-injection), C7 (race — attach-then-immediate-ask). These drive the
// live WTA/meeting-overlay path (__e2e__:ask -> handleSuggestionTrigger ->
// runWhatShouldISay) since that's the path this campaign's H3/H8 forensics
// were run against, not the manual-chat path the thesis-200q harness uses.
//
// C1/C2/C5 (verbatim/synthesis/refusal on reference documents) are already
// covered by tests/context-os-real-backend/run-200q-benchmark.mjs — this
// runner does not duplicate those. C8 (rapid-fire desync) is deliberately
// omitted per traces/forensic-report.md §6b's iteration-4 correction: the
// only E2E-reachable rapid-fire path is not exercised by any real production
// caller, so a real C8 case needs a renderer-driving harness this repo does
// not yet have.
//
// Usage:
//   bash tests/e2e-modes/ensure-backend.sh
//   node test/harness/run-benchmark.mjs
//
// Optional: CTXOS_HARNESS_CASE_IDS=C4-001,C6-001 to run a subset.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { judgeAnswer } from '../../tests/context-os-real-backend/llm-judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureDir = path.join(__dirname, 'fixtures');
const manifestPath = path.join(fixtureDir, 'manifest.json');
const requestedCaseIds = new Set((process.env.CTXOS_HARNESS_CASE_IDS || '')
  .split(',').map((value) => value.trim()).filter(Boolean));
const timeoutMs = Number(process.env.CTXOS_HARNESS_QUESTION_TIMEOUT_MS || 60_000);
const runId = process.env.CTXOS_HARNESS_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(repoRoot, 'test/harness/reports', runId);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxos-harness-'));
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normal = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const appendJsonl = (file, value) => fs.appendFileSync(file, `${JSON.stringify(value)}\n`);

const TEAM_FACTS_RACE_CONTENT = `# Q3 Product Roadmap — Nimbus Team

## Section 1: Launch Timeline
Nimbus 3.0 is targeting a public beta on September 15th, gated on the
payments-migration workstream landing first. The internal freeze is August 28th.

## Section 2: Team
The Nimbus tech lead is Priya Raman. The eng manager is Devon Blake.
QA lead: Sam Okafor.

## Section 3: Known Risks
The biggest risk is the Stripe webhook migration, currently at 60% complete,
owned by the payments squad (lead: Carlos Vega).

## Section 4: Database migration
The database migration deadline is October 3rd.
`;

const scoreDeterministic = (testCase, answer) => {
  const text = normal(answer);
  const rubric = testCase.rubric || {};
  const required = rubric.requiredFacts || [];
  const anyOf = rubric.anyOfFacts || [];
  const forbidden = rubric.forbiddenFacts || [];
  const refusalExpected = rubric.refusalExpected === true;
  const nonEmptyResponse = rubric.nonEmptyResponse === true;
  const hasAllRequired = required.every((fact) => text.includes(normal(fact)));
  const hasAnyOf = anyOf.length === 0 || anyOf.some((fact) => text.includes(normal(fact)));
  const hasForbidden = forbidden.some((fact) => normal(fact) && text.includes(normal(fact)));
  const isRefusal = /could not find that in the retrieved sections|not (?:directly )?(?:mentioned|stated|reported)|does not (?:state|claim|report)|no .*?(?:reported|mentioned|stated)/i.test(answer);
  // Pass logic: for refusalExpected cases, pass when the answer is a refusal
  // and doesn't include any forbidden fact. For nonEmptyResponse cases (subjective
  // or negative-knowledge questions that just need ANY substantive reply), pass when
  // the answer is non-empty and not just a meta-refusal. For standard cases, pass
  // when all required/anyOf facts appear and no forbidden fact appears.
  let pass;
  if (refusalExpected) pass = isRefusal && !hasForbidden;
  else if (nonEmptyResponse) pass = !isRefusal && text.length >= 30;
  else pass = hasAllRequired && hasAnyOf && !hasForbidden;
  return { pass, hasAllRequired, hasAnyOf, hasForbidden, isRefusal, required, anyOf, forbidden };
};

const main = async () => {
  const manifest = readJson(manifestPath);
  const cases = requestedCaseIds.size > 0
    ? manifest.cases.filter((item) => requestedCaseIds.has(item.id))
    : manifest.cases;
  if (!cases.length) throw new Error('No cases matched the requested filter');

  fs.mkdirSync(outDir, { recursive: true });
  const resultsPath = path.join(outDir, 'results.jsonl');

  const launchEnv = {
    ...process.env,
    NODE_ENV: 'production', // production flag defaults — this is the config real users run under
    NATIVELY_E2E: '1',
    NATIVELY_E2E_LOCAL_TEST_TOKEN: process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN || 'local-test',
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
    NATIVELY_API_URL: process.env.NATIVELY_API_BASE || 'http://127.0.0.1:3000',
    NATIVELY_TEST_USERDATA: userDataDir,
    NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1',
    NATIVELY_INTELLIGENCE_TRACE: '1',
    OLLAMA_URL: 'http://127.0.0.1:1',
  };
  const launchArgs = ['dist-electron/electron/main.js', `--user-data-dir=${userDataDir}`];
  const app = await electron.launch({ args: launchArgs, env: launchEnv, timeout: 60_000 });
  const electronLogPath = path.join(outDir, 'electron-console.log');
  const appendElectronLog = (prefix, data) => fs.appendFileSync(electronLogPath, `[${now()}] ${prefix}${String(data)}\n`);
  app.process().stdout?.on('data', (data) => appendElectronLog('stdout ', data));
  app.process().stderr?.on('data', (data) => appendElectronLog('stderr ', data));
  await app.firstWindow({ timeout: 30_000 });

  const page = async () => app.windows()[0] || app.firstWindow({ timeout: 30_000 });
  const raw = async (callback, arg) => {
    let lastError;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const win = await page();
        if (!win) throw new Error('Electron renderer unavailable');
        await win.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
        return await win.evaluate(callback, arg);
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        const retryable = /Execution context was destroyed|most likely because of a navigation|Target page, context or browser has been closed/i.test(message);
        if (!retryable || attempt === 7) throw error;
        await sleep(750);
      }
    }
    throw lastError || new Error('Electron renderer remained unavailable after navigation retries');
  };
  const invoke = (channel, ...args) => raw(async ({ channel, args }) => {
    const api = window.electronAPI || window.api;
    return api.e2eInvoke(channel, ...args);
  }, { channel, args });

  await invoke('__e2e__:enable-pro').catch(() => {});
  const providerSet = await raw(async () => (window.electronAPI || window.api).setModel('natively'));
  if (!providerSet?.success) throw new Error(`setModel(natively) failed: ${providerSet?.error || 'unknown'}`);

  const askWta = async (question, timeoutOverrideMs) => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await invoke('__e2e__:ask', { question, timeoutMs: timeoutOverrideMs ?? timeoutMs });
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        const retryable = /Execution context was destroyed|most likely because of a navigation|Target page, context or browser has been closed/i.test(message);
        if (!retryable || attempt === 3) throw error;
        await sleep(1_500);
      }
    }
    throw lastError || new Error('WTA ask did not return a result');
  };

  let providerCalls = 0;
  for (const testCase of cases) {
    const startedAt = Date.now();
    let mode;
    let indexStatuses = null;
    try {
      mode = await raw(async ({ templateType, name }) => {
        const api = window.electronAPI || window.api;
        const created = await api.modesCreate({ name, templateType });
        return created.mode;
      }, { templateType: testCase.modeTemplateType, name: `harness-${testCase.id}` });
      await raw(async (modeId) => (window.electronAPI || window.api).modesSetActive(modeId), mode.id);

      if (Array.isArray(testCase.profileDocs) && testCase.profileDocs.length > 0) {
        for (const docKey of testCase.profileDocs) {
          const relPath = docKey === 'resume' ? manifest.profileFixture.resume : manifest.profileFixture.jd;
          const filePath = path.join(fixtureDir, relPath);
          await invoke('__e2e__:ingest-profile-doc', { filePath, docType: docKey === 'resume' ? 'resume' : 'jd' });
        }
      } else if (testCase.referenceDoc) {
        const content = fs.readFileSync(path.join(fixtureDir, 'adversarial', testCase.referenceDoc), 'utf8');
        const added = await invoke('__e2e__:add-reference-file', { modeId: mode.id, fileName: testCase.referenceDoc, content });
        if (!testCase.askImmediately) await sleep(3_000); // let indexing settle unless testing the race deliberately
        indexStatuses = await invoke('__e2e__:index-status', mode.id).catch(() => null);
        void added;
      } else if (testCase.referenceDocInline === 'team-facts-race') {
        const added = await invoke('__e2e__:add-reference-file', { modeId: mode.id, fileName: 'team-facts.md', content: TEAM_FACTS_RACE_CONTENT });
        if (!testCase.askImmediately) await sleep(3_000);
        indexStatuses = await invoke('__e2e__:index-status', mode.id).catch(() => null);
        void added;
      }

      await invoke('__e2e__:context-os-prompt-audit-clear');
      const response = await askWta(testCase.question);
      const latencyMs = Date.now() - startedAt;
      const promptAudit = await invoke('__e2e__:context-os-prompt-audit');
      const auditRecords = promptAudit?.audit || [];
      const lastAudit = auditRecords[auditRecords.length - 1] || null;
      const answerText = String(response?.answer || response?.streamedTokens || '');
      const deterministic = scoreDeterministic(testCase, answerText);

      let judge = null;
      // Only invoke the semantic judge on a deterministic near-miss that made a
      // real attempt (not a refusal, not a hard forbidden-fact hit) — mirrors
      // the existing thesis-200q harness's judge-invocation contract exactly.
      if (!deterministic.pass && !deterministic.hasForbidden && !deterministic.isRefusal
          && testCase.rubric?.requiredFacts?.length) {
        judge = await judgeAnswer(testCase.question, testCase.rubric.requiredFacts, answerText).catch((err) => ({ available: false, error: String(err?.message || err) }));
      }

      const pass = deterministic.pass || (judge?.available && judge?.allRequiredConveyed && !deterministic.hasForbidden);
      const hallucinationFlag = deterministic.hasForbidden;

      const result = {
        caseId: testCase.id,
        category: testCase.category,
        completedAt: now(),
        success: response?.success === true,
        timedOut: response?.timedOut === true,
        latencyMs,
        question: testCase.question,
        answer: answerText.slice(0, 4000),
        indexStatuses,
        deterministic,
        judge,
        pass,
        hallucinationFlag,
        promptAuditModel: lastAudit?.model,
        governedByTypedPack: lastAudit?.governedByTypedPack,
      };
      appendJsonl(resultsPath, result);
      providerCalls += 1;
      console.log(`[harness] ${testCase.id} (${testCase.category}) pass=${pass} halluc=${hallucinationFlag} ${latencyMs}ms`);
    } catch (error) {
      const result = {
        caseId: testCase.id,
        category: testCase.category,
        completedAt: now(),
        success: false,
        error: String(error?.message || error),
        pass: false,
        hallucinationFlag: false,
      };
      appendJsonl(resultsPath, result);
      console.error(`[harness] ${testCase.id} FAILED: ${result.error}`);
    }
  }

  const all = fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const byCategory = {};
  for (const item of all) {
    byCategory[item.category] ||= { total: 0, passed: 0, hallucinations: 0 };
    byCategory[item.category].total += 1;
    if (item.pass) byCategory[item.category].passed += 1;
    if (item.hallucinationFlag) byCategory[item.category].hallucinations += 1;
  }
  const summary = {
    runId,
    finishedAt: now(),
    resultCount: all.length,
    providerCalls,
    overall: { total: all.length, passed: all.filter((i) => i.pass).length },
    hallucinationFlags: all.filter((i) => i.hallucinationFlag).map((i) => i.caseId),
    falseRefusals: all.filter((i) => i.deterministic?.isRefusal && testCaseRefusalNotExpected(cases, i.caseId)).map((i) => i.caseId),
    byCategory,
  };
  writeJson(path.join(outDir, 'summary.json'), summary);

  // Markdown report
  const lines = [
    `# Grounding Harness Report — ${runId}`,
    '',
    `Overall: ${summary.overall.passed}/${summary.overall.total} passed`,
    `Hallucination flags: ${summary.hallucinationFlags.length ? summary.hallucinationFlags.join(', ') : 'none'}`,
    `False refusals: ${summary.falseRefusals.length ? summary.falseRefusals.join(', ') : 'none'}`,
    '',
    '## Per-category',
    '',
    '| Category | Passed | Total | Hallucinations |',
    '|---|---|---|---|',
    ...Object.entries(byCategory).map(([cat, s]) => `| ${cat} | ${s.passed} | ${s.total} | ${s.hallucinations} |`),
    '',
    '## Per-case detail',
    '',
    ...all.map((i) => `- **${i.caseId}** (${i.category}): pass=${i.pass} halluc=${i.hallucinationFlag} — "${i.question}" -> ${JSON.stringify((i.answer || '').slice(0, 200))}`),
  ];
  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));

  await app.close().catch(() => {});
  if (process.env.CTXOS_HARNESS_KEEP_USERDATA !== '1') fs.rmSync(userDataDir, { recursive: true, force: true });
  process.exitCode = summary.overall.passed === summary.overall.total ? 0 : 1;
  console.log(`[harness] done: ${summary.overall.passed}/${summary.overall.total} passed. Report: ${outDir}/report.md`);
};

function testCaseRefusalNotExpected(cases, caseId) {
  const testCase = cases.find((c) => c.id === caseId);
  return testCase ? testCase.rubric?.refusalExpected !== true : true;
}

main().catch((error) => {
  console.error('[harness] fatal', error?.stack || error);
  process.exitCode = 2;
});
