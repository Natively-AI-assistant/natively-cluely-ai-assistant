// electron/llm/answerCoverage.ts
//
// WTA audit Part 11 (2026-08-18): clause-level answer coverage for the LIVE
// interview path. The multi-part machinery (hasMultipleSubQuestions /
// detectIncompleteSubQuestionAnswer) existed but was reachable ONLY behind
// the doc-grounded gate — an ordinary interview compound question ("What was
// your role, why did you pick that stack, and what did you learn?") got one
// answer with zero coverage checking, and the live benchmark's
// wrong_question_selected artifacts showed the same gap from the measurement
// side.
//
// This module PROMOTES that machinery out of the doc-grounded jail as a thin,
// pure wrapper the engine can consult on every WTA turn:
//   • assessment is deterministic string work (no LLM, no I/O) — safe to run
//     observe-only on every answer;
//   • repair is FOCUSED (append a section answering only the missing
//     clause(s)) — never a full regeneration, per the spec: "If a clause is
//     missing, perform a focused repair rather than regenerating the entire
//     answer."
//
// The term-overlap detector is a lower-bound signal, not entailment — so
// repair is deliberately conservative: only 1-2 missing clauses qualify
// (3+ missing on a non-refusal answer usually means detector noise or a
// deliberately-scoped answer, where appending three bolted-on sections would
// do more harm than good).

import { detectIncompleteSubQuestionAnswer, hasMultipleSubQuestions } from './documentGroundedPrompt';

export interface AnswerCoverageAssessment {
    /** The question contains ≥2 sub-questions per hasMultipleSubQuestions. */
    multiPart: boolean;
    /** At least one clause has zero term overlap with the answer. */
    incomplete: boolean;
    /** The uncovered clause texts (verbatim from the question). */
    missing: string[];
}

/** Repair only when the miss is small and specific. */
export const CLAUSE_REPAIR_MAX_MISSING = 2;

/**
 * Assess whether every clause of a (possibly compound) question is at least
 * lexically addressed by the answer. Pure; never mutates; a single-part
 * question is always complete by definition.
 */
export function assessAnswerCoverage(
    question: string,
    answer: string,
    opts?: { answerIsRefusal?: boolean },
): AnswerCoverageAssessment {
    const multiPart = hasMultipleSubQuestions(question);
    if (!multiPart) return { multiPart: false, incomplete: false, missing: [] };
    const result = detectIncompleteSubQuestionAnswer({
        question,
        answer,
        answerIsRefusal: opts?.answerIsRefusal,
    });
    return { multiPart, incomplete: result.incomplete, missing: result.missing };
}

/** Conservative repair gate: exactly 1..CLAUSE_REPAIR_MAX_MISSING clauses missing. */
export function shouldAttemptClauseRepair(a: AnswerCoverageAssessment): boolean {
    return a.multiPart && a.incomplete
        && a.missing.length >= 1
        && a.missing.length <= CLAUSE_REPAIR_MAX_MISSING;
}

/**
 * Instruction block for the focused repair call. The model must produce ONLY
 * the additional section — the caller appends it to the existing answer, so
 * the already-delivered content is never rewritten or removed.
 */
export function buildClauseRepairInstruction(missing: string[]): string {
    const clauses = missing.map((m) => `- ${m.trim()}`).join('\n');
    return [
        'The draft answer did not address the following part(s) of the question:',
        clauses,
        'Write ONLY a concise additional section (2-4 sentences) answering the missing part(s), in the same first-person candidate voice as the draft.',
        'Do not rewrite, repeat, or remove anything from the existing draft. Do not add headings, preamble, or closing remarks — output the additional sentences only.',
    ].join('\n');
}
