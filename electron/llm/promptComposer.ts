// electron/llm/promptComposer.ts
//
// Phase 6 Slice 2 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 2 — Clean prompt composition"; design: 04_TARGET_ARCHITECTURE.md §6a):
// the one assembly point for a manual-chat/WTA prompt, replacing the ad hoc
// `` CONTEXT:\n${context}\n\nUSER QUESTION:\n${message} `` concatenation
// scattered across LLMHelper.ts and the manual-chat repair site's inline
// `repairPrompt` construction in ipcHandlers.ts.
//
// DEVIATION FROM §6a's LITERAL SIGNATURE, documented here (also in
// 05_MIGRATION_PLAN.md's Slice 2 STATUS note): §6a's interface takes a
// `CanonicalTurn` as its first parameter. `CanonicalTurn` does not carry a
// `turnId` yet and is not wired into manual chat until Slice 3 — and Slice 2
// is deliberately scheduled BEFORE Slice 3 (the history-grant defect must
// close first). Blocking composePrompt() on Slice 3 landing would invert
// the plan's own sequencing. This module therefore takes the specific
// pieces composePrompt() actually needs (question text, EvidencePack,
// HistoryGrant, mode persona, the rolling transcript snapshot) as explicit
// parameters — every one of which is already real and available at today's
// call sites — instead of requiring a CanonicalTurn wrapper object that
// doesn't fully exist yet. When Slice 3 lands, real call sites can pass
// `canonicalTurn.question`/`canonicalTurn.turnId` etc. through the same
// fields; no shape change to this module should be needed.
//
// RC1 (docs/context-rebuild/03_ROOT_CAUSES.md): the Phase 0 benchmark found
// 12/12 turns with `evidenceCoverage.confidence===0, evidenceRequired:true`
// still proceeding to generation with a hardcoded `finalAction:'answer'`.
// composePrompt() reads `pack.answerPolicy` BEFORE assembling anything and
// short-circuits generation entirely (no provider call) for
// `refuse_insufficient_evidence`/`ask_clarification` — this is the literal
// fix, named explicitly.
//
// RC4 (docs/context-rebuild/03_ROOT_CAUSES.md): validation-instruction/
// answer-shape text belongs in the system channel ONLY. There is no code
// path in this module that appends an instruction/repair string to
// `userChannel` — the structural fix, not a per-call-site guard.

import type { EvidencePack, EvidenceItem } from '../intelligence/context-os/evidencePack';
import type { HistoryGrant } from './conversationHistoryPolicy';
import { applyHistoryGrant } from './conversationHistoryPolicy';

export interface PromptSizeBreakdown {
  systemChars: number;
  evidenceChars: number;
  historyChars: number;
  questionChars: number;
  totalChars: number;
}

/**
 * The deterministic, typed response composePrompt() returns instead of
 * calling a provider, for the two answerPolicy values that mean "do not
 * generate" (RC1). `shortCircuit` is present ONLY in this case; `systemChannel`/
 * `userChannel` are empty strings for a short-circuited turn (nothing was
 * assembled, since nothing will be sent to a provider).
 */
export interface PromptShortCircuit {
  policy: 'refuse_insufficient_evidence' | 'ask_clarification';
  /** Deterministic, typed text for this policy — never provider-generated. */
  text: string;
}

export interface ComposedPrompt {
  systemChannel: string;
  userChannel: string;
  sizeBreakdown: PromptSizeBreakdown;
  /** EvidenceItem ids dropped to respect the size cap, lowest-score-first. */
  truncated: readonly string[];
  /** Present only when answerPolicy short-circuited generation (RC1). */
  shortCircuit?: PromptShortCircuit;
}

export interface ComposePromptInput {
  /** The live question — always rendered last, its own delimited segment. */
  question: string;
  /** Stable system prompt text (persona/mode instructions), rendered once. */
  systemPromptBase: string;
  /** Mode persona / real-time prompt text, if any — appended to the system channel once. */
  modePersona?: string;
  pack: EvidencePack;
  historyGrant: HistoryGrant;
  /** The rolling transcript snapshot BEFORE history-grant filtering — composePrompt applies the grant itself. */
  historySnapshotRaw?: string;
  /**
   * Validation-instruction / repair text (e.g. `<rewrite_instructions>` blocks).
   * Rendered into the SYSTEM channel only (RC4) — never concatenated into
   * userChannel, structurally, by this function.
   */
  systemInstructions?: string;
  /** Hard cap on total evidence chars; lowest-score items are dropped first when exceeded. */
  evidenceCharCap?: number;
}

