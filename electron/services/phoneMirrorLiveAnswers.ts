import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'crypto';

/**
 * Mirror the overlay's live answers to the paired phone, AS THEY STREAM.
 *
 * Customer report (2026-11-05): "when you provide answers it only displays on
 * the laptop screen, not on the mobile device". Only the button IPC handlers
 * published to the phone, and only once their call returned, so:
 *  - Auto Answer (the engine answering on its own) never reached the phone;
 *  - every other answer appeared on the phone only when finished, while the
 *    overlay showed it being written;
 *  - negotiation coaching cards and corrected code (verification) never did.
 *
 * This listens to the SAME engine events main.ts forwards to the overlay and
 * streams each answer to the phone under its own stream id, labelled like the
 * button it answers. The IPC handlers still publish when their call returns,
 * but only for a press whose own answer never reached the phone this way (see
 * startPhonePress), so nothing shows twice and nothing goes missing.
 *
 * Direct Assist streams on its own channel; ipcHandlers mirrors it with
 * mirrorDirectAssistToPhone below.
 *
 * Platform-independent: main-process event wiring, same on macOS and Windows.
 */

export interface LiveAnswerPhoneSink {
  publishUserMessage(id: string, content: string, opts?: { awaitingAnswer?: boolean }): void;
  publishToken(streamId: string, token: string, opts?: { label?: string }): void;
  publishDone(streamId: string, fullContent: string, opts?: { label?: string }): void;
  publishError(streamId: string, message: string): void;
  publishDiscard(streamId: string): void;
  publishAssistantMessage(id: string, content: string, label: string): void;
}

/**
 * One button press (What to Answer, Recap, Shorten, a custom button…) while
 * its engine call runs. The engine sends the press's answer events from inside
 * that call (EventEmitter.emit and IntelligenceManager's forwarding are
 * synchronous, the run methods await their streams in place), so the press
 * travels with them through AsyncLocalStorage. An Auto Answer, or another
 * press, finishing at the same moment runs in its own context and never counts.
 */
interface PressState {
  answered: boolean;
  /** Close the press's streams still open when its call returns (see run). */
  closers: Set<() => void>;
  /**
   * The call returned. Work it started in the background still carries the
   * press context; a stream that opens now is treated as engine-started.
   */
  ended: boolean;
}
const pressScope = new AsyncLocalStorage<PressState>();

export interface PhonePress {
  /** Run the button's engine call as this press. */
  run<T>(call: () => Promise<T>): Promise<T>;
  /**
   * This press's own answer reached the phone as it streamed, or was hidden
   * there as it was on the overlay. The handler's copy is then not published;
   * when false (no answer event came), the copy is the phone's only one.
   */
  readonly answeredOnPhone: boolean;
}

export function startPhonePress(): PhonePress {
  const state: PressState = { answered: false, closers: new Set(), ended: false };
  return {
    // A call that returns with one of its answers still open on the phone
    // ended it without a final or an error event: overtaken by a newer answer,
    // or cancelled. The phone ends that card as the overlay ends its row (see
    // endAsWritten in wireLiveAnswersToPhone), and the next press starts a
    // card of its own instead of writing into this one.
    run: async (call) => {
      try {
        return await pressScope.run(state, call);
      } finally {
        state.ended = true;
        const closers = [...state.closers];
        state.closers.clear();
        for (const close of closers) {
          try { close(); } catch { /* mirror only */ }
        }
      }
    },
    get answeredOnPhone() { return state.answered; },
  };
}

/** The press whose call is running now, if any. */
function currentPress(): PressState | undefined {
  const press = pressScope.getStore();
  return press && !press.ended ? press : undefined;
}

/** The answer finishing now belongs to the press whose call is running, if any. */
function notePressAnswered(): void {
  const press = currentPress();
  if (press) press.answered = true;
}

export interface LiveAnswerMirror {
  dispose(): void;
  /**
   * A Direct Assist request started. The overlay retires every legacy What
   * to Answer / Code Hint / Brainstorm answer in flight (NativelyInterface
   * beginDirectAssist tombstone); the phone drops them the same way.
   */
  supersedeLegacyAnswers(): void;
}

let activeMirror: LiveAnswerMirror | null = null;

/** Called by the Direct Assist IPC handler when a request starts. */
export function supersedeLegacyPhoneAnswers(): void {
  try { activeMirror?.supersedeLegacyAnswers(); } catch { /* mirror only */ }
}

