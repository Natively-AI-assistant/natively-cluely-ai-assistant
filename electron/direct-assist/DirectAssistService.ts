import { DirectAssistError, normalizeDirectAssistError } from './errors';
import {
  DEFAULT_DIRECT_ASSIST_FALLBACK_CONFIG,
  DIRECT_ASSIST_FALLBACK_MAX_ATTEMPTS,
  DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS,
  DIRECT_ASSIST_TOTAL_BUDGET_MS,
} from './fallbackConfig';
import { prepareDirectAssistPrompt } from './requestBuilder';
import type { FallbackConfig, HealthEntry, StreamProvider } from '../llm/streamFallbackEngine';
import { runStreamingFallback } from '../llm/streamFallbackEngine';
import type {
  DirectAssistDispatchRequest,
  DirectAssistErrorCode,
  DirectAssistRequestInput,
  DirectAssistRung,
  DirectAssistStreamEvent,
  DirectAssistTerminalOutcome,
  DirectAssistTransport,
} from './types';

export const DEFAULT_DIRECT_ASSIST_STREAM_IDLE_TIMEOUT_MS = 45_000;

export interface DirectAssistTimerScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface DirectAssistServiceOptions {
  readonly streamIdleTimeoutMs?: number;
  /** Injectable only so timeout/reset behavior can be tested without real sleeps. */
  readonly timerScheduler?: DirectAssistTimerScheduler;
  /** Injectable clock for the whole-ladder budget. */
  readonly now?: () => number;
  /** Injectable backoff sleeper, handed straight to the engine. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Engine tuning overrides. Injectable ONLY so a test can drive the engine's
   * own per-attempt guards (ttftTimeoutMs, interChunkTimeoutMs, cleanupTimeoutMs)
   * without waiting 35 real seconds. Production passes nothing and gets
   * DEFAULT_DIRECT_ASSIST_FALLBACK_CONFIG. `rethrowAfterCommit` and
   * `hedgeEnabled` are pinned after this spread and cannot be overridden — they
   * are this feature's contract, not tuning.
   */
  readonly fallbackConfigOverrides?: Partial<FallbackConfig>;
}

