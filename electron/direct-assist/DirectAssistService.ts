import { DirectAssistError, normalizeDirectAssistError } from './errors';
import { prepareDirectAssistPrompt } from './requestBuilder';
import type {
  DirectAssistRequestInput,
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
}

const SYSTEM_TIMER_SCHEDULER: DirectAssistTimerScheduler = Object.freeze({
  set: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/** Thin lifecycle wrapper around exactly one selected-provider dispatch. */
export class DirectAssistService {
  private readonly streamIdleTimeoutMs: number;
  private readonly timerScheduler: DirectAssistTimerScheduler;

  constructor(
    private readonly transport: DirectAssistTransport,
    options: DirectAssistServiceOptions = {},
  ) {
    const configuredTimeout = options.streamIdleTimeoutMs;
    this.streamIdleTimeoutMs = Number.isFinite(configuredTimeout) && Number(configuredTimeout) > 0
      ? Math.floor(Number(configuredTimeout))
      : DEFAULT_DIRECT_ASSIST_STREAM_IDLE_TIMEOUT_MS;
    this.timerScheduler = options.timerScheduler ?? SYSTEM_TIMER_SCHEDULER;
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
      });

      // This is the only transport call in the service. There is no retry,
      // provider race, model ladder, legacy planner, RAG, validator or repair.
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
            // abort the sole provider request so cooperative adapters release
            // their socket/process immediately. No retry or fallback follows.
            reject(idleError);
            if (!dispatchController?.signal.aborted) dispatchController?.abort(idleError);
          }, this.streamIdleTimeoutMs);
        });
      };
      armIdleWatchdog();

      const providerStream = this.transport.streamDirectAssist(Object.freeze({
        requestId: prepared.request.requestId,
        selection: prepared.request.selection,
        systemPrompt: prepared.systemPrompt,
        userPrompt: prepared.userPrompt,
        imagePaths: prepared.imagePaths,
      }), dispatchController.signal);
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
      yield Object.freeze({
        type: 'done',
        requestId: prepared.request.requestId,
        sequence,
        provider: prepared.request.selection.provider,
        model: prepared.request.selection.model,
      });
      return Object.freeze({
        state: 'complete',
        provider: prepared.request.selection.provider,
        model: prepared.request.selection.model,
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
      const normalized = normalizeDirectAssistError(error);
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