export interface IntelligenceEventSource {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

/** The label above each answer. The IPC handlers publish their copies with these too. */
export const PHONE_LABELS = {
  whatToAnswer: 'What to Answer',
  codeHint: 'Code Hint',
  brainstorm: 'Brainstorm',
  followUp: 'Follow Up',
  recap: 'Recap',
  clarify: 'Clarify',
  followUpQuestions: 'Follow-Up Questions',
  correctedCode: 'Corrected code',
} as const;

/** Same wording as generate-live-helper in ipcHandlers.ts. */
export function liveHelperLabel(action: unknown): string {
  return action === 'catch_me_up'
    ? 'What did I miss?'
    : action === 'define'
      ? 'Define'
      : action === 'follow_up_questions'
        ? 'Follow-up questions'
        : 'Sound smart';
}

/**
 * The engine's `error` event names a mode; these are the streams it ends.
 * Live helpers report as the row they are shown in (recap or clarify).
 */
const FAMILIES_FOR_ERROR_MODE: Record<string, string[]> = {
  what_to_say: ['what_to_answer'],
  code_hint: ['code_hint'],
  brainstorm: ['brainstorm'],
  follow_up: ['follow_up'],
  recap: ['recap', 'custom_button', 'live_helper'],
  clarify: ['clarify', 'live_helper'],
  follow_up_questions: ['follow_up_questions'],
};

interface OpenStream {
  id: string;
  family: string;
  label: string;
  /** What has streamed so far. */
  text: string;
  /** The button press whose call opened it; none for an answer the engine started itself. */
  press?: PressState;
  /**
   * Retired by a Direct Assist request: already discarded on the phone, kept
   * only so the rest of its answer (tokens, final, error) is swallowed.
   */
  retired?: boolean;
  /** The engine went idle (that sweep's number) and no token has come since. */
  idleMark?: number;
}

/** Streams with no generation id an engine run may leave open at once (bounded). */
const MAX_OPEN_IDLESS = 16;
/**
 * How long an engine-started answer may sit with no token after the engine
 * went idle before it counts as ended. Not at once: an overtaken run switches
 * the engine to idle while the newer run that overtook it is still writing.
 */
const IDLE_STALE_MS = 3_000;

/** A negotiation coaching card as text: the line to say first, then the why. */
export function formatNegotiationCoaching(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const script = typeof p.exactScript === 'string' ? p.exactScript.trim() : '';
  const note = typeof p.tacticalNote === 'string' ? p.tacticalNote.trim() : '';
  if (!script && !note) return null;
  const currency = typeof p.currency === 'string' && p.currency.trim() ? p.currency.trim() + ' ' : '';
  const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? currency + v.toLocaleString('en-US') : null);
  const parts: string[] = ['**Negotiation coaching**'];
  if (script) parts.push('**Say:** ' + script);
  if (note) parts.push(note);
  const offers = [
    money(p.theirOffer) ? 'Their offer: ' + money(p.theirOffer) : null,
    money(p.yourTarget) ? 'Your target: ' + money(p.yourTarget) : null,
  ].filter(Boolean);
  if (offers.length) parts.push(offers.join(' · '));
  return parts.join('\n\n');
}

/** A corrected answer from code verification, with the note the overlay shows. */
export function formatCodeCorrection(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null;
  const i = info as Record<string, unknown>;
  const answer = typeof i.answer === 'string' ? i.answer.trim() : '';
  if (!answer) return null;
  const note = typeof i.note === 'string' ? i.note.trim() : '';
  const verified = i.reVerified === true ? 'The fix passed its tests.' : '';
  const head = [note, verified].filter(Boolean).join(' ');
  return head ? head + '\n\n' + answer : answer;
}