const DEFAULT_EVIDENCE_CHAR_CAP = 6000;

const REFUSE_INSUFFICIENT_EVIDENCE_TEXT =
  "I don't have enough information in the available context to answer that confidently.";
const ASK_CLARIFICATION_TEXT =
  'Could you clarify what you mean, or point me to the specific source you want me to use?';

function renderEvidenceItem(item: EvidenceItem): string {
  const tag = item.authority === 'evidence'
    ? 'EVIDENCE'
    : item.authority === 'referent_only'
      ? 'REFERENT-ONLY (context, not a fact source)'
      : 'NON-AUTHORITATIVE';
  return `[${tag} | ${item.sourceKind}] ${item.text}`;
}

/**
 * Sort ascending by score.final (lowest first) — the order truncation drops
 * items in when the evidence char cap is exceeded.
 */
function byScoreAscending(a: EvidenceItem, b: EvidenceItem): number {
  return a.score.final - b.score.final;
}

/**
 * The one assembly point for a manual-chat/WTA prompt. See this module's
 * header comment for the RC1/RC3/RC4 fixes this function is the named
 * consumer of.
 */
export function composePrompt(input: ComposePromptInput): ComposedPrompt {
  const { pack } = input;

  // RC1: check answerPolicy FIRST, before assembling anything. No provider
  // call for these two policies — a deterministic, typed response instead.
  if (pack.answerPolicy === 'refuse_insufficient_evidence' || pack.answerPolicy === 'ask_clarification') {
    const text = pack.answerPolicy === 'refuse_insufficient_evidence'
      ? REFUSE_INSUFFICIENT_EVIDENCE_TEXT
      : ASK_CLARIFICATION_TEXT;
    return {
      systemChannel: '',
      userChannel: '',
      sizeBreakdown: { systemChars: 0, evidenceChars: 0, historyChars: 0, questionChars: 0, totalChars: 0 },
      truncated: [],
      shortCircuit: { policy: pack.answerPolicy, text },
    };
  }

  // ── System channel: stable system prompt + mode persona, exactly once. ──
  // RC4: systemInstructions (repair/validation text) is appended HERE, in
  // the system channel — there is no branch below that puts it in
  // userChannel.
  const systemParts = [input.systemPromptBase];
  if (input.modePersona) systemParts.push(input.modePersona);
  if (input.systemInstructions) systemParts.push(input.systemInstructions);
  const systemChannel = systemParts.filter(Boolean).join('\n\n');

  // ── User channel, in the fixed order §6a specifies. ──────────────────────
  const cap = input.evidenceCharCap ?? DEFAULT_EVIDENCE_CHAR_CAP;
  const sortedByScore = [...pack.items].sort(byScoreAscending);
  const truncated: string[] = [];
  const kept: EvidenceItem[] = [...pack.items];
  let evidenceChars = kept.reduce((sum, i) => sum + i.text.length, 0);
  // Drop lowest-score items first until under the cap (or nothing left).
  let dropIdx = 0;
  while (evidenceChars > cap && dropIdx < sortedByScore.length) {
    const victim = sortedByScore[dropIdx];
    const keptIdx = kept.findIndex((i) => i.evidenceId === victim.evidenceId);
    if (keptIdx >= 0) {
      kept.splice(keptIdx, 1);
      truncated.push(victim.evidenceId);
      evidenceChars -= victim.text.length;
    }
    dropIdx += 1;
  }

  const evidenceBlock = kept.length > 0 ? kept.map(renderEvidenceItem).join('\n\n') : '';

  const historySnapshot = input.historySnapshotRaw
    ? applyHistoryGrant(input.historySnapshotRaw, input.historyGrant)
    : '';
  const historyBlock = historySnapshot.trim().length > 0
    ? `[PRIOR CONVERSATION — for pronoun resolution only, not a source of facts]\n${historySnapshot}`
    : '';

  const userParts: string[] = [];
  if (evidenceBlock) userParts.push(evidenceBlock);
  if (historyBlock) userParts.push(historyBlock);
  // The live question is ALWAYS last, always its own delimited segment —
  // never string-concatenated with the history block it follows.
  userParts.push(`[QUESTION]\n${input.question}`);
  const userChannel = userParts.join('\n\n');

  const sizeBreakdown: PromptSizeBreakdown = {
    systemChars: systemChannel.length,
    evidenceChars: evidenceBlock.length,
    historyChars: historyBlock.length,
    questionChars: input.question.length,
    totalChars: systemChannel.length + userChannel.length,
  };

  return { systemChannel, userChannel, sizeBreakdown, truncated };
}
