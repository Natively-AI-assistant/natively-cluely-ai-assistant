// electron/llm/sdRequirementsLive.ts
//
// Live-path orchestration for the SD Requirements grilling gate.
// Pure helpers: problem-key normalize, interviewer transcript → slot fill,
// problem-class escalate, advance/soft-refuse, and stamp answerPlan.sdPhase
// from the SessionTracker working-copy artifact. IntelligenceEngine calls
// prepareSdRequirementsForAnswerPlan after planAnswer on system_design turns.

import type { AnswerPlan } from './AnswerPlanner';
import {
  type RequirementsArtifact,
  type ProblemClass,
  type SlotId,
  type SdPhase,
  createEmptyRequirementsArtifact,
  resetArtifactForNewSdProblem,
  setProblemClass,
  fillSlotFromInterviewer,
  softRefuseIfPrematureAdvance,
  deriveSdPhase,
  isDataFlowRequired,
  nextEligibleSlots,
  clarifierBudgetFor,
  markSlotAsked,
} from './sdRequirementsGate';

/** Slot extractors: interviewer-attributed text → checklist fills (consume-only). */
export const SLOT_EXTRACTORS: Array<{ id: SlotId; re: RegExp; alt?: RegExp }> = [
  {
    id: 'functional_requirements',
    re: /\b(?:functional(?:\s*requirements?)?\s*[:\-–]?\s*)((?:create|shorten|ingest|produce|redirect)[^.]{0,120})/i,
    alt: /\b((?:create\s+short\s+links?\s+and\s+redirect|ingest\s+clicks?\s+and\s+produce\s+dashboards?)[^.]*)/i,
  },
  {
    id: 'scale_qps',
    re: /\b(?:scale|qps|throughput|events?\/sec)[^.\d]{0,40}(\d[\d,]*(?:\s*[kKmM])?(?:\s*(?:QPS|qps|events?\/sec))?)/i,
    // Whiteboard / screen: bare "100k QPS"
    alt: /\b(\d[\d,]*(?:\s*[kKmM])?\s*(?:QPS|qps|events?\/sec))\b/,
  },
  {
    id: 'latency',
    re: /\b(?:latency|p99)[^.\d]{0,40}((?:under\s+)?\d[\d.]*(?:\s*ms|\s*s(?:ec(?:onds?)?)?)?(?:\s*p99)?)/i,
    // Whiteboard / screen: "p99 < 200ms"
    alt: /\bp99\s*[<≤]\s*(\d[\d.]*(?:\s*ms)?)/i,
  },
  {
    id: 'consistency_availability',
    re: /\b((?:prefer\s+)?(?:availability|consistency)(?:\s+over\s+(?:strong\s+)?(?:consistency|availability))?)/i,
  },
  {
    id: 'durability',
    re: /\b(durability[^.]{0,80}|(?:no\s+)?data\s+loss[^.]{0,40})/i,
  },
  {
    id: 'read_write_ratio',
    re: /\b((?:read|write)[\s\/:-]*(?:heavy|write|read)?[^.]{0,40}\d+\s*:\s*\d+)/i,
  },
  {
    id: 'data_flow_stages',
    re: /\b(?:data\s*flow\s*stages?\s*[:\-–]?\s*)([^.]{10,200})/i,
  },
];

/**
 * Build a screen_context evidence blob from existing ScreenContext /
 * vision understanding fields (SPEC 04 — no new sensors).
 */
export function screenEvidenceText(screen: {
  ocrText?: string | null;
  extractedText?: string | null;
  visibleSummary?: string | null;
} | null | undefined): string {
  if (!screen) return '';
  return [screen.extractedText, screen.visibleSummary, screen.ocrText]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('\n');
}

const PIPELINE_SIGNAL_RE =
  /\b(?:data\s+pipeline|stream(?:ing)?\s+analytics|event\s+stream|kafka|flink|spark\s+streaming|clickstream|ingest\s+(?:and\s+)?(?:aggregate|process)|real[-\s]?time\s+analytics|etl\s+pipeline)\b/i;

