// Context OS — REAL Electron E2E contamination probe (independent verification).
//
// Launches the real Electron main process, creates a document-grounded custom
// mode, uploads the adversarial thesis fixture (four DOC phases; controller =
// Jetson), sets a candidate profile via the profile fixture path if available,
// then asks the seminar "four phases" + "controller" questions through the REAL
// WTA answer path (__e2e__:ask → runWhatShouldISay, a Context OS-wired surface).
//
// It captures BOTH:
//   (1) the visible answer text, and
//   (2) the [CONTEXT-OS] stdout trace emitted under NATIVELY_INTELLIGENCE_TRACE=1
// and prints a machine-checkable JSON verdict block the caller greps.
//
// This is an INJECTED-TRANSCRIPT integration E2E (the question enters via the
// real STT-equivalent transcript injection, not a live mic), driving the real
// main/preload/IPC/provider path.

import { _electron as electron } from '@playwright/test';

const THESIS = `Title: Towards Connected Intelligence: Empowering Robotic Applications with Agentic AI Frameworks

The project described in this document is AgenticVLA for the Mercury X1 humanoid.

The work consists of four main phases:
1. Data preparation
2. Model fine-tuning
3. Agent integration
4. Evaluation and deployment

The robot uses an NVIDIA Jetson Orin Nano as its onboard compute controller.

The model is trained using the Mercury X1 demonstration dataset containing 8,400 trajectories.

Training required approximately 36 GPU-hours.

The system was evaluated on task-completion success rate.

This work was conducted in collaboration with Huawei Munich Research Center.

The document does not identify a funding organization or funding grant.`;

const env = {
  ...process.env,
  NATIVELY_E2E: '1',
  NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  // Force Context OS ON + trace so we can observe the contract decision.
  NATIVELY_CONTEXT_OS: '1',
  NATIVELY_CONTEXT_OS_WTA: '1',
  NATIVELY_CONTEXT_OS_MANUAL_CHAT: '1',
  NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION: '1',
  NATIVELY_INTELLIGENCE_TRACE: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
};

const ctxosTraces = [];
const stderrLines = [];

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
const capture = (d) => {
  const s = d.toString();
  for (const line of s.split('\n')) {
    const idx = line.indexOf('[CONTEXT-OS] ');
    if (idx !== -1) {
      const jsonStr = line.slice(idx + '[CONTEXT-OS] '.length).trim();
      try { ctxosTraces.push(JSON.parse(jsonStr)); } catch { /* partial line */ }
    }
    if (/Error|crash|FATAL|uncaught|leak/i.test(line)) stderrLines.push(line.trim().slice(0, 160));
  }
};
app.process().stdout.on('data', capture);
app.process().stderr.on('data', capture);

await app.firstWindow({ timeout: 30000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
// Re-acquire the window each call + retry: the renderer may navigate (a failed
// settings-window load destroys the execution context) and a held reference goes stale.
const RAW = async (fn, arg) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const w = app.windows()[0] || await app.firstWindow();
      await w.waitForLoadState('domcontentloaded').catch(() => {});
      return await w.evaluate(fn, arg);
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

// Enable pro (reference files/profile are pro-gated in some builds).
await R('__e2e__:enable-pro').catch(() => {});

// Create a DOCUMENT-GROUNDED custom mode: the custom context must trip
// detectCustomModeDocumentGrounding (source noun + strict constraint).
const modeId = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'Seminar Verif', templateType: 'custom' });
  await api.modesUpdate(c.mode.id, {
    customContext: 'Answer ONLY from the uploaded seminar document I provided. Stick strictly to the material in the reference file. Do not use outside knowledge or my resume.',
  });
  await api.modesSetActive(c.mode.id);
  return c.mode.id;
});

const up = await R('__e2e__:add-reference-file', { modeId, fileName: 'thesis.pdf', content: THESIS, pageCount: 12 });
await R('__e2e__:prewarm-mode', modeId).catch(() => {});

const ask = async (q) => {
  ctxosTraces.length = 0; // isolate traces per question
  const ans = await R('__e2e__:ask', { question: q, timeoutMs: 45000 });
  return { answer: (ans?.answer || ans?.streamedTokens || ''), success: ans?.success, traces: [...ctxosTraces] };
};

const phases = await ask('What are the four main phases of the project?');
const controller = await ask('What controller does the system use?');
const funding = await ask('Who funded the research?');

const verdict = {
  upload_ok: up?.success === true,
  mode_id: modeId,
  phases: {
    answer_preview: phases.answer.slice(0, 400),
    mentions_doc_phases: /data prep|fine.?tun|agent integration|evaluation/i.test(phases.answer),
    leaks_profile_milestones: /prototype.*beta.*production|natively/i.test(phases.answer),
    trace_source_owner: phases.traces.map((t) => t.sourceOwner),
    trace_used_sources: phases.traces.map((t) => t.usedSources),
    trace_forbidden: phases.traces[0]?.forbiddenSources || [],
  },
  controller: {
    answer_preview: controller.answer.slice(0, 300),
    says_jetson: /jetson|orin/i.test(controller.answer),
    says_esp32: /esp32/i.test(controller.answer),
    trace_property: controller.traces.map((t) => t.requestedProperty),
    trace_source_owner: controller.traces.map((t) => t.sourceOwner),
  },
  funding: {
    answer_preview: funding.answer.slice(0, 300),
    claims_huawei_funded: /huawei.{0,30}fund|fund.{0,30}huawei/i.test(funding.answer),
    says_not_identified: /not (directly )?(mention|identif|specif|state)|does not (identify|mention)|no funding/i.test(funding.answer),
    trace_property: funding.traces.map((t) => t.requestedProperty),
  },
  errors: stderrLines.slice(0, 5),
};

console.log('CTXOS_VERDICT_BEGIN');
console.log(JSON.stringify(verdict, null, 2));
console.log('CTXOS_VERDICT_END');

await app.close().catch(() => {});
console.log('CLOSED');
