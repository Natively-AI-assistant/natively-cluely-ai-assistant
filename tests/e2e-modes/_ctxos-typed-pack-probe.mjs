// Context OS H1 — REAL Electron E2E: typed EvidencePack GOVERNS the manual-chat
// factual provider prompt. Drives the real gemini-chat-stream path via
// __e2e__:manual-ask with contextOsEvidencePackEnabled=1, then reads the redacted
// prompt audit to prove: <evidence_pack> present, no raw legacy factual blocks,
// factualBlockCount==1, and the answer is still correct (document-grounded).

import { _electron as electron } from '@playwright/test';

const THESIS = `The project described in this document is AgenticVLA for the Mercury X1 humanoid.
The work consists of four main phases: data preparation, model fine-tuning, agent integration, and evaluation and deployment.
The robot uses an NVIDIA Jetson Orin Nano as its onboard compute controller.
This work was conducted in collaboration with Huawei Munich Research Center.`;

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS: '1', NATIVELY_CONTEXT_OS_MANUAL_CHAT: '1',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '1',       // H1: typed pack governs
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1',         // capture redacted prompt structure
  NATIVELY_INTELLIGENCE_TRACE: '1', OLLAMA_URL: 'http://127.0.0.1:1',
};

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
await app.firstWindow({ timeout: 30000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => {
  for (let a = 0; a < 4; a++) {
    try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); }
    catch (e) { if (a === 3) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
await R('__e2e__:enable-pro').catch(() => {});

const modeId = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'TypedPack Verif', templateType: 'custom' });
  await api.modesUpdate(c.mode.id, {
    customContext: 'Answer ONLY from the uploaded seminar document. Stick strictly to the material in the reference file. Do not use outside knowledge or my resume.',
  });
  await api.modesSetActive(c.mode.id);
  return c.mode.id;
});
await R('__e2e__:add-reference-file', { modeId, fileName: 'thesis.pdf', content: THESIS, pageCount: 4 });
await R('__e2e__:prewarm-mode', modeId).catch(() => {});
await R('__e2e__:context-os-prompt-audit-clear');

const ans = await R('__e2e__:manual-ask', { question: 'What are the four main phases of the project?', timeoutMs: 45000 });
const audit = await R('__e2e__:context-os-prompt-audit');
const answer = (ans?.answer || ans?.streamedTokens || '');
// Find the audit entry for a governed manual turn.
const governed = (audit?.audit || []).filter((a) => a.governedByTypedPack);
const last = governed[governed.length - 1] || (audit?.audit || [])[audit?.audit?.length - 1] || {};

const verdict = {
  answer_preview: answer.slice(0, 200),
  answer_correct: /data prep|fine.?tun|agent integration|evaluation/i.test(answer),
  audit_entries: (audit?.audit || []).length,
  governed_entries: governed.length,
  GOVERNED: {
    governedByTypedPack: last.governedByTypedPack,
    hasTypedEvidencePack: last.hasTypedEvidencePack,
    hasTurnContract: last.hasTurnContract,
    hasEvidenceUseContract: last.hasEvidenceUseContract,
    hasRawCandidateProfile: last.hasRawCandidateProfile,
    hasRawLongTermMemory: last.hasRawLongTermMemory,
    hasRawUploadedReference: last.hasRawUploadedReference,
    factualBlockCount: last.factualBlockCount,
    model: last.model,
  },
};
console.log('CTXOS_TYPEDPACK_BEGIN');
console.log(JSON.stringify(verdict, null, 2));
console.log('CTXOS_TYPEDPACK_END');
await app.close().catch(() => {});
console.log('CLOSED');
