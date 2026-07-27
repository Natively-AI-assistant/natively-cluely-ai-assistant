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
  /\b(?:(?:let'?s|lets|let\s+us|we\s+can|shall\s+we|can\s+we)\s+(?:move\s+on|go\s+(?:to|into|ahead(?:\s+to)?)\s+(?:the\s+)?(?:entities|design|hld|high[- ]level(?:\s+design)?)|continue(?:\s+(?:to|with)\s+(?:the\s+)?(?:design|entities))?|proceed)|ready\s+to\s+(?:design|move\s+on)|i'?m\s+ready\s+to\s+(?:design|move\s+on)|moving\s+(?:past|on\s+from)\s+requirements|advance\s+(?:to|past)\s+requirements|jump\s+(?:into|to)\s+(?:the\s+)?(?:design|hld|entities|high[- ]level)|next\s+(?:up\s+)?(?:is\s+)?(?:the\s+)?(?:design|hld|high[- ]level\s+design))\b/i;

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

/** Gate-relevant slot ids in checklist priority order (optionals excluded). */
export function listGateRelevantSlotIds(artifact: RequirementsArtifact): SlotId[] {
  const ids: SlotId[] = [...MANDATORY_SLOTS];
  if (isDataFlowRequired(artifact)) ids.push('data_flow_stages');
  return ids;
}

export type GateSlotRowStatus = 'filled' | 'missing' | 'assumed';

export interface GateStatusSlotRow {
  id: SlotId;
  label: string;
  status: GateSlotRowStatus;
}

/** Overlay projection for the Requirements gate-status strip (ticket 17). */
export interface GateStatusViewModel {
  visible: boolean;
  filled: number;
  required: number;
  nextSlotLabel: string | null;
  /** Collapsed primary line, e.g. `Requirements · 3/5`. */
  progressLabel: string;
  rows: GateStatusSlotRow[];
  missingIds: SlotId[];
  /** Soft-refuse just happened — overlay should expand and highlight missing. */
  shouldAutoExpand: boolean;
  checklistComplete: boolean;
}

export interface ProjectGateStatusOptions {
  softRefused?: boolean;
}

function slotRowStatus(slot: SlotState | undefined): GateSlotRowStatus {
  if (!slot?.filled) return 'missing';
  if (slot.fillSource === 'assumption') return 'assumed';
  return 'filled';
}

/**
 * Project the durable Requirements artifact into overlay chrome fields.
 * Hidden when there is no artifact or the gate has closed (post_requirements).
 */
export function projectGateStatusViewModel(
  artifact: RequirementsArtifact | null | undefined,
  opts: ProjectGateStatusOptions = {},
): GateStatusViewModel {
  const empty: GateStatusViewModel = {
    visible: false,
    filled: 0,
    required: 0,
    nextSlotLabel: null,
    progressLabel: '',
    rows: [],
    missingIds: [],
    shouldAutoExpand: false,
    checklistComplete: false,
  };
  if (!artifact) return empty;
  if (deriveSdPhase(artifact) !== 'requirements') return empty;

  const relevant = listGateRelevantSlotIds(artifact);
  const rows: GateStatusSlotRow[] = relevant.map((id) => ({
    id,
    label: SLOT_LABELS[id],
    status: slotRowStatus(artifact.slots[id]),
  }));
  const missing = listMissingRequiredSlots(artifact);
  const filled = rows.filter((r) => r.status !== 'missing').length;
  const required = relevant.length;
  const nextSlotLabel = missing[0]?.label ?? null;

  return {
    visible: true,
    filled,
    required,
    nextSlotLabel,
    progressLabel: `Requirements · ${filled}/${required}`,
    rows,
    missingIds: missing.map((m) => m.id),
    shouldAutoExpand: Boolean(opts.softRefused),
    checklistComplete: isChecklistComplete(artifact),
  };
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

export type AdvanceChannel = 'mic' | 'assistant' | 'interviewer' | 'ui';

/** Candidate-channel advance only; interviewer speech never advances. */
export function detectAdvanceSignal(text: string, channel: AdvanceChannel): boolean {
  if (channel === 'interviewer') return false;
  // Overlay Advance button — always candidate-equivalent intent (no phrase regex).
  if (channel === 'ui') return true;
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

const SLOT_PRIORITY: SlotId[] = [
  'functional_requirements',
  'scale_qps',
  'latency',
  'consistency_availability',
  'durability',
  'read_write_ratio',
  'data_flow_stages',
];

const BATCH_INVITE_RE =
  /\b(?:ask\s+(?:your|me\s+your|all\s+(?:your|the))\s+clarifying\s+questions|what\s+do\s+you\s+need\s+from\s+me|fire\s+away\s+with\s+(?:your\s+)?questions|go\s+ahead\s+and\s+ask)\b/i;

export interface NextSlotOptions {
  /** When true, optional durability / R/W are eligible after mandatory NFRs. Default false. */
  pursueOptionals?: boolean;
  /** How many next slots to return (1 default, ≤3 on batch invite). */
  limit?: number;
}

/**
 * Pure next-slot priority helper (SPEC 05).
 * FR → scale → latency → CAP → (optionals if pursued) → data_flow_stages if class-required.
 * Skips filled slots; never picks data_flow_stages for CRUD.
 */
export function nextEligibleSlots(
  artifact: RequirementsArtifact,
  opts: NextSlotOptions = {},
): SlotId[] {
  const pursueOptionals = Boolean(opts.pursueOptionals);
  const limit = Math.max(1, Math.min(3, opts.limit ?? 1));
  const out: SlotId[] = [];
  for (const id of SLOT_PRIORITY) {
    if (out.length >= limit) break;
    const slot = artifact.slots[id];
    if (!slot || slot.filled) continue;
    if (id === 'durability' || id === 'read_write_ratio') {
      if (!pursueOptionals) continue;
    }
    if (id === 'data_flow_stages' && !isDataFlowRequired(artifact)) continue;
    out.push(id);
  }
  return out;
}

/** Batch invite detection — bias false-negative (stay one-Q) when ambiguous. */
export function detectBatchInvite(interviewerText: string): boolean {
  return BATCH_INVITE_RE.test(String(interviewerText || ''));
}

export function clarifierBudgetFor(interviewerText: string): number {
  return detectBatchInvite(interviewerText) ? 3 : 1;
}

/**
 * Count interviewer-facing clarifiers in spoken output.
 * Heuristic: sentences ending with `?` that are not pure draft/ack lines.
 */
export function countClarifierQuestions(spoken: string): number {
  const t = String(spoken || '').trim();
  if (!t) return 0;
  const parts = t.split(/(?<=[?])\s+/).map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const p of parts) {
    if (!/\?\s*$/.test(p)) continue;
    // Skip rhetorical draft narration that happens to use a question mark rarely;
    // require an interrogative aimed at gathering a requirement.
    if (/^(?:here'?s|so\s+far|got\s+it|thanks|okay|ok)\b/i.test(p)) continue;
    n += 1;
  }
  // Also count mid-paragraph `?` when split missed (single block with multiple ?).
  if (n === 0) {
    const marks = (t.match(/\?/g) || []).length;
    if (marks > 0 && !/^(?:here'?s|so\s+far)\b/i.test(t)) n = marks;
  }
  return n;
}

/**
 * Soft-enforce clarifier budget while gated: keep draft prose + first N questions.
 * post_requirements / ungated → identity.
 */
export function enforceClarifierPacing(
  text: string,
  sdPhase: SdPhase | undefined | null,
  budget: number,
): string {
  if (sdPhase !== 'requirements') return String(text || '');
  const t = String(text || '');
  const maxQ = Math.max(1, Math.min(3, budget || 1));
  if (countClarifierQuestions(t) <= maxQ) return t;

  // Keep through the Nth `?` only; drop later clarifiers (and their trailing prose).
  let seen = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '?') {
      seen += 1;
      if (seen >= maxQ) {
        return t.slice(0, i + 1).trim();
      }
    }
  }
  return t;
}

export function requirementsPhaseContractFor(
  sdPhase: SdPhase | undefined | null,
  grill?: { nextSlots?: SlotId[]; clarifierBudget?: number } | null,
): string {
  if (sdPhase !== 'requirements') return '';
  const budget = Math.max(1, Math.min(3, grill?.clarifierBudget ?? 1));
  const next = (grill?.nextSlots || []).filter(Boolean);
  const nextLabels = next.map((id) => SLOT_LABELS[id] || id);
  const nextLine =
    nextLabels.length === 0
      ? 'Checklist looks complete on required slots — confirm readiness to advance; do not invent extra mandatory clarifiers.'
      : budget === 1
        ? `Ask exactly ONE clarifying question this turn, targeting: ${nextLabels[0]}. Tie it to the problem or the interviewer's last answer — never bare checklist voice ("Next: latency?").`
        : `The interviewer invited clarifying questions — ask at most ${budget} related clarifiers this turn, in order: ${nextLabels.join(' → ')}. Keep conversational glue; no bare checklist voice.`;
  return `${REQUIREMENTS_PHASE_CONTRACT}
<requirements_grill_pacing>
${nextLine}
You may still refresh the live Requirements draft in the same turn. Draft narration does not count as a clarifier.
</requirements_grill_pacing>`;
}
