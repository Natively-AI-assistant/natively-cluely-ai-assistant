// electron/intelligence/OutputShapeNormalizer.ts
//
// Spec Phase 5 — AnswerContractService / AnswerDiversityGuard / OutputShapeNormalizer.
//
// HONEST STATUS: the answer-shape machinery the spec asks for ALREADY EXISTS and is
// wired live into the manual stream path (electron/ipcHandlers.ts ~line 1223):
//   • cleanAnswerArtifacts()  — removes empty "*"/"-" bullets, dangling markers.
//   • SCAFFOLD_LABEL_RE        — detects robotic "The Honest Gap:/Speakable Final
//                                Answer:/…" label blocks.
//   • compressToSpeakable()    — strips labels → natural prose when structure wasn't asked.
//   • AnswerDiversityGuard     — flags repeated opening sentence / scaffold / near-dup.
// (all in electron/llm/answerPolish.ts, with AnswerPlanner.answerStyle deciding when
// structure was requested.)
//
// So this module does NOT re-implement any of that. It is a thin FACADE that bundles
// the existing pieces into the single named API the spec expects, so EVERY surface
// (manual today; WTA / future phases) can apply the same contract instead of the
// manual path being the only place the polish lives. It is pure, deterministic, never
// throws, and changes nothing unless a caller invokes it.

import {
  cleanAnswerArtifacts,
  compressToSpeakable,
  SCAFFOLD_LABEL_RE,
  AnswerDiversityGuard,
  varySpokenOpening,
  type RepetitionVerdict,
} from '../llm/answerPolish';
import { humanizeForAnswerType } from '../llm/humanLikeness';
import type { AnswerType } from '../llm/AnswerPlanner';

/** Answer styles (from AnswerPlanner) under which visible scaffold labels are OK. */
const STRUCTURE_STYLES = new Set(['detailed', 'bullets', 'star', 'exam', 'notes']);

export interface NormalizeInput {
  /** The raw answer text. */
  answer: string;
  /** The plan's requested style — 'default' means "no structure asked for". */
  answerStyle?: string;
  /** True for coding answers (their fenced/sectioned shape is intentional — skip). */
  isCoding?: boolean;
  /** The answer type (enables the speakability budget + humanizer final pass). */
  answerType?: AnswerType;
  /** The user's question (enables detail-request exception detection). */
  question?: string;
}

export interface NormalizeResult {
  text: string;
  /** What was applied, in order (markers only — for the IntelligenceTrace). */
  applied: string[];
  changed: boolean;
}

/**
 * Apply the output-shape contract to a finished answer:
 *   1. strip empty-bullet / dangling-marker artifacts (always),
 *   2. if a visible scaffold is present AND structure was NOT requested, compress
 *      to speakable prose.
 * Coding answers are left untouched. Pure + deterministic + never throws.
 */
export function normalizeOutputShape(input: NormalizeInput): NormalizeResult {
  const applied: string[] = [];
  let text = input.answer ?? '';
  const original = text;
  if (!text || input.isCoding) return { text, applied, changed: false };

  try {
    const cleaned = cleanAnswerArtifacts(text);
    if (cleaned !== text && cleaned.length >= 10) {
      text = cleaned;
      applied.push('cleaned_artifacts');
    }

    SCAFFOLD_LABEL_RE.lastIndex = 0;
    const hasVisibleScaffold = SCAFFOLD_LABEL_RE.test(text);
    const structureRequested = STRUCTURE_STYLES.has((input.answerStyle ?? 'default'));
    if (hasVisibleScaffold && !structureRequested) {
      const speakable = compressToSpeakable(text);
      if (speakable.length >= 40) {
        text = speakable;
        applied.push('compressed_to_speakable');
      }
    }

    // Humanizer final pass (spoken-answer-quality sprint 2026-06-15) — strips residual
    // corporate filler / source narration. Gates internally on answer type, so a coding /
    // lecture / technical answer is a no-op. NOTE: the speakability TRIM was removed
    // 2026-06-16 (it cropped the conclusion off long answers); length is the model's job via
    // the prompt, so the WTA path no longer trims either.
    if (input.answerType) {
      const human = humanizeForAnswerType(input.answerType, text);
      if (human.changed && human.text.trim().length >= 10) {
        text = human.text;
        applied.push('humanized_spoken_answer');
      }
    }
  } catch {
    return { text: original, applied: [], changed: false };
  }

  return { text, applied, changed: text !== original };
}

/**
 * The full answer contract for a delivered answer: normalize shape, then check the
 * session diversity guard and, if repeated across a DIFFERENT ask, attempt a
 * deterministic speakable rewrite. Records the (final) answer into the guard.
 *
 * `guard` is the caller's per-session AnswerDiversityGuard (the manual path keeps one
 * already). Pure aside from mutating the passed guard's history. Never throws.
 */
export function applyAnswerContract(
  input: NormalizeInput & { answerType: string; question: string; guard: AnswerDiversityGuard },
): NormalizeResult & { repetition?: RepetitionVerdict } {
  const norm = normalizeOutputShape(input);
  let text = norm.text;
  const applied = [...norm.applied];
  let repetition: RepetitionVerdict | undefined;

  try {
    repetition = input.guard.check(text, input.answerType, input.question);
    if (repetition.repeated && !input.isCoding) {
      const speakable = compressToSpeakable(text);
      if (
        speakable.length >= 40 &&
        speakable !== text &&
        !input.guard.check(speakable, input.answerType, input.question).repeated
      ) {
        text = speakable;
        applied.push('diversity_repair');
      }
    }
    input.guard.record(text, input.answerType, input.question);
  } catch {
    /* never throw — return best effort so far */
  }

  return { text, applied, changed: text !== (input.answer ?? ''), repetition };
}

export { AnswerDiversityGuard } from '../llm/answerPolish';
