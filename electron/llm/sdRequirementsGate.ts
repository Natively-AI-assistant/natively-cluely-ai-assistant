// electron/llm/sdRequirementsGate.ts
//
// Minimal production seams for the SD Requirements grilling gate (Tier 0).
// Pure helpers: durable artifact + sdPhase derivation, structural Delivery
// Framework heading check, LESSON section allowlist while gated, soft-refuse,
// and checklist fill / ask-once semantics. WhatToAnswerLLM wires the phase-
// conditional LESSON filter + structural soft-truncate on system_design_answer.

export type SdPhase = 'requirements' | 'post_requirements';

export type ProblemClass = 'crud_product' | 'data_pipeline_streaming_analytics';

export type SlotId =
  | 'functional_requirements'
  | 'scale_qps'
  | 'latency'
  | 'consistency_availability'
  | 'durability'
  | 'read_write_ratio'
  | 'data_flow_stages';

export type SlotFillSource = 'interviewer' | 'assumption';

export interface SlotState {
  filled: boolean;
  askedOnce: boolean;
  fillSource?: SlotFillSource;
  value?: string;
}

export interface RequirementsArtifact {
  gateClosed: boolean;
  advanceAccepted: boolean;
  problemClass: ProblemClass;
  /** Opaque key for the current SD problem; change → reset. */
  problemKey: string | null;
  slots: Record<SlotId, SlotState>;
}

export interface MissingSlot {
  id: SlotId;
  label: string;
}

const MANDATORY_SLOTS: SlotId[] = [
  'functional_requirements',
  'scale_qps',
  'latency',
  'consistency_availability',
];

const OPTIONAL_SLOTS: SlotId[] = ['durability', 'read_write_ratio'];

const SLOT_LABELS: Record<SlotId, string> = {
  functional_requirements: 'functional requirements',
  scale_qps: 'scale / QPS',
  latency: 'latency',
  consistency_availability: 'consistency vs availability',
  durability: 'durability',
  read_write_ratio: 'read/write ratio',
  data_flow_stages: 'data-flow stages',
};

/** Delivery Framework later-section headings blocked while sdPhase=requirements.
 * Require a markdown heading marker (`#`–`###`) so bare labels inside the
 * system-design answer_contract template (e.g. `High-Level Design:`) are not
 * mistaken for spoken framework leaks.
 */
export const LATER_FRAMEWORK_HEADING_PATTERNS: RegExp[] = [
  /^#{1,3}\s*Core Entities\b/im,
  /^#{1,3}\s*Defining the Core Entities\b/im,
  /^#{1,3}\s*(?:The\s+)?API(?:\s*\/\s*Interface|\s+Design)?\b/im,
  /^#{1,3}\s*API\s*\/\s*Interface\b/im,
  /^#{1,3}\s*Data Flow\b/im,
  /^#{1,3}\s*High[- ]Level Design\b/im,
  /^#{1,3}\s*(?:Potential\s+)?Deep Dives?\b/im,
];

const LESSON_ALLOWLIST_HEADINGS = [
  'Understanding the Problem',
  'Functional Requirements',
  'Non-Functional Requirements',
];

