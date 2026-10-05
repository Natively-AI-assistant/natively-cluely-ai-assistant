// electron/intelligence/context-os/wtaGovernanceGate.ts
//
// When may the legacy Context OS evidence pack govern a What-To-Answer turn?
//
// WHY THIS IS A MODULE AND NOT AN INLINE CONDITION
// It used to be an inline condition — written out three times, in three files,
// and one copy drifted. `LLMHelper.ts:6656` has carried `!v3OwnedTurn` since it
// was written; `WhatToAnswerLLM`'s two in-file copies never had it. The cost of
// that drift was the reported live-audio bug: with a V3-composed prompt already
// in hand, the legacy pack resolved `refuse_insufficient_evidence` and
// hard-returned a canned refusal BEFORE any model call, while manual chat —
// which passes `v3Owned: true` — answered the same question normally.
//
// A condition that must agree in three places is a condition that will
// eventually disagree in three places. This is that condition, once.
//
// WHY V3 OWNERSHIP WINS
// V3 has already decided sources, scope, version and claim requirements for the
// turn and composed a prompt from that decision. The legacy pack resolves
// against reference files ONLY (EvidenceResolver.ts:326). Running both splices
// two governance layers into one turn: the model gets V3's system prompt and
// Context OS's user pack while V3's composed user prompt is discarded unread —
// and, on the refuse path, gets nothing at all. Whichever layer owns the turn
// must own all of it.
//
// See docs/retrieval-handoff/02-WTA-VS-MANUAL.md §3b.

export interface WtaGovernanceGateInput {
  /** `contextOsGeneration.govern` — the caller asked for pack governance. */
  govern: boolean;
  /** True when the frozen request snapshot carries a V3-composed prompt. */
  v3PromptPresent: boolean;
  /**
   * The mode's document-grounding switch; gates pack RESOLUTION only.
   *
   * Optional, and its absence is meaningful rather than lazy: in
   * `WhatToAnswerLLM` this value is block-scoped to the retrieval region and is
   * genuinely out of scope at the render site ~300 lines later. That is the
   * mechanical reason the render gate never tested it, and why guarding only
   * the resolver gate would have left the refusal path reachable. A caller that
   * omits it is asking only about rendering, where it is not consulted.
   */
  forceDocumentGrounding?: boolean;
  /** `contextOsEvidencePackEnabled`. */
  evidencePackFlagEnabled: boolean;
  /** `wtaGovernanceYieldsToV3` — the kill switch for this repair. */
  yieldToV3FlagEnabled: boolean;
}

export interface WtaGovernanceGateDecision {
  /**
   * Run EvidenceResolver and build a pack for this turn. Doc-grounding-gated,
   * because a non-doc-grounded turn's pack arrives pre-resolved from the caller.
   */
  resolvePack: boolean;
  /**
   * Let the pack decide the turn: the clarify and refuse short-circuits, the
   * rendered factual block, and blanking the candidate profile.
   *
   * Deliberately NOT gated on `forceDocumentGrounding`. That asymmetry is not a
   * bug and predates this module — a caller-resolved pack (the multi-family
   * coordinator) governs a non-doc-grounded turn — which is exactly why
   * guarding only `resolvePack` would have left the refusal reachable.
   */
  renderPack: boolean;
  /** True when governance was asked for and V3 ownership declined it. Log this. */
  yieldedToV3: boolean;
}

export function wtaGovernanceDecision(input: WtaGovernanceGateInput): WtaGovernanceGateDecision {
  const v3Owned = input.v3PromptPresent && input.yieldToV3FlagEnabled;
  const governing = input.govern && input.evidencePackFlagEnabled;
  return {
    resolvePack: governing && !v3Owned && Boolean(input.forceDocumentGrounding),
    renderPack: governing && !v3Owned,
    yieldedToV3: governing && v3Owned,
  };
}
