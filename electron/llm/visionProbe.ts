// electron/llm/visionProbe.ts
//
// The one-time image test (design: docs/plans/2026-10-01-vision-capability-design.md,
// phase 3): show a model a generated image of a random number, ask what it
// shows, and save whether the number came back. Pure — the adapter call, the
// disk and the clock are injected — so the rules below are tested without a
// network.
//
// The rules that matter:
//   • A transient failure is never an answer. Only a recognised image refusal,
//     or TWO real replies without the number (two different numbers), is "no".
//     One misread must not block a capable model for a month.
//   • One test at a time per model; a fresh saved result is returned without
//     asking; an unknown is retried only after a backoff.

import type { VisionQuery } from './visionResolver';
import { judgeProbeError, judgeProbeReply, type ProbeOutcome } from './visionProbeOutcome';
import { newVisionTestNumber, renderDigitsPng } from './visionTestImage';

// Worded like a person asking, on purpose: AgentRouter's content filter rejects
// canned probe text ("Say X") before authentication is even checked.
export const VISION_PROBE_QUESTION = 'What number is shown in this image?';
export const VISION_PROBE_SYSTEM = 'Answer with the number only.';

const DEFAULT_TIMEOUT_MS = 45_000;            // GPT-6 Astra's first token takes 8–13 s
const DEFAULT_RETRY_MS = 10 * 60 * 1000;
const DEFAULT_STALE_MS = 30 * 24 * 60 * 60 * 1000;
// A reply longer than this without the number is not judged at all: it was cut
// off, and a model that describes the image before answering must not be read
// as "no". One short stream once a month; the cap only stops a runaway.
const MAX_REPLY_CHARS = 4000;

export interface VisionProbeDeps {
  /** Ask the model through Natively's own adapter. Throws on any refusal or failure. */
  ask: (selection: VisionQuery, imagePath: string, signal: AbortSignal) => AsyncIterable<string>;
  writeImage: (png: Buffer) => string;
  removeImage: (imagePath: string) => void;
  recorded: (selection: VisionQuery) => { reads: boolean; at: number } | undefined;
  record: (selection: VisionQuery, reads: boolean) => void;
  keyOf: (selection: VisionQuery) => string;
  now?: () => number;
  random?: () => number;
  log?: (message: string) => void;
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number;
}

interface Attempt { outcome: ProbeOutcome; refused: boolean; number: string }

export class VisionProbe {
  private readonly inFlight = new Map<string, Promise<ProbeOutcome>>();
  private readonly lastUnknownAt = new Map<string, number>();

  constructor(private readonly deps: VisionProbeDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** A fresh saved result, or run the test (one at a time per model). `force` ignores freshness and backoff. */
  ensure(selection: VisionQuery, opts: { force?: boolean } = {}): Promise<ProbeOutcome> {
    const key = this.deps.keyOf(selection);
    const running = this.inFlight.get(key);
    if (running) return running;
    if (!opts.force) {
      const saved = this.deps.recorded(selection);
      if (saved && this.now() - saved.at < (this.deps.staleMs ?? DEFAULT_STALE_MS)) return Promise.resolve(saved.reads ? 'yes' : 'no');
      const failedAt = this.lastUnknownAt.get(key);
      if (failedAt !== undefined && this.now() - failedAt < (this.deps.retryMs ?? DEFAULT_RETRY_MS)) return Promise.resolve('unknown');
    }
    const run = this.run(selection, key).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, run);
    return run;
  }

  private async run(selection: VisionQuery, key: string): Promise<ProbeOutcome> {
    const first = await this.attempt(selection, null);
    let outcome: ProbeOutcome = first.outcome;
    // A reply without the number could be one misread: confirm with another number.
    if (first.outcome === 'no' && !first.refused) {
      const second = await this.attempt(selection, first.number);
      outcome = second.outcome === 'yes' ? 'yes' : second.outcome === 'no' ? 'no' : 'unknown';
    }
    if (outcome === 'unknown') {
      this.lastUnknownAt.set(key, this.now());
    } else {
      this.lastUnknownAt.delete(key);
      this.deps.record(selection, outcome === 'yes');
    }
    this.deps.log?.(`[VisionProbe] ${key}: ${outcome}`);
    return outcome;
  }

  private async attempt(selection: VisionQuery, avoid: string | null): Promise<Attempt> {
    let number = newVisionTestNumber(this.deps.random);
    if (number === avoid) number = String(1000 + ((Number(number) - 1000 + 4567) % 9000));
    const imagePath = this.deps.writeImage(renderDigitsPng(number));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // The probe bounds ITSELF: an adapter that ignores the signal would otherwise
    // leave this model "in flight" for the rest of the session.
    const timedOut = new Promise<'timeout'>((resolve) => controller.signal.addEventListener('abort', () => resolve('timeout'), { once: true }));
    let stream: AsyncIterator<string> | null = null;
    try {
      let reply = '';
      stream = this.deps.ask(selection, imagePath, controller.signal)[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([stream.next(), timedOut]);
        if (next === 'timeout') return { outcome: 'unknown', refused: false, number };
        if (next.done) break;
        reply += next.value;
        if (judgeProbeReply(reply, number) === 'yes') break;
        if (reply.length >= MAX_REPLY_CHARS) return { outcome: 'unknown', refused: false, number };
      }
      if (controller.signal.aborted) return { outcome: 'unknown', refused: false, number };
      return { outcome: judgeProbeReply(reply, number), refused: false, number };
    } catch (err) {
      if (controller.signal.aborted) return { outcome: 'unknown', refused: false, number };
      const judged = judgeProbeError(err);
      return { outcome: judged, refused: judged === 'no', number };
    } finally {
      clearTimeout(timer);
      controller.abort(); // stop a stream we broke out of early
      // …and let the adapter's own cleanup run. Not awaited: an adapter that
      // ignores cancellation would never answer this either.
      try { void stream?.return?.(undefined)?.catch(() => { /* best effort */ }); } catch { /* best effort */ }
      try { this.deps.removeImage(imagePath); } catch { /* best effort */ }
    }
  }
}