const SYSTEM_TIMER_SCHEDULER: DirectAssistTimerScheduler = Object.freeze({
  set: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

const SYSTEM_SLEEP = (ms: number, signal?: AbortSignal): Promise<void> => new Promise<void>((resolve) => {
  const onAbort = () => { clearTimeout(timer); resolve(); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** Engine rung id. Stable and content-free — provider family plus model id. */
const rungIdOf = (rung: DirectAssistRung): string => `${rung.provider}:${rung.model}`;

/**
 * Lifecycle wrapper around ONE prompt walked down a provider ladder.
 *
 * The retry/fallback loop is NOT here: it is `runStreamingFallback`, the same
 * engine the vision and text paths use. This class builds the rung list, hands
 * it over, and narrates the walk. Re-deriving that loop would also re-derive
 * the bugs its comments record (a hedged-401 misclassification, a 410-vs-404
 * demotion, a leaked socket on an untimely abort).
 */
export class DirectAssistService {
  private readonly streamIdleTimeoutMs: number;
  private readonly timerScheduler: DirectAssistTimerScheduler;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly fallbackConfigOverrides: Partial<FallbackConfig>;

  /**
   * Direct Assist's OWN provider health, deliberately not LLMHelper's
   * visionHealth. Sharing it would let a Direct Assist timeout open a circuit
   * breaker on the live answer path — and the reverse — coupling two
   * subsystems whose whole point is that they fail independently.
   *
   * The isolation is STRUCTURAL, not behavioural: this is a per-instance field,
   * so there is no shared map to leak through and no test that could observe a
   * leak by running the ladder. What a test CAN observe is that two instances
   * hold two different maps and that this one is populated by the engine — see
   * "each service instance keeps its own provider health".
   */
  private readonly health = new Map<string, HealthEntry>();

  constructor(
    private readonly transport: DirectAssistTransport,
    options: DirectAssistServiceOptions = {},
  ) {
    const configuredTimeout = options.streamIdleTimeoutMs;
    this.streamIdleTimeoutMs = Number.isFinite(configuredTimeout) && Number(configuredTimeout) > 0
      ? Math.floor(Number(configuredTimeout))
      : DEFAULT_DIRECT_ASSIST_STREAM_IDLE_TIMEOUT_MS;
    this.timerScheduler = options.timerScheduler ?? SYSTEM_TIMER_SCHEDULER;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? SYSTEM_SLEEP;
    this.fallbackConfigOverrides = options.fallbackConfigOverrides ?? {};
  }

  public async *stream(
    input: DirectAssistRequestInput,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<DirectAssistStreamEvent, DirectAssistTerminalOutcome, void> {
    let sequence = 0;
    let terminalSent = false;
    const requestId = typeof input?.requestId === 'string' ? input.requestId : '';
    let dispatchController: AbortController | null = null;
    let providerIterator: AsyncIterator<string, void, unknown> | null = null;
    let idleTimer: unknown;
    let idleTimedOut = false;
    let onExternalAbort: (() => void) | null = null;
    let onDispatchAbort: (() => void) | null = null;
    // Hoisted: the catch has to distinguish an exhausted ladder budget from an
    // ordinary provider failure.
    let budgetExpired = false;

    if (abortSignal?.aborted) {
      terminalSent = true;
      yield Object.freeze({ type: 'cancel', requestId, sequence });
      return Object.freeze({ state: 'cancelled', chunks: sequence });
    }

    try {
      const prepared = prepareDirectAssistPrompt(input);
      yield Object.freeze({
        type: 'start',
        requestId: prepared.request.requestId,
        provider: prepared.request.selection.provider,
        model: prepared.request.selection.model,
        trimmedFields: prepared.trimmedFields,
        shortenedFields: prepared.shortenedFields,
      });

      dispatchController = new AbortController();
      let rejectDispatchAbort: (reason: unknown) => void = () => {};
      const dispatchAbortPromise = new Promise<never>((_resolve, reject) => {
        rejectDispatchAbort = reject;
      });
      onDispatchAbort = () => {
        rejectDispatchAbort(dispatchController?.signal.reason
          ?? new DirectAssistError('CANCELLED', 'The request was cancelled.'));
      };
      dispatchController.signal.addEventListener('abort', onDispatchAbort, { once: true });
      onExternalAbort = () => {
        if (!dispatchController?.signal.aborted) {
          dispatchController?.abort(abortSignal?.reason);
        }
      };
      if (abortSignal?.aborted) onExternalAbort();
      else abortSignal?.addEventListener('abort', onExternalAbort, { once: true });

      const idleError = new DirectAssistError(
        'STREAM_IDLE_TIMEOUT',
        'The selected provider stopped returning data before the answer completed.',
        true,
      );
      let idlePromise: Promise<never>;
      const armIdleWatchdog = () => {
        if (idleTimer !== undefined) this.timerScheduler.clear(idleTimer);
        idlePromise = new Promise<never>((_resolve, reject) => {
          idleTimer = this.timerScheduler.set(() => {
            idleTimedOut = true;
            // Reject the local race even if an adapter ignores AbortSignal, and
            // abort the in-flight provider request so cooperative adapters
            // release their socket/process immediately.
            reject(idleError);
            if (!dispatchController?.signal.aborted) dispatchController?.abort(idleError);
          }, this.streamIdleTimeoutMs);
        });
        // DEFUSE. A re-arm now happens mid-await (on rung open), so the read
        // loop's in-flight race may still be holding the PREVIOUS promise when
        // this one rejects. The dispatch abort above still ends that race, but
        // this promise would have no handler at rejection time and would
        // surface as an unhandledRejection — fatal in Electron main.
        idlePromise.catch(() => { /* loser of the race — defused */ });
      };
      armIdleWatchdog();

      // ONE prompt for the whole ladder: prepareDirectAssistPrompt and the
      // single `start` event stay outside it, so every rung answers the exact
      // same question.
      const dispatchRequest: DirectAssistDispatchRequest = Object.freeze({
        requestId: prepared.request.requestId,
        selection: prepared.request.selection,
        systemPrompt: prepared.systemPrompt,
        userPrompt: prepared.userPrompt,
        imagePaths: prepared.imagePaths,
        historyImagePaths: prepared.historyImagePaths,
      });

      // OPTIONAL on the transport interface: a transport without it supports no
      // ladder, and must still work as the single-dispatch service it was.
      const listed = this.transport.listDirectAssistRungs?.(dispatchRequest);
      const rungs: readonly DirectAssistRung[] = listed && listed.length > 0
        ? listed
        : [Object.freeze({
            provider: dispatchRequest.selection.provider,
            model: dispatchRequest.selection.model,
            priority: 0,
            isFallback: false,
          })];

      const ladderStartedAt = this.now();
      let activeRung: DirectAssistRung = rungs[0];
      // A QUEUE, not a slot: a three-rung walk makes two hops, and a slot would
      // keep only the last, reporting the wrong `from`.
      const pendingSwitches: DirectAssistStreamEvent[] = [];
      // Why the PREVIOUS rung was abandoned, for provider_switch.reason.
      // `reasonFromThrow` is null whenever the attempt ended without the rung's
      // own generator throwing — see switchReason().
      let reasonFromThrow: DirectAssistErrorCode | null = null;
      let lastAttemptSignal: AbortSignal | null = null;
      const switchReason = (): DirectAssistErrorCode => {
        if (reasonFromThrow !== null) return reasonFromThrow;
        // The engine's own TTFT / inter-chunk guard aborts the attempt's signal
        // and tears the rung's generator down with .return(), which runs
        // `finally` but never `catch` — and an uncooperative transport may
        // never resume to observe it at all. Read the signal rather than
        // waiting for a throw that will not come: a connect timeout is the
        // likeliest fallback trigger there is, and it used to report a generic
        // PROVIDER_ERROR.
        if (lastAttemptSignal?.aborted) return 'CONNECT_TIMEOUT';
        return 'PROVIDER_ERROR';
      };

      // The whole-ladder ceiling, expressed as a signal so the engine — which
      // already honours abortSignal between attempts and before each rung —
      // enforces it without a second timing mechanism.
      //
      // ELAPSED-checked, NOT a wall-clock timer. A timer firing on this signal
      // would also be honoured by the engine's post-commit drain loop, which
      // would truncate a perfectly healthy answer that simply took longer than
      // 90s to stream. Post-commit silence is already owned by the two guards
      // above it (the engine's 15s inter-chunk stall and this service's 45s
      // idle watchdog); the budget's only job is to refuse to OPEN work that
      // cannot finish inside it — see DIRECT_ASSIST_TOTAL_BUDGET_MS.
      const budgetController = new AbortController();
      const budgetExhausted = (): boolean => {
        if (budgetExpired) return true;
        if (this.now() - ladderStartedAt < DIRECT_ASSIST_TOTAL_BUDGET_MS) return false;
        budgetExpired = true;
        if (!budgetController.signal.aborted) {
          budgetController.abort(new DirectAssistError('CONNECT_TIMEOUT', 'No provider answered in time.', true));
        }
        return true;
      };

      const transport = this.transport;
      const engineRungs: StreamProvider[] = rungs.map((rung) => ({
        id: rungIdOf(rung),
        name: rung.provider,
        isLocal: false,
        priority: rung.priority,
        // The selected provider is worth trying harder than a fallback; a
        // fallback rung buys breadth, not depth.
        maxAttempts: rung.isFallback
          ? DIRECT_ASSIST_FALLBACK_MAX_ATTEMPTS
          : DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS,
        open: async function* (signal: AbortSignal): AsyncGenerator<string, void, unknown> {
          if (budgetExhausted()) {
            // The engine sees its abortSignal aborted and ends the ladder
            // quietly rather than classifying this as a provider failure.
            throw new DirectAssistError('CONNECT_TIMEOUT', 'No provider answered in time.', true);
          }
          // Reset per ATTEMPT so a stale reason from the previous rung can
          // never be attributed to this one's switch event.
          reasonFromThrow = null;
          lastAttemptSignal = signal;
          // Re-arm the outer silence guard on every rung AND every retry. It is
          // armed once before the ladder starts, and re-arming only on a delta
          // made it cap the whole pre-first-token WALK rather than one attempt:
          // two 30s vision connect ceilings exceed the 45s window, so it fired
          // and the ladder never opened rung 1 — inert for precisely the case
          // fallbackConfig.ts says this feature exists to fix. Pre-commit
          // silence is the engine's ttftTimeoutMs (35s); this is the 45s
          // post-commit silence guard the deadline hierarchy intends.
          armIdleWatchdog();
          let delivered = false;
          try {
            for await (const chunk of transport.streamDirectAssist(dispatchRequest, signal, rung)) {
              if (typeof chunk === 'string' && chunk.length > 0) delivered = true;
              yield chunk;
            }
            if (!delivered) {
              // Raise the service's own INCOMPLETE_STREAM rather than letting
              // the engine's internal `empty-stream` sentinel reach the user as
              // a generic PROVIDER_ERROR. Thrown, not returned, so an empty rung
              // is retried and walked past like any other pre-commit failure.
              throw new DirectAssistError(
                'INCOMPLETE_STREAM',
                'The selected provider ended the stream without returning an answer.',
                true,
              );
            }
          } catch (error) {
            // An ABORTED attempt was ended by the engine's own per-attempt
            // guard, not by the provider, and whatever the generator throws on
            // its way out of that abort is debris. Leave those to
            // switchReason(), which reads the signal instead.
            if (!signal.aborted) reasonFromThrow = normalizeDirectAssistError(error).code;
            throw error;
          }
        },
      }));

      const providerStream = runStreamingFallback(
        engineRungs,
        // Both of these are pinned AFTER the spread because they are contract,
        // not configuration, and `Partial<FallbackConfig>` is broad enough to
        // reach either. `rethrowAfterCommit` is the commit-point invariant: a
        // cut-off answer must surface as an error with partial: true, never as
        // a silently-ended stream. `hedgeEnabled` false is a hard constraint of
        // this feature, not a default — hedging duplicates the request and
        // bills two providers to shave tail latency, which is exactly the wrong
        // trade on a path the user chose for provider determinism.
        {
          ...DEFAULT_DIRECT_ASSIST_FALLBACK_CONFIG,
          ...this.fallbackConfigOverrides,
          hedgeEnabled: false,
          rethrowAfterCommit: true,
        },
        this.health,
        {
          now: this.now,
          sleep: async (ms: number, signal?: AbortSignal) => {
            await this.sleep(ms, signal);
            // Backoff is the one place the ladder spends time without opening
            // anything, so re-check the ceiling on the way out.
            budgetExhausted();
          },
          onRungOpen: (providerId: string, attempt: number) => {
            if (attempt !== 1) return;                 // a retry is not a switch
            const next = rungs.find((candidate) => rungIdOf(candidate) === providerId);
            if (!next || next.priority === activeRung.priority) return;
            pendingSwitches.push(Object.freeze({
              type: 'provider_switch',
              requestId: dispatchRequest.requestId,
              // SNAPSHOT. Pre-commit by construction, so always 0, and it must
              // not consume a delta slot — `sequence` doubles as the terminal
              // `chunks` and the `partial` test.
              sequence,
              from: { provider: activeRung.provider, model: activeRung.model },
              to: { provider: next.provider, model: next.model },
              reason: switchReason(),
            }));
            activeRung = next;
          },
        },
        AbortSignal.any([budgetController.signal, dispatchController.signal]),
      );
      providerIterator = providerStream[Symbol.asyncIterator]();

      while (true) {
        if (idleTimedOut) throw idleError;
        if (abortSignal?.aborted) break;
        let item: IteratorResult<string, void>;
        try {
          // DEFUSE the racing next() promise: if the idle watchdog or dispatch
          // abort wins the race, this promise is still pending and unobserved —
          // when the provider's in-flight request later rejects it would surface
          // as an unhandledRejection (fatal in Electron main). Attach a no-op
          // catch so the loser can never be an unhandled rejection.
          const nextP = providerIterator.next();
          nextP.catch(() => { /* loser of the race — defused */ });
          item = await Promise.race([
            nextP,
            idlePromise!,
            dispatchAbortPromise,
          ]);
        } catch (error) {
          if (idleTimedOut) throw idleError;
          throw error;
        }
        if (item.done) break;
        const text = item.value;
        if (abortSignal?.aborted) break;
        if (typeof text !== 'string' || text.length === 0) continue;
        // Announce the walk only once the new rung has actually produced a
        // token. `onRungOpen` fires BEFORE open() runs, so flushing any earlier
        // could announce a provider that the budget then refused to open.
        while (pendingSwitches.length > 0) {
          const switchEvent = pendingSwitches.shift() as DirectAssistStreamEvent;
          yield switchEvent;
        }
        sequence += 1;
        // A useful provider delta is the sole heartbeat. Empty chunks do not
        // extend a stream indefinitely.
        armIdleWatchdog();
        yield Object.freeze({
          type: 'delta',
          requestId: prepared.request.requestId,
          sequence,
          text,
        });
      }

      if (abortSignal?.aborted) {
        terminalSent = true;
        yield Object.freeze({ type: 'cancel', requestId: prepared.request.requestId, sequence });
        return Object.freeze({ state: 'cancelled', chunks: sequence });
      }

      if (sequence === 0) {
        throw new DirectAssistError(
          'INCOMPLETE_STREAM',
          'The selected provider ended the stream without returning an answer.',
          true,
        );
      }

      terminalSent = true;
      // The rung that ACTUALLY answered, not the selection: a consumer that
      // ignores provider_switch still ends up attributing the answer correctly.
      yield Object.freeze({
        type: 'done',
        requestId: prepared.request.requestId,
        sequence,
        provider: activeRung.provider,
        model: activeRung.model,
      });
      return Object.freeze({
        state: 'complete',
        provider: activeRung.provider,
        model: activeRung.model,
        chunks: sequence,
      });
    } catch (error) {
      if (terminalSent) {
        // Defensive only: the control flow above returns after each terminal.
        return Object.freeze({ state: 'cancelled', chunks: sequence });
      }
      if (abortSignal?.aborted) {
        yield Object.freeze({ type: 'cancel', requestId, sequence });
        return Object.freeze({ state: 'cancelled', chunks: sequence });
      }
      // An exhausted whole-ladder budget surfaces as itself, not as the
      // INCOMPLETE_STREAM the empty engine stream would otherwise produce.
      const normalized = budgetExpired && sequence === 0
        ? new DirectAssistError('CONNECT_TIMEOUT', 'No provider answered in time.', true)
        : normalizeDirectAssistError(error);
      if (normalized.code === 'CANCELLED') {
        yield Object.freeze({ type: 'cancel', requestId, sequence });
        return Object.freeze({ state: 'cancelled', chunks: sequence });
      }
      const payload = normalized.toPayload();
      yield Object.freeze({
        type: 'error',
        requestId,
        sequence,
        partial: sequence > 0,
        error: payload,
      });
      return Object.freeze({ state: 'failed', chunks: sequence, error: payload });
    } finally {
      if (idleTimer !== undefined) this.timerScheduler.clear(idleTimer);
      if (onExternalAbort) abortSignal?.removeEventListener('abort', onExternalAbort);
      if (onDispatchAbort && dispatchController) {
        dispatchController.signal.removeEventListener('abort', onDispatchAbort);
      }
      if ((idleTimedOut || abortSignal?.aborted) && providerIterator?.return) {
        // Do not await an adapter that ignores cancellation; the terminal event
        // must remain bounded. Absorb any eventual cleanup rejection.
        try {
          void Promise.resolve(providerIterator.return()).catch(() => {});
        } catch {
          // Best-effort iterator cleanup only.
        }
      }
    }
  }
}