export function normalizeSdProblemKey(question: string): string {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** Default CRUD; escalate only on clear pipeline/streaming language. */
export function detectProblemClassFromText(
  text: string,
  current: ProblemClass = 'crud_product',
): ProblemClass {
  if (PIPELINE_SIGNAL_RE.test(String(text || ''))) {
    return 'data_pipeline_streaming_analytics';
  }
  return current;
}

export function fillArtifactFromInterviewerText(
  artifact: RequirementsArtifact,
  interviewerBlob: string,
): { artifact: RequirementsArtifact; fills: Array<{ id: SlotId; value: string }> } {
  let next = artifact;
  const fills: Array<{ id: SlotId; value: string }> = [];
  const blob = String(interviewerBlob || '');
  for (const ex of SLOT_EXTRACTORS) {
    if (next.slots[ex.id]?.filled) continue;
    if (ex.id === 'data_flow_stages' && !isDataFlowRequired(next)) continue;
    let m = ex.re.exec(blob);
    if (!m && ex.alt) m = ex.alt.exec(blob);
    if (m && m[1] && String(m[1]).trim()) {
      const value = String(m[1]).trim();
      next = fillSlotFromInterviewer(next, ex.id, value);
      fills.push({ id: ex.id, value });
    }
  }
  return { artifact: next, fills };
}

export interface PrepareSdRequirementsInput {
  answerPlan: AnswerPlan;
  artifact: RequirementsArtifact | null;
  /** SD problem statement / latest interviewer question used as problem key. */
  problemQuestion: string;
  /** Interviewer-attributed transcript texts (Context OS consume-only). */
  interviewerTexts: string[];
  /**
   * Optional screen_context evidence (OCR / vision extract). Used only to fill
   * slots still empty after interviewer transcript (SPEC 04).
   */
  screenTexts?: string[];
  /** Recent candidate (mic) utterances for advance detection. */
  candidateTexts?: string[];
  /**
   * Sim-only (SPEC 13): SUT / assistant speech used to fill remaining checklist
   * slots after interviewer + screen. Product path leaves this unset.
   */
  candidateFillTexts?: string[];
  /** Optional Natively (assistant) spoken advance channel. */
  assistantAdvanceTexts?: string[];
  /**
   * Overlay Advance button (ticket 17). Candidate-equivalent; runs soft-refuse /
   * accept via the `ui` channel without requiring an advance phrase.
   */
  uiAdvance?: boolean;
}

export interface PrepareSdRequirementsResult {
  answerPlan: AnswerPlan;
  /** Updated working copy when answerType is system_design_answer; else prior artifact. */
  artifact: RequirementsArtifact | null;
  softRefuseSpoken: string | null;
  sdPhase: SdPhase | undefined;
  fills: Array<{ id: SlotId; value: string }>;
}

/**
 * Live prepare step after planAnswer: reset on new SD problem, fill from
 * interviewer transcript, handle advance/soft-refuse, stamp sdPhase so
 * WhatToAnswerLLM's Requirements gate is active in production interviews.
 */
export function prepareSdRequirementsForAnswerPlan(
  input: PrepareSdRequirementsInput,
): PrepareSdRequirementsResult {
  const { answerPlan } = input;
  if (answerPlan.answerType !== 'system_design_answer') {
    return {
      answerPlan,
      artifact: input.artifact,
      softRefuseSpoken: null,
      sdPhase: undefined,
      fills: [],
    };
  }

  const problemKey = normalizeSdProblemKey(input.problemQuestion);
  let artifact =
    input.artifact ?? createEmptyRequirementsArtifact(problemKey || null, 'crud_product');

  if (problemKey) {
    artifact = resetArtifactForNewSdProblem(artifact, problemKey);
  }

  const interviewerBlob = (input.interviewerTexts || []).filter(Boolean).join('\n');
  const screenBlob = (input.screenTexts || []).filter(Boolean).join('\n');
  const classBlob = `${input.problemQuestion}\n${interviewerBlob}\n${screenBlob}`;
  // Do not reclassify after gate close (SPEC 08).
  if (!artifact.gateClosed) {
    const nextClass = detectProblemClassFromText(classBlob, artifact.problemClass);
    if (nextClass !== artifact.problemClass) {
      artifact = setProblemClass(artifact, nextClass);
    }
  }

  // Interviewer transcript is authoritative; screen fills only remaining slots.
  const filledSpeech = fillArtifactFromInterviewerText(artifact, interviewerBlob);
  artifact = filledSpeech.artifact;
  const fills = [...filledSpeech.fills];
  if (screenBlob.trim()) {
    const filledScreen = fillArtifactFromInterviewerText(artifact, screenBlob);
    artifact = filledScreen.artifact;
    for (const f of filledScreen.fills) {
      fills.push({ ...f });
    }
  }
  // Sim-gated candidate fill (SPEC 13): after interviewer/screen, fill remaining
  // slots from recent SUT answers when the caller opts in.
  const candidateFillBlob = (input.candidateFillTexts || []).filter(Boolean).join('\n');
  if (candidateFillBlob.trim()) {
    const filledCandidate = fillArtifactFromInterviewerText(artifact, candidateFillBlob);
    artifact = filledCandidate.artifact;
    for (const f of filledCandidate.fills) {
      fills.push({ ...f });
    }
  }

  let softRefuseSpoken: string | null = null;

  const tryAdvance = (text: string, channel: 'mic' | 'assistant' | 'ui') => {
    if (softRefuseSpoken || artifact.gateClosed) return;
    const result = softRefuseIfPrematureAdvance(artifact, text, channel);
    artifact = result.artifact;
    if (result.refused) {
      softRefuseSpoken = result.spoken;
    }
  };

  // Only the latest candidate utterance — older "let's move on" in the
  // context window must not soft-refuse a later clarifier turn.
  const latestCandidate = (input.candidateTexts || []).filter(Boolean).slice(-1);
  for (const t of latestCandidate) {
    tryAdvance(String(t || ''), 'mic');
  }
  const latestAssistant = (input.assistantAdvanceTexts || []).filter(Boolean).slice(-1);
  for (const t of latestAssistant) {
    tryAdvance(String(t || ''), 'assistant');
  }
  if (input.uiAdvance) {
    tryAdvance('ui-advance', 'ui');
  }

  const sdPhase = deriveSdPhase(artifact);

  // Grill pacing (SPEC 05): next slot(s) + clarifier budget for this turn.
  const latestInterviewer = [...(input.interviewerTexts || [])].filter(Boolean).slice(-1)[0] || '';
  const clarifierBudget = sdPhase === 'requirements' ? clarifierBudgetFor(latestInterviewer) : 1;
  const nextSlots =
    sdPhase === 'requirements'
      ? nextEligibleSlots(artifact, { limit: clarifierBudget, pursueOptionals: false })
      : [];
  if (sdPhase === 'requirements' && nextSlots[0]) {
    artifact = markSlotAsked(artifact, nextSlots[0]);
  }

  return {
    answerPlan: {
      ...answerPlan,
      sdPhase,
      sdGrill:
        sdPhase === 'requirements'
          ? { nextSlots, clarifierBudget }
          : undefined,
    },
    artifact,
    softRefuseSpoken,
    sdPhase,
    fills,
  };
}

/**
 * Sim-only (SPEC 14): when T2 pins sdProblemKey and the gate is closed, append a
 * soft instruction so WTA does not restate Requirements mid deep-dive.
 * Product path (no sdProblemKey) is identity.
 */
export const SD_SIM_POST_REQUIREMENTS_NUDGE = [
  'Requirements for this problem are already locked.',
  'Answer the latest interviewer clarifier only; do NOT restart Requirements,',
  'paste a Requirements Draft, or re-list Functional/Non-Functional Requirements.',
  'Continue forward through Core Entities → API → HLD → Deep Dives.',
].join(' ');

export function appendSimPostRequirementsNudge(
  promptInstruction: string | undefined | null,
  opts: { sdProblemKey?: string | null; sdPhase?: SdPhase | string | null },
): string | undefined {
  const pinned =
    typeof opts.sdProblemKey === 'string' && opts.sdProblemKey.trim().length > 0;
  if (!pinned || opts.sdPhase !== 'post_requirements') {
    return promptInstruction == null ? undefined : String(promptInstruction);
  }
  const base = String(promptInstruction || '').trim();
  if (base.includes('Requirements for this problem are already locked')) {
    return base || undefined;
  }
  return base ? `${base}\n${SD_SIM_POST_REQUIREMENTS_NUDGE}` : SD_SIM_POST_REQUIREMENTS_NUDGE;
}
