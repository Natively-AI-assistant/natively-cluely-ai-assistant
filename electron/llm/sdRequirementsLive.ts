// electron/llm/sdRequirementsLive.ts
//
// Live-path orchestration for the SD Requirements grilling gate.
// Pure helpers: problem-key normalize, interviewer transcript → slot fill,
// problem-class escalate, advance/soft-refuse, and stamp answerPlan.sdPhase
// from the SessionTracker working-copy artifact. IntelligenceEngine calls
// prepareSdRequirementsForAnswerPlan after planAnswer when SD-typed or when
// SdSessionAuthority arms the gate for clarifier/GM turns.

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
  isChecklistComplete,
  isCoreRequirementsComplete,
  isDataFlowRequired,
  nextEligibleSlots,
  clarifierBudgetFor,
  markSlotAsked,
  stripPostRequirementsRewind,
} from './sdRequirementsGate';
import { deriveSdSessionAuthority } from './sdSessionAuthority';

/** Slot extractors: interviewer-attributed text → checklist fills (consume-only). */
export const SLOT_EXTRACTORS: Array<{ id: SlotId; re: RegExp; alt?: RegExp }> = [
  {
    id: 'functional_requirements',
    re: /\b(?:functional(?:\s*requirements?)?\s*[:\-–]?\s*)((?:create|shorten|ingest|produce|redirect)[^.]{0,120})/i,
    // FULL_RAW drafts: **Functional Requirements:** then **URL Shortening:** / **Shorten:** / bare bullets
    alt: /\b((?:create\s+short\s+links?\s+and\s+redirect|ingest\s+clicks?\s+and\s+produce\s+dashboards?)[^.]*)|\*\*?Functional Requirements:?\*\*?\s*[\r\n]+([\s\S]{20,600}?)(?=\n\s*\*\*?Non-?Functional|\n\s*#{1,3}\s*Non-?Functional|\n\s*\*\*?Requirements Draft:|$)/i,
  },
  {
    id: 'scale_qps',
    re: /\b(?:scale|qps|throughput|events?\/sec)[^.\d]{0,40}(\d[\d,]*(?:\s*[kKmM])?(?:\s*(?:QPS|qps|events?\/sec))?)/i,
    // Whiteboard / screen: bare "100k QPS"; spoken: "10,000 requests per second" / "millions of requests per day"
    alt: /\b(\d[\d,]*(?:\s*[kKmM])?\s*(?:QPS|qps|RPS|rps|events?\/sec)|(?:\d[\d,]*(?:\s*[kKmM])?\s*requests?\s*per\s*sec(?:ond)?s?)|(?:millions?\s+of\s+requests?\s*per\s*day))\b/i,
  },
  {
    id: 'latency',
    re: /\b(?:latency|p99)[^.\d]{0,80}((?:under\s+|ideally\s+under\s+)?\d[\d.]*(?:\s*ms|\s*s(?:ec(?:onds?)?)?)?(?:\s*p99)?)/i,
    // Whiteboard / screen: "p99 < 200ms"; FULL_RAW NFR: "ideally under 100ms"
    alt: /\bp99\s*[<≤]\s*(\d[\d.]*(?:\s*ms)?)|\b(?:ideally\s+)?under\s+(\d+\s*ms)\b/i,
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
  /\b(?:data\s+pipeline|event\s+stream|kafka|flink|spark\s+streaming|clickstream|ingest\s+(?:and\s+)?(?:aggregate|process)|etl\s+pipeline)\b/i;


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
    const captured = m ? String(m[1] ?? m[2] ?? '').trim() : '';
    if (captured) {
      const value = captured;
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
  /**
   * Active mode templateType id (e.g. 'technical-interview'). Used by
   * SdSessionAuthority so clarifier/GM turns can arm prepare under an open session.
   */
  modeId?: string | null;
  /**
   * Sim-only (SPEC 12 / T2): when set in Technical Interview and the artifact
   * has no sticky problemKey yet, seed an empty artifact keyed to this pin so
   * shouldArmGate can open without waiting for a system_design_answer turn.
   * Product path never sets this — clarifiers alone still cannot open a session.
   */
  sdProblemKeyPin?: string | null;
}

/**
 * Sim-only: seed sticky problemKey from T2 pin when artifact has none.
 * No-op for product (no pin) and non-TI modes.
 */
export function seedSdRequirementsArtifactFromSimPin(
  artifact: RequirementsArtifact | null | undefined,
  opts: {
    sdProblemKeyPin?: string | null;
    modeId?: string | null;
  },
): RequirementsArtifact | null {
  const existing = artifact ?? null;
  if (opts.modeId !== 'technical-interview') return existing;
  const rawPin =
    typeof opts.sdProblemKeyPin === 'string' ? opts.sdProblemKeyPin.trim() : '';
  if (!rawPin) return existing;
  if (existing?.problemKey != null && String(existing.problemKey).trim()) {
    return existing;
  }
  const key = normalizeSdProblemKey(rawPin);
  if (!key) return existing;
  return createEmptyRequirementsArtifact(key, 'crud_product');
}

export interface PrepareSdRequirementsResult {
  answerPlan: AnswerPlan;
  /**
   * Updated working copy when prepare runs (SD-typed establish or authority-armed);
   * else prior artifact.
   */
  artifact: RequirementsArtifact | null;
  softRefuseSpoken: string | null;
  sdPhase: SdPhase | undefined;
  fills: Array<{ id: SlotId; value: string }>;
}

/**
 * Live prepare step after planAnswer: reset on new SD problem, fill from
 * interviewer transcript, handle advance/soft-refuse, stamp sdPhase so
 * WhatToAnswerLLM's Requirements gate is active in production interviews.
 *
 * Entry: system_design_answer (establishes sticky problemKey) OR
 * SdSessionAuthority.shouldArmGate (TI + open artifact) for clarifier/GM turns.
 * Clarifiers never open a session or re-key the sticky problem.
 * Sim pin may seed sticky identity early (sdProblemKeyPin) without SD typing.
 */
export function prepareSdRequirementsForAnswerPlan(
  input: PrepareSdRequirementsInput,
): PrepareSdRequirementsResult {
  const { answerPlan } = input;
  const isSdAnswer = answerPlan.answerType === 'system_design_answer';
  const artifactIn = seedSdRequirementsArtifactFromSimPin(input.artifact, {
    sdProblemKeyPin: input.sdProblemKeyPin,
    modeId: input.modeId,
  });
  const authority = deriveSdSessionAuthority({
    artifact: artifactIn,
    modeId: input.modeId,
  });
  if (!isSdAnswer && !authority.shouldArmGate) {
    return {
      answerPlan,
      artifact: input.artifact,
      softRefuseSpoken: null,
      sdPhase: undefined,
      fills: [],
    };
  }

  // SD-typed turns may establish / reset sticky identity from problemQuestion.
  // Authority-armed clarifiers keep the durable artifact key (never re-key).
  const problemKey = isSdAnswer
    ? normalizeSdProblemKey(input.problemQuestion)
    : (authority.problemKey || '');
  let artifact =
    artifactIn ?? createEmptyRequirementsArtifact(problemKey || null, 'crud_product');

  if (isSdAnswer && problemKey) {
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

/**
 * Product + sim (SPEC 15/16/17 + SdSessionAuthority ticket 03): strip late
 * Requirements Draft restatements from the completed WTA answer when an SD
 * session is armed and Requirements are done — either gateClosed
 * (post_requirements) OR checklist complete (advance may not have fired yet).
 * Independent of answerType (covers GM clarifier turns).
 *
 * Arms when `shouldArmGate` (TI + sticky artifact.problemKey) OR optional
 * `sdProblemKey` pin as a sim/test seed. Soft nudge remains pin-only separately.
 * Leave-TI freezes the artifact but does not strip outside TI (authority inert).
 */
export function applySimPostRequirementsAnswerStrip(
  text: string,
  opts: {
    sdProblemKey?: string | null;
    artifact?: RequirementsArtifact | null;
    /** Active mode templateType; required for product shouldArmGate path. */
    modeId?: string | null;
  } = {},
): string {
  const artifact = opts.artifact ?? null;
  const pinned =
    typeof opts.sdProblemKey === 'string' && opts.sdProblemKey.trim().length > 0;
  const authority = deriveSdSessionAuthority({
    artifact,
    modeId: opts.modeId,
  });
  // Product: TI + sticky key. Sim: pin may seed early identity before stickiness.
  if (!authority.shouldArmGate && !pinned) return String(text || '');
  if (artifact == null) return String(text || '');
  const requirementsDone =
    deriveSdPhase(artifact) === 'post_requirements' ||
    isCoreRequirementsComplete(artifact);
  if (!requirementsDone) return String(text || '');
  return stripPostRequirementsRewind(text);
}
