// electron/llm/conversationHistoryPolicy.ts
//
// Phase 6 Slice 2 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 2 — Clean prompt composition"): the general policy deciding whether
// prior-assistant-turn content may enter a turn's prompt context, replacing
// the narrow "only strip in document-grounded custom modes" carve-out
// (ipcHandlers.ts's original stripPriorAssistantTurns call site) with a
// policy derived from the SAME isLayerAllowed gate every other context layer
// already uses (contextRoute.ts).
//
// RC3 (docs/context-rebuild/03_ROOT_CAUSES.md): before this fix,
// prior_assistant_responses was silently allowed by isLayerAllowed's
// fail-open default for any answer type that named it in NEITHER
// forbiddenContextLayers NOR requiredContextLayers — an unrelated prior
// turn's content (e.g. a résumé/JD-fit answer) could leak into a subsequent,
// unrelated question's prompt. contextRoute.ts's isLayerAllowed now flips to
// fail-closed for this one layer specifically (Slice 2 part 3); this module
// is the consumer that acts on the decision for the rolling-transcript
// snapshot.

import type { AnswerPlan } from './AnswerPlanner';
import { isLayerAllowed } from './contextRoute';

export interface HistoryGrant {
  /** True when prior_assistant_responses may be included for this plan. */
  included: boolean;
  /** Human-readable, content-free reason — safe to log/trace. */
  reason: string;
}

/**
 * The one place that decides whether prior-assistant-turn content may enter
 * this turn's prompt. Derives from the SAME isLayerAllowed gate every other
 * context layer already uses — not a second, independently-maintained rule.
 */
export function resolveHistoryGrant(plan: Pick<AnswerPlan, 'answerType' | 'requiredContextLayers' | 'forbiddenContextLayers' | 'documentGroundedCustomModeActive'>): HistoryGrant {
  const included = isLayerAllowed(plan as AnswerPlan, 'prior_assistant_responses');
  return {
    included,
    reason: included
      ? `prior_assistant_responses allowed for ${plan.answerType}`
      : `prior_assistant_responses forbidden for ${plan.answerType} (RC3)`,
  };
}

/**
 * Strip `[ASSISTANT (PREVIOUS SUGGESTION)]:` blocks from a rolling
 * transcript snapshot, keeping `[ME]:`/`[INTERVIEWER]:` turns so pronoun
 * resolution ("tell me more about that") still works via live_transcript.
 * Moved here from ipcHandlers.ts (originally 2026-06-27, document-grounded-
 * custom-mode-only scope) — Slice 2 generalizes its trigger from "is this a
 * document-grounded custom mode" to "does resolveHistoryGrant forbid it for
 * THIS answer type", so the same stripping logic now applies uniformly.
 */
export function stripPriorAssistantTurns(snapshot: string): string {
  const lines = snapshot.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\[ASSISTANT \(PREVIOUS SUGGESTION\)\]:/.test(line)) {
      skipping = true;
      continue;
    }
    if (/^\[(ME|INTERVIEWER)\]:/.test(line)) {
      skipping = false;
      kept.push(line);
      continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trim();
}

/** Apply a resolved HistoryGrant to a rolling transcript snapshot. */
export function applyHistoryGrant(snapshot: string, grant: HistoryGrant): string {
  return grant.included ? snapshot : stripPriorAssistantTurns(snapshot);
}

/** Character budget of the live speech window in a V3 prompt. */
export const SPEECH_WINDOW_MAX_CHARS = 2400;

/**
 * The live meeting's recent SPEECH for the composer's "Conversation so far"
 * section: `[ME]:` / `[INTERVIEWER]:` lines only, newest kept, cut at a line
 * boundary (2026-09-24).
 *
 * This was the formatted context's last 2,400 characters. In a live mock
 * interview 57% of those characters were the assistant's own previous
 * suggestions, so about two minutes of speech survived, and the window began
 * mid-word ("ithout falling behind."). The interviewer's "retries for up to
 * twenty four hours", said 2.5 minutes before "How would you design the retry
 * policy?", was not in the prompt, and the answer capped retries at "a few
 * minutes". The suggestions are not lost by leaving them out here: the bridge
 * merges every history exchange whose answer the window does not contain.
 */
export function speechWindowForPrompt(formatted: string, maxChars = SPEECH_WINDOW_MAX_CHARS): string {
  const lines = stripPriorAssistantTurns(String(formatted ?? '')).split('\n');
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (used + line.length + 1 > maxChars) {
      // The newest line alone is over budget: keep its END, which is what was
      // just said, rather than send nothing.
      if (!kept.length) kept.push(line.slice(-maxChars));
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return kept.reverse().join('\n');
}
