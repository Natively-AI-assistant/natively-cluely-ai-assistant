// electron/llm/answerPathWarmup.ts
//
// The first question of a meeting paid for every regex, classifier and module
// on the answer path being compiled for the first time, synchronously, on the
// main thread, between the judge and the first token (pipeline forensics
// 2026-11-13, F-LAT-01 / F-LAT-02). Measured on the document-mode replay:
// resolveDiagramTurn 665 ms, instruction analysis 261 ms, file shape 164 ms,
// the date notice 96-159 ms. Warm, each of those costs well under a
// millisecond (resolveDiagramRequest: 147 ms cold, 0.3 ms warm).
//
// So the work is done once per process, when a meeting starts, in small timer
// slices well before anyone has asked anything. The same pure functions run on
// harmless synthetic text: nothing here reads or sends user data, and nothing
// changes state (a diagram turn is resolved as a speculative one).

export type WarmStep = { name: string; run: () => unknown };
export type Scheduler = (fn: () => void, ms: number) => unknown;

const SAMPLE_INSTRUCTIONS = 'Answer in two short paragraphs. Use Python for any code. Be concise and lead with the answer.';
const SAMPLE_RESUME = 'Jordan Lee\nExperience\nSenior Engineer, Acme 2019-2024\nEducation\nBSc Computer Science\nSkills\nGo, Python, Kubernetes';

/** The answer-path pieces that are slow only on their first call. Each step is independent and never throws. */
export function defaultWarmSteps(): WarmStep[] {
  return [
    {
      name: 'diagram_request',
      run: () => {
        const dr = require('../../src/lib/diagram/diagramRequest.mjs') as typeof import('../../src/lib/diagram/diagramRequest.mjs');
        for (const question of [
          'Can you walk me through how the payment service handles retries?',
          'Draw the architecture for a URL shortener with a cache.',
          'Can you chart the revenue forecast for next year?',
        ]) {
          dr.resolveDiagramRequest({ question, answerType: 'general_answer', activeDesign: null, featureEnabled: true, userInstructions: SAMPLE_INSTRUCTIONS, material: '' });
        }
      },
    },
    {
      name: 'instruction_analysis',
      run: () => {
        const { classifyCustomContext } = require('./customContextClassifier') as typeof import('./customContextClassifier');
        classifyCustomContext(`${SAMPLE_INSTRUCTIONS}\n\nI work on the platform team.`);
      },
    },
    {
      name: 'doc_shape',
      run: () => {
        const { sourceTypeForFile } = require('../context-intelligence/retrieval/mode-retrieval-port') as typeof import('../context-intelligence/retrieval/mode-retrieval-port');
        sourceTypeForFile('notes.md', SAMPLE_RESUME, ['REFERENCE_FILE']);
      },
    },
    {
      name: 'today_notice',
      run: () => {
        const { todayNotice } = require('../context-intelligence/generation/prompt-composer') as typeof import('../context-intelligence/generation/prompt-composer');
        todayNotice(new Date(), 'The price sheet is valid through December 31, 2025.');
      },
    },
  ];
}

let warmed = false;

/**
 * Run each step once per process, one per timer slice, so no single slice
 * holds the main thread for long. Returns false when already scheduled.
 */
export function scheduleAnswerPathWarmup(opts: { steps?: WarmStep[]; schedule?: Scheduler; delayMs?: number; gapMs?: number } = {}): boolean {
  if (warmed) return false;
  warmed = true;
  const steps = opts.steps ?? defaultWarmSteps();
  const schedule: Scheduler = opts.schedule ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    (t as { unref?: () => void }).unref?.();
    return t;
  });
  const gap = opts.gapMs ?? 40;
  const runFrom = (i: number) => {
    if (i >= steps.length) return;
    try { steps[i].run(); } catch { /* warming is best-effort; the real call still works cold */ }
    schedule(() => runFrom(i + 1), gap);
  };
  schedule(() => runFrom(0), opts.delayMs ?? 1500);
  return true;
}

/** Test seam: forget that the warm-up ran. */
export function resetAnswerPathWarmupForTests(): void {
  warmed = false;
}