export function wireLiveAnswersToPhone(
  source: IntelligenceEventSource,
  getSink: () => LiveAnswerPhoneSink | null,
  opts: { idleStaleMs?: number } = {},
): LiveAnswerMirror {
  const idleStaleMs = opts.idleStaleMs ?? IDLE_STALE_MS;
  // Streams with no generation id (Recap, Clarify, Code Hint, a custom
  // button…), oldest first. One per family AND run context: a press's stream
  // is its own (see startPhonePress), so a later press never writes into it.
  const openIdless: OpenStream[] = [];
  // What to Answer streams, by generation id.
  const openWta = new Map<number, OpenStream>();
  // Direct Assist tombstone: generations up to this id are no longer shown;
  // the id-less answers streaming when it started are marked `retired`.
  let maxGenerationSeen = -1;
  let retiredThrough = -1;
  const LEGACY_FAMILIES = ['what_to_answer', 'code_hint', 'brainstorm'];

  const sink = (): LiveAnswerPhoneSink | null => {
    try { return getSink(); } catch { return null; }
  };
  // Mirror only: nothing here may break the overlay's answer.
  const guard = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A): void => {
    try { fn(...args); } catch { /* mirror only */ }
  };

  const wtaFamily = (question: unknown): { family: string; label: string } => {
    if (question === 'Code Hint') return { family: 'code_hint', label: PHONE_LABELS.codeHint };
    if (question === 'Brainstorming Approaches') return { family: 'brainstorm', label: PHONE_LABELS.brainstorm };
    return { family: 'what_to_answer', label: PHONE_LABELS.whatToAnswer };
  };

  /** The id-less stream of this family opened in the current run context (this press, or none). */
  const findIdless = (family: string): OpenStream | undefined => {
    const press = currentPress();
    return openIdless.find((s) => s.family === family && s.press === press);
  };
  const removeIdless = (stream: OpenStream): boolean => {
    const i = openIdless.indexOf(stream);
    if (i < 0) return false;
    openIdless.splice(i, 1);
    return true;
  };
  /**
   * An id-less answer that ended with no final and no error (overtaken,
   * cancelled). The overlay keeps its row as written (discardEmptyPlaceholder
   * drops only an empty one), so the phone keeps its card, finished with the
   * same text; the press it answered then publishes no copy of its own.
   * Empty, it goes. A retired one is gone already.
   */
  const endAsWritten = (stream: OpenStream) => {
    if (stream.retired) return;
    if (!stream.text.trim()) {
      sink()?.publishDiscard(stream.id);
      return;
    }
    if (stream.press) stream.press.answered = true;
    sink()?.publishDone(stream.id, stream.text, { label: stream.label });
  };
  /** A press closes what it opened when its call returns (startPhonePress). */
  const ownedByPress = (stream: OpenStream, stillOpen: () => boolean, close: (s: OpenStream) => void) => {
    stream.press?.closers.add(() => { if (stillOpen()) close(stream); });
  };

  /** The open stream for this family in this run, or a new one (discarding a stale one of another label). */
  const streamFor = (family: string, label: string): OpenStream => {
    const open = findIdless(family);
    if (open && open.label === label) return open;
    if (open) { removeIdless(open); endAsWritten(open); }
    const fresh: OpenStream = { id: `${family}-${crypto.randomUUID()}`, family, label, text: '', press: currentPress() };
    openIdless.push(fresh);
    if (openIdless.length > MAX_OPEN_IDLESS) endAsWritten(openIdless.shift() as OpenStream);
    ownedByPress(fresh, () => removeIdless(fresh), endAsWritten);
    return fresh;
  };

  const token = (stream: OpenStream, text: unknown) => {
    stream.idleMark = undefined; // still being written
    if (typeof text !== 'string' || !text || stream.retired) return;
    stream.text += text;
    sink()?.publishToken(stream.id, text, { label: stream.label });
  };

  const finish = (stream: OpenStream | undefined, family: string, label: string, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) {
      if (stream) sink()?.publishDiscard(stream.id);
      return;
    }
    const id = stream?.id ?? `${family}-${crypto.randomUUID()}`;
    notePressAnswered();
    sink()?.publishDone(id, text, { label: stream?.label || label });
  };

  const idlessFinal = (family: string, label: string, text: unknown) => {
    const open = findIdless(family);
    if (open) removeIdless(open);
    if (open?.retired) {
      // Hidden on the overlay; its IPC copy must not show here either.
      if (typeof text === 'string' && text.trim()) notePressAnswered();
      return;
    }
    finish(open, family, label, text);
  };

  const listeners: Array<[string, (...args: any[]) => void]> = [
    ['suggested_answer_token', guard((text: unknown, question: unknown, _confidence: unknown, generationId: unknown) => {
      if (typeof generationId === 'number') {
        maxGenerationSeen = Math.max(maxGenerationSeen, generationId);
        if (generationId <= retiredThrough) return;
        let open = openWta.get(generationId);
        if (!open) {
          const fresh: OpenStream = { id: `wta-${generationId}`, family: 'what_to_answer', label: PHONE_LABELS.whatToAnswer, text: '', press: currentPress() };
          openWta.set(generationId, fresh);
          // Unlike an id-less row, the overlay hands an overtaken What to
          // Answer row to the newer generation (or the engine discards it).
          ownedByPress(fresh, () => openWta.get(generationId) === fresh && openWta.delete(generationId), (s) => sink()?.publishDiscard(s.id));
          open = fresh;
        }
        token(open, text);
        return;
      }
      const { family, label } = wtaFamily(question);
      token(streamFor(family, label), text);
    })],
    ['suggested_answer', guard((answer: unknown, question: unknown, _confidence: unknown, generationId: unknown) => {
      if (typeof generationId === 'number') {
        maxGenerationSeen = Math.max(maxGenerationSeen, generationId);
        if (generationId <= retiredThrough) {
          // Hidden on the overlay; its IPC copy must not show here either.
          if (typeof answer === 'string' && answer.trim()) notePressAnswered();
          return;
        }
        const open = openWta.get(generationId);
        openWta.delete(generationId);
        finish(open ?? { id: `wta-${generationId}`, family: 'what_to_answer', label: PHONE_LABELS.whatToAnswer, text: '' }, 'what_to_answer', PHONE_LABELS.whatToAnswer, answer);
        return;
      }
      const { family, label } = wtaFamily(question);
      idlessFinal(family, label, answer);
    })],
    ['suggested_answer_discard', guard((_reason: unknown, generationId: unknown) => {
      if (typeof generationId === 'number') {
        const open = openWta.get(generationId);
        openWta.delete(generationId);
        if (open) sink()?.publishDiscard(open.id);
        return;
      }
      // An older engine without the id: every open What to Answer row goes.
      for (const open of openWta.values()) sink()?.publishDiscard(open.id);
      openWta.clear();
    })],
    // Shorten / Expand / any follow-up rewrite: generate-follow-up publishes as 'Follow Up'.
    ['refined_answer_token', guard((text: unknown) => token(streamFor('follow_up', PHONE_LABELS.followUp), text))],
    ['refined_answer', guard((answer: unknown) => idlessFinal('follow_up', PHONE_LABELS.followUp, answer))],
    ['recap_token', guard((text: unknown) => token(streamFor('recap', PHONE_LABELS.recap), text))],
    ['recap', guard((summary: unknown) => idlessFinal('recap', PHONE_LABELS.recap, summary))],
    ['clarify_token', guard((text: unknown) => token(streamFor('clarify', PHONE_LABELS.clarify), text))],
    ['clarify', guard((text: unknown) => idlessFinal('clarify', PHONE_LABELS.clarify, text))],
    ['follow_up_questions_token', guard((text: unknown) => token(streamFor('follow_up_questions', PHONE_LABELS.followUpQuestions), text))],
    ['follow_up_questions_update', guard((text: unknown) => idlessFinal('follow_up_questions', PHONE_LABELS.followUpQuestions, text))],
    ['live_helper_token', guard((text: unknown, action: unknown) => token(streamFor('live_helper', liveHelperLabel(action)), text))],
    ['live_helper', guard((text: unknown, action: unknown) => idlessFinal('live_helper', liveHelperLabel(action), text))],
    ['custom_button_token', guard((text: unknown, name: unknown) => token(streamFor('custom_button', String(name || 'Custom')), text))],
    ['custom_button', guard((text: unknown, name: unknown) => idlessFinal('custom_button', String(name || 'Custom'), text))],
    // Sent INSTEAD of a What to Answer answer; the phone chip for What to
    // Answer resolves to it, as the overlay swaps its row for the card.
    ['negotiation_coaching', guard((payload: unknown) => {
      const text = formatNegotiationCoaching(payload);
      if (!text) return;
      notePressAnswered();
      sink()?.publishAssistantMessage(crypto.randomUUID(), text, PHONE_LABELS.whatToAnswer);
    })],
    // Arrives after the answer was shown; the overlay swaps the code in place.
    ['code_correction', guard((info: unknown) => {
      const text = formatCodeCorrection(info);
      if (text) sink()?.publishAssistantMessage(crypto.randomUUID(), text, PHONE_LABELS.correctedCode);
    })],
    ['error', guard((error: unknown, mode: unknown) => {
      const families = FAMILIES_FOR_ERROR_MODE[String(mode)] ?? [];
      const message = (error as Error)?.message || 'it failed';
      for (const family of families) {
        if (family === 'what_to_answer') continue; // the engine discards its own row (suggested_answer_discard)
        const open = findIdless(family);
        if (!open) continue;
        removeIdless(open);
        if (!open.retired) sink()?.publishError(open.id, message);
      }
    })],
    // An answer the engine started itself (an Auto Answer planner Recap, a
    // spoken "make it shorter") has no press to end it when it is overtaken.
    // Once the engine went idle, one that gets no further token ended (as
    // written, endAsWritten). A run switches to idle just BEFORE its last event
    // (setMode then emit), which ends it first; and the run that overtook it
    // keeps writing to its own.
    ['mode_changed', guard((mode: unknown) => {
      if (mode !== 'idle') return;
      const seq = ++idleSeq;
      let marked = false;
      for (const stream of openIdless) {
        if (stream.press) continue;
        stream.idleMark = seq;
        marked = true;
      }
      if (!marked) return;
      const timer = setTimeout(guard(() => {
        if (disposed) return;
        for (const stream of [...openIdless]) {
          if (stream.press || stream.idleMark !== seq) continue;
          removeIdless(stream);
          endAsWritten(stream);
        }
      }), idleStaleMs);
      (timer as { unref?: () => void }).unref?.();
    })],
  ];

  let disposed = false;
  let idleSeq = 0;
  for (const [event, listener] of listeners) source.on(event, listener);
  const mirror: LiveAnswerMirror = {
    dispose() {
      disposed = true;
      for (const [event, listener] of listeners) {
        if (source.off) source.off(event, listener);
        else source.removeListener?.(event, listener);
      }
      if (activeMirror === mirror) activeMirror = null;
    },
    supersedeLegacyAnswers() {
      retiredThrough = maxGenerationSeen;
      for (const open of openWta.values()) sink()?.publishDiscard(open.id);
      openWta.clear();
      for (const open of openIdless) {
        if (!LEGACY_FAMILIES.includes(open.family) || open.retired) continue;
        sink()?.publishDiscard(open.id);
        open.retired = true;
      }
    },
  };
  activeMirror = mirror;
  return mirror;
}