const ADVANCE_PHRASE_RE =
  /\b(?:let'?s\s+(?:move\s+on|go\s+(?:to|into)\s+(?:entities|design|hld)|continue)|ready\s+to\s+(?:design|move\s+on)|moving\s+(?:past|on\s+from)\s+requirements|advance\s+(?:to|past)\s+requirements)\b/i;

function emptySlot(): SlotState {
  return { filled: false, askedOnce: false };
}

function defaultSlots(): Record<SlotId, SlotState> {
  const slots = {} as Record<SlotId, SlotState>;
  for (const id of [...MANDATORY_SLOTS, ...OPTIONAL_SLOTS, 'data_flow_stages' as SlotId]) {
    slots[id] = emptySlot();
  }
  return slots;
}

/** Fresh gate-open artifact for a new SD problem (or session start). */
export function createEmptyRequirementsArtifact(
  problemKey: string | null = null,
  problemClass: ProblemClass = 'crud_product',
): RequirementsArtifact {
  return {
    gateClosed: false,
    advanceAccepted: false,
    problemClass,
    problemKey,
    slots: defaultSlots(),
  };
}

/** Derive per-turn sdPhase from the durable artifact (source of truth). */
export function deriveSdPhase(artifact: RequirementsArtifact): SdPhase {
  return artifact.gateClosed && artifact.advanceAccepted
    ? 'post_requirements'
    : 'requirements';
}

/**
 * Reset on new SD problem: gate open, empty checklist, advance not seen.
 * No-ops (returns same reference) when problemKey is unchanged and non-null.
 */
export function resetArtifactForNewSdProblem(
  artifact: RequirementsArtifact,
  newProblemKey: string,
): RequirementsArtifact {
  if (artifact.problemKey != null && artifact.problemKey === newProblemKey) {
    return artifact;
  }
  return createEmptyRequirementsArtifact(newProblemKey, 'crud_product');
}

export function isDataFlowRequired(artifact: RequirementsArtifact): boolean {
  return artifact.problemClass === 'data_pipeline_streaming_analytics';
}

export function isChecklistComplete(artifact: RequirementsArtifact): boolean {
  for (const id of MANDATORY_SLOTS) {
    if (!artifact.slots[id]?.filled) return false;
  }
  if (isDataFlowRequired(artifact) && !artifact.slots.data_flow_stages?.filled) {
    return false;
  }
  return true;
}

export function listMissingRequiredSlots(artifact: RequirementsArtifact): MissingSlot[] {
  const missing: MissingSlot[] = [];
  for (const id of MANDATORY_SLOTS) {
    if (!artifact.slots[id]?.filled) {
      missing.push({ id, label: SLOT_LABELS[id] });
    }
  }
  if (isDataFlowRequired(artifact) && !artifact.slots.data_flow_stages?.filled) {
    missing.push({ id: 'data_flow_stages', label: SLOT_LABELS.data_flow_stages });
  }
  return missing;
}

/** Mark that the candidate asked once about a slot (enables assumption fill). */
export function markSlotAsked(artifact: RequirementsArtifact, slotId: SlotId): RequirementsArtifact {
  const slot = { ...artifact.slots[slotId], askedOnce: true };
  return { ...artifact, slots: { ...artifact.slots, [slotId]: slot } };
}

/** Fill from a usable interviewer answer (ask not required). */
export function fillSlotFromInterviewer(
  artifact: RequirementsArtifact,
  slotId: SlotId,
  value: string,
): RequirementsArtifact {
  const slot: SlotState = {
    ...artifact.slots[slotId],
    filled: true,
    fillSource: 'interviewer',
    value,
  };
  return { ...artifact, slots: { ...artifact.slots, [slotId]: slot } };
}

/**
 * Fill from a clear spoken assumption — only allowed after ask-once.
 * Returns unchanged artifact if the slot has not been asked yet.
 */
export function fillSlotFromAssumption(
  artifact: RequirementsArtifact,
  slotId: SlotId,
  value: string,
): RequirementsArtifact {
  const prev = artifact.slots[slotId];
  if (!prev?.askedOnce) return artifact;
  const slot: SlotState = {
    ...prev,
    filled: true,
    fillSource: 'assumption',
    value,
  };
  return { ...artifact, slots: { ...artifact.slots, [slotId]: slot } };
}

/** Interviewer contradiction clears a prior fill (ask-once preserved). */
export function clearSlotFill(artifact: RequirementsArtifact, slotId: SlotId): RequirementsArtifact {
  const prev = artifact.slots[slotId];
  const slot: SlotState = {
    filled: false,
    askedOnce: Boolean(prev?.askedOnce),
  };
  return { ...artifact, slots: { ...artifact.slots, [slotId]: slot } };
}

export function setProblemClass(
  artifact: RequirementsArtifact,
  problemClass: ProblemClass,
): RequirementsArtifact {
  return { ...artifact, problemClass };
}

/**
 * Close the gate when checklist complete AND advance accepted.
 * Either half alone leaves the gate open / sdPhase=requirements.
 */
export function acceptAdvance(artifact: RequirementsArtifact): RequirementsArtifact {
  if (!isChecklistComplete(artifact)) return artifact;
  return { ...artifact, advanceAccepted: true, gateClosed: true };
}

export type AdvanceChannel = 'mic' | 'assistant' | 'interviewer';

/** Candidate-channel advance only; interviewer speech never advances. */
export function detectAdvanceSignal(text: string, channel: AdvanceChannel): boolean {
  if (channel === 'interviewer') return false;
  const t = String(text || '').trim();
  if (!t) return false;
  return ADVANCE_PHRASE_RE.test(t);
}

/**
 * Soft-refuse premature advance: stay in Requirements, name missing slots,
 * invite next clarifier / assumption. Never emits later framework headings.
 */
export function buildSoftRefuseSpoken(missingSlots: MissingSlot[]): string {
  const names = missingSlots.map((s) => s.label);
  const named =
    names.length === 0
      ? 'a few requirements'
      : names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  const next = missingSlots[0]?.label || 'the next requirement';
  return (
    `Before we move on, we still need to pin down ${named}. ` +
    `Quick one — what's your take on ${next}, or should I state an assumption so we can keep going?`
  );
}

export function softRefuseIfPrematureAdvance(
  artifact: RequirementsArtifact,
  utterance: string,
  channel: AdvanceChannel,
): { refused: true; spoken: string; artifact: RequirementsArtifact } | { refused: false; artifact: RequirementsArtifact } {
  if (!detectAdvanceSignal(utterance, channel)) {
    return { refused: false, artifact };
  }
  if (isChecklistComplete(artifact)) {
    return { refused: false, artifact: acceptAdvance(artifact) };
  }
  const missing = listMissingRequiredSlots(artifact);
  return {
    refused: true,
    spoken: buildSoftRefuseSpoken(missing),
    artifact,
  };
}

export function hasLaterFrameworkHeadings(text: string): boolean {
  const t = String(text || '');
  return LATER_FRAMEWORK_HEADING_PATTERNS.some((re) => re.test(t));
}

/**
 * Soft-truncate spoken output to content before the first later-framework
 * heading. If the whole answer is a later section, return a minimal Requirements
 * placeholder (never ship Core Entities → Deep Dives while gated).
 */
export function softTruncateToRequirements(text: string): string {
  const t = String(text || '');
  if (!hasLaterFrameworkHeadings(t)) return t;

  let cut = t.length;
  for (const re of LATER_FRAMEWORK_HEADING_PATTERNS) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  const kept = t.slice(0, cut).trim();
  if (kept.length > 0) return kept;
  return (
    'Let me stay on Requirements for a moment — clarifying questions and the live draft only, ' +
    'then we can advance once the checklist is solid.'
  );
}

export function enforceStructuralGate(text: string, sdPhase: SdPhase | undefined | null): string {
  if (sdPhase !== 'requirements') return String(text || '');
  return softTruncateToRequirements(text);
}

function normalizeHeading(h: string): string {
  return h.replace(/^#+\s*/, '').trim().toLowerCase();
}

function isAllowlistedHeading(headingText: string): boolean {
  const n = normalizeHeading(headingText);
  return LESSON_ALLOWLIST_HEADINGS.some((a) => n === a.toLowerCase() || n.startsWith(a.toLowerCase()));
}

/**
 * Split markdown into heading-led sections. Content before any heading is
 * treated as unmarked → fail closed while gated.
 */
function sliceMarkdownSections(markdown: string): Array<{ heading: string | null; body: string }> {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections: Array<{ heading: string | null; body: string }> = [];
  let current: { heading: string | null; body: string[] } = { heading: null, body: [] };

  const flush = () => {
    const body = current.body.join('\n').trim();
    if (current.heading != null || body) {
      sections.push({ heading: current.heading, body });
    }
  };

  for (const line of lines) {
    const hm = /^(#{1,3})\s+(.+)$/.exec(line);
    if (hm) {
      flush();
      current = { heading: hm[2].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * While sdPhase=requirements, keep only Understanding / FR / NFR section bodies.
 * Unmarked chunks and non-allowlisted headings are omitted (fail closed).
 * Identity when post_requirements or phase unset.
 */
export function filterLessonChunksForPhase<T extends { text: string }>(
  chunks: T[],
  sdPhase: SdPhase | undefined | null,
): T[] {
  if (sdPhase !== 'requirements') return chunks;
  const out: T[] = [];
  for (const chunk of chunks) {
    const sections = sliceMarkdownSections(chunk.text);
    const kept: string[] = [];
    for (const sec of sections) {
      if (sec.heading == null) continue; // fail closed on unmarked
      if (isAllowlistedHeading(sec.heading)) {
        kept.push(`## ${sec.heading}\n${sec.body}`.trim());
      }
    }
    if (kept.length > 0) {
      out.push({ ...chunk, text: kept.join('\n\n') });
    }
  }
  return out;
}

/** Phase prompt contract appended while gated (clarifiers + Requirements draft only). */
export const REQUIREMENTS_PHASE_CONTRACT = `<requirements_phase_contract>
The Requirements grilling gate is OPEN. Speak clarifying questions and a live Requirements draft only.
Do not emit Core Entities, API / Interface, Data Flow, High-Level Design, or Deep Dives sections (or equivalents).
If LESSON / reference_file material is present, use it only to choose clarifiers and FR/NFR draft wording — not architecture, APIs, or deep dives.
</requirements_phase_contract>`;

export function requirementsPhaseContractFor(sdPhase: SdPhase | undefined | null): string {
  return sdPhase === 'requirements' ? REQUIREMENTS_PHASE_CONTRACT : '';
}
