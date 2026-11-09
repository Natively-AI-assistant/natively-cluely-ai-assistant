/**
 * The Auto Answer DECIDER's input (2026-11-09, auto-answer-decider campaign §4).
 *
 * One `respond` question and one JSON state are the model's whole input. Both
 * are part of the trained model: the training rows (ml/auto-answer-decider),
 * the local ONNX runtime and the hosted endpoint must all see the SAME bytes,
 * so this module is the single TypeScript builder and
 * ml/auto-answer-decider/decider_state.py is its Python twin. Change either
 * and you retrain; the parity fixtures fail first.
 *
 * PURE: no I/O, no model. The token counter that fits the state into the
 * model's budget is injected, because only the runtime holds a tokenizer.
 *
 * `addressed_to` is computed HERE with the judge's own name helpers, never by
 * the model: measured 2026-09-27, a model told "a spelling one letter away is
 * a slip" still silenced "Evan, can you…" for a USER named Evin.
 */

import type { TranscriptTurn } from '../../../llm/transcriptCleaner';
import { addressedNamesIn, judgeUserFirstName, userNameSlipsIn } from '../AutoAnswerJudge';

/** The question id the model is asked. */
export const DECIDER_QUESTION_ID = 'respond';

/**
 * The question, byte-identical to campaign prompt §4. Its wording is model
 * input: editing one character means retraining.
 */
export const DECIDER_QUESTION = Object.freeze({
    type: 'choice',
    instructions: 'An assistant drafts answers for the USER in a live meeting. OTHERS is the meeting audio and may hold several voices. Does the latest speech in `candidate` contain a finished question or task aimed at the USER that they must answer or start now and that is not already in `last_answered`?',
    criteria: Object.freeze({
        answer: 'a finished question or task for the USER, including short or yes/no ones and declarative tasks',
        silent: 'not an ask, aimed at someone else, rhetorical or self-answered, logistics, permission, deferral, or already answered',
        wait: 'an unfinished fragment, or a structure announced but not yet delivered',
    }),
});

export type DeciderLabel = 'answer' | 'silent' | 'wait';
export const DECIDER_LABELS: readonly DeciderLabel[] = ['answer', 'silent', 'wait'];

export type AddressedTo = 'user' | 'other' | 'none';

/** Context turns the state keeps (newest last). */
export const DECIDER_CONTEXT_TURNS = 6;
/** Per-field character tails, the judge's own caps (AutoAnswerJudge.ts). */
export const DECIDER_TURN_CHAR_CAP = 400;
export const DECIDER_CANDIDATE_CHAR_CAP = 1000;
export const DECIDER_ANSWERED_CHAR_CAP = 250;
/** What `last_answered` shrinks to when the state still does not fit. */
export const DECIDER_ANSWERED_SHRUNK_CHAR_CAP = 120;

export interface DeciderStateInput {
    candidateText: string;
    recentTurns: TranscriptTurn[];
    /** Diarization labels for recentTurns by index, as JudgeRequest.speakers. */
    speakers?: (string | undefined)[];
    /** Mode TEMPLATE id ('technical-interview', 'team-meet', …), not the display name. */
    modeId?: string | null;
    lastAnsweredText?: string | null;
    userName?: string | null;
    transcriptLagging?: boolean;
}

/** The state's fields in their fixed serialization order. */
export interface DeciderStateFields {
    mode: string;
    addressed_to: AddressedTo;
    transcript_lagging: boolean;
    context: string[];
    last_answered: string | null;
    candidate: string;
}

/** Keep the last `max` characters, marking the elision (the judge's keepTail). */
export function keepTail(text: string, max: number): string {
    const t = String(text ?? '');
    return t.length <= max ? t : `…${t.slice(t.length - max)}`;
}

/**
 * Who the candidate calls on by name.
 * - 'user': it names the USER (or an STT slip of their name) as addressee.
 * - 'other': it names someone else, and not the USER.
 * - 'none': no vocative, or the USER's name is unknown (nothing to compare to).
 * A candidate naming both resolves to 'user': answering is the cheap way to be wrong.
 */
export function computeAddressedTo(candidate: string, contextTexts: string[], userName: string | null | undefined): AddressedTo {
    const name = judgeUserFirstName(userName);
    if (!name) return 'none';
    const named = addressedNamesIn(candidate);
    if (named.length === 0) return 'none';
    const slips = userNameSlipsIn([candidate, ...contextTexts], name);
    const isUser = (w: string) => [name, ...slips].some(n => n.toLowerCase() === w.toLowerCase());
    if (named.some(isUser)) return 'user';
    return 'other';
}