/** The Direct Assist stream events this mirrors (ipcHandlers' DirectAssistStreamEvent). */
export type DirectAssistMirrorEvent =
  | { type: 'start' }
  | { type: 'delta'; text: string }
  | { type: 'done'; fullText?: string }
  | { type: 'cancel' }
  | { type: 'error'; error?: { message?: string } }
  | { type: string; [key: string]: unknown };

/**
 * Mirror one Direct Assist request to the phone. A typed question shows as
 * the question with its answer under it, like the overlay's chat; a spoken
 * one (What to Say) or a screenshot answers under the What to Answer label,
 * which also resolves the What to Answer chip tapped on the phone.
 *
 * Returns the function to call with each stream event, in order.
 */
export function mirrorDirectAssistToPhone(
  getSink: () => LiveAnswerPhoneSink | null,
  request: { requestId: string; source: string; currentRequest?: string },
): (event: DirectAssistMirrorEvent) => void {
  const streamId = `da-${request.requestId}`;
  const typed = request.source === 'typed';
  const label = typed ? undefined : PHONE_LABELS.whatToAnswer;
  let text = '';
  let ended = false;
  const sink = (): LiveAnswerPhoneSink | null => {
    try { return getSink(); } catch { return null; }
  };
  return (event) => {
    try {
      if (ended || !event) return;
      const s = sink();
      if (!s) return;
      if (event.type === 'start') {
        const question = typeof request.currentRequest === 'string' ? request.currentRequest.trim() : '';
        if (typed && question) s.publishUserMessage(streamId, question, { awaitingAnswer: true });
        return;
      }
      if (event.type === 'delta') {
        const piece = typeof (event as { text?: unknown }).text === 'string' ? (event as { text: string }).text : '';
        if (!piece) return;
        text += piece;
        s.publishToken(streamId, piece, label ? { label } : undefined);
        return;
      }
      if (event.type === 'provider_switch') return;
      ended = true;
      if (event.type === 'done') {
        const full = typeof (event as { fullText?: unknown }).fullText === 'string' ? (event as { fullText: string }).fullText : text;
        s.publishDone(streamId, full, label ? { label } : undefined);
      } else if (event.type === 'cancel') {
        s.publishDiscard(streamId);
      } else {
        const message = (event as { error?: { message?: unknown } }).error?.message;
        s.publishError(streamId, typeof message === 'string' && message ? message : 'it failed');
      }
    } catch { /* mirror only */ }
  };
}