/** Build the state's fields (not yet fitted to a token budget). */
export function buildDeciderStateFields(input: DeciderStateInput): DeciderStateFields {
    const turns = input.recentTurns ?? [];
    const keptFrom = Math.max(0, turns.length - DECIDER_CONTEXT_TURNS);
    const kept = turns.slice(keptFrom);
    const context = kept.map((t, i) => {
        const text = keepTail(t.text, DECIDER_TURN_CHAR_CAP);
        if (t.role !== 'interviewer') return `USER: ${text}`;
        const who = input.speakers?.[keptFrom + i];
        return `${who ? `OTHERS/${who}` : 'OTHERS'}: ${text}`;
    });
    const candidate = keepTail(input.candidateText, DECIDER_CANDIDATE_CHAR_CAP);
    const answered = input.lastAnsweredText ? keepTail(input.lastAnsweredText, DECIDER_ANSWERED_CHAR_CAP) : null;
    return {
        mode: String(input.modeId || 'general'),
        addressed_to: computeAddressedTo(candidate, kept.map(t => String(t.text ?? '')), input.userName),
        transcript_lagging: input.transcriptLagging === true,
        context,
        last_answered: answered,
        candidate,
    };
}

/**
 * Serialize exactly as Python's `json.dumps(fields, ensure_ascii=False)`:
 * ", " between members, ": " after keys, non-ASCII kept raw. JSON.stringify
 * escapes strings the same way Python does with ensure_ascii=False (quote,
 * backslash, control characters), so only the separators need rebuilding.
 */
export function serializeDeciderState(f: DeciderStateFields): string {
    const s = (v: unknown) => JSON.stringify(v);
    const ctx = `[${f.context.map(s).join(', ')}]`;
    return `{${[
        `"mode": ${s(f.mode)}`,
        `"addressed_to": ${s(f.addressed_to)}`,
        `"transcript_lagging": ${f.transcript_lagging ? 'true' : 'false'}`,
        `"context": ${ctx}`,
        `"last_answered": ${f.last_answered === null ? 'null' : s(f.last_answered)}`,
        `"candidate": ${s(f.candidate)}`,
    ].join(', ')}}`;
}

export interface FittedState {
    serialized: string;
    fields: DeciderStateFields;
    /** Context turns dropped (oldest first) to fit. */
    droppedTurns: number;
    answeredShrunk: boolean;
    /** Leading candidate words dropped (its tail is always kept). */
    droppedCandidateWords: number;
}

/**
 * Fit the state into `room` tokens. The model truncates a JSON state from the
 * RIGHT, which would cut the candidate — the one field that matters — so this
 * gives ground in a fixed order instead: oldest context turns, then
 * last_answered down to a short tail, then the candidate's leading words.
 * `countTokens` must count exactly what the model will see.
 */
export function fitDeciderState(fields: DeciderStateFields, countTokens: (serialized: string) => number, room: number): FittedState {
    let f: DeciderStateFields = { ...fields, context: [...fields.context] };
    let droppedTurns = 0;
    let answeredShrunk = false;
    let droppedCandidateWords = 0;
    const fits = () => countTokens(serializeDeciderState(f)) <= room;
    while (!fits() && f.context.length > 0) {
        f.context.shift();
        droppedTurns++;
    }
    if (!fits() && f.last_answered !== null && f.last_answered.length > DECIDER_ANSWERED_SHRUNK_CHAR_CAP + 1) {
        f.last_answered = keepTail(f.last_answered.replace(/^…/, ''), DECIDER_ANSWERED_SHRUNK_CHAR_CAP);
        answeredShrunk = true;
    }
    if (!fits()) {
        const words = f.candidate.replace(/^…/, '').split(/\s+/).filter(Boolean);
        while (!fits() && words.length > 1) {
            words.shift();
            droppedCandidateWords++;
            f.candidate = `…${words.join(' ')}`;
        }
    }
    return { serialized: serializeDeciderState(f), fields: f, droppedTurns, answeredShrunk, droppedCandidateWords };
}

/** Eval sets carry the mode's DISPLAY name; map it onto a template id. */
export function modeIdForName(name: string | null | undefined): string | null {
    const n = String(name ?? '').trim().toLowerCase();
    if (!n) return null;
    const table: Record<string, string> = {
        'general': 'general',
        'technical interview': 'technical-interview',
        'system design interview': 'technical-interview',
        'looking for work': 'looking-for-work',
        'sales': 'sales',
        'recruiting': 'recruiting',
        'team meet': 'team-meet',
        'lecture': 'lecture',
        'seminar': 'seminar',
        'call center': 'call-center',
    };
    return table[n] ?? null;
}
