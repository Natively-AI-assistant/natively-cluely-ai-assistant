// scripts/intent-benchmark/providers/hybrid.mjs
//
// HYBRID: rules, then a fast primary, then an escalation model — but only for
// the turns the primary is unsure about, and only inside a deadline.
//
// This is the shape the measurements argue for rather than one the brief
// assumed. Two results drive it:
//
//   Model2Vec answers every axis in 0.13ms at p95, which is 190x faster than
//   the fine-tuned head and 540x faster than the shipped MobileBERT. It is a
//   table lookup per token; there is no transformer in it.
//
//   The fine-tuned head is the most accurate candidate by a wide margin but
//   costs ~25ms, which is the entire latency budget on its own.
//
// So spending 25ms on every turn buys accuracy the cheap model would have got
// right anyway. Spending 0.13ms on all of them and 25ms on the uncertain
// minority buys most of the accuracy for a fraction of the average cost. What
// makes that testable rather than plausible is the MARGIN: the gap between the
// top two labels on an axis, which is a usable proxy for "the primary is
// guessing".
//
// THE DEADLINE IS NOT OPTIONAL. On a live turn a slow escalation is worse than
// a slightly wrong answer, because the user is mid-conversation. If escalation
// does not return in time the primary's answer stands and the frame is stamped
// `timeout_fallback`, so the provenance says which path produced it.

import { Provider } from './contract.mjs';
import { SCORED_AXES } from './contract.mjs';

export class HybridProvider extends Provider {
  /**
   * @param {{id, rules?, primary, escalation?, marginThreshold?, deadlineMs?, escalateAxes?}} opts
   */
  constructor(opts) {
    super(opts.id);
    this.opts = { marginThreshold: 0.25, deadlineMs: 150, ...opts };
    this.stats = { rulesHit: 0, escalated: 0, timedOut: 0, primaryOnly: 0 };
  }

  async load() {
    // REFUSE AN UNSAFE RUNTIME MIX.
    //
    // Measured, not theoretical: a hybrid whose primary drives onnxruntime-node
    // directly and whose escalation goes through transformers.js's own bundled
    // ORT aborts the whole process with an uncaught Napi::Error, even though
    // the two models are in separate workers. Two native ORT instances in one
    // process is the hazard, and worker isolation does not save you from it —
    // which is the same family of failure as the BFCArena aborts this codebase
    // already hit on macOS.
    //
    // It matters beyond the benchmark: a shipped router pairing a fast primary
    // with a slower escalation must build BOTH on the same binding. Failing
    // here with an explanation is better than a native abort with none.
    const bindings = [this.opts.primary, this.opts.escalation]
      .filter(Boolean)
      .map((p) => p.meta()?.ortBinding)
      .filter(Boolean);
    const distinct = [...new Set(bindings)];
    if (distinct.length > 1) {
      throw new Error(
        `${this.id}: refusing to mix ONNX bindings (${distinct.join(' + ')}). ` +
        'Two native ORT instances in one process abort it, worker isolation notwithstanding. ' +
        'Build the primary and the escalation on the same binding.',
      );
    }

    if (this.opts.rules) await this.opts.rules.load();
    await this.opts.primary.load();
    if (this.opts.escalation) await this.opts.escalation.load();
  }

  /** Gap between the top two alternatives on an axis. Low means "guessing". */
  #margin(frame, axis) {
    const alts = frame.alternatives?.[axis];
    if (!alts || alts.length < 2) return 1;
    return Math.abs(alts[0][1] - alts[1][1]);
  }

  async classify(input) {
    let workerMs = 0;

    // Tier 1: the production regex, unchanged. It fires on few turns (7.7% of
    // the corpus) but is effectively free, and on those turns it is a
    // deterministic answer rather than a model's opinion.
    let rulesFrame = null;
    if (this.opts.rules) {
      rulesFrame = await this.opts.rules.classify(input);
      if (rulesFrame?.legacy_intent) this.stats.rulesHit++;
    }

    // Tier 2: the fast primary, always.
    const primary = await this.opts.primary.classify(input);
    workerMs += primary.workerMs ?? 0;

    // A rules hit is authoritative for the axes the rules actually decide, and
    // silent on the rest. It does NOT replace the whole frame: the regex knows
    // nothing about needs_response or grounding, and letting it blank those
    // would throw away the primary's answer for no reason.
    if (rulesFrame?.legacy_intent) {
      primary.legacy_intent = rulesFrame.legacy_intent;
      primary.provenance = 'rules';
    }

    if (!this.opts.escalation) {
      this.stats.primaryOnly++;
      primary.workerMs = workerMs;
      return primary;
    }

    // Escalate only if some axis we care about is genuinely close.
    const axes = this.opts.escalateAxes ?? SCORED_AXES;
    const unsure = axes.filter((a) => this.#margin(primary, a) < this.opts.marginThreshold);
    if (unsure.length === 0) {
      this.stats.primaryOnly++;
      primary.workerMs = workerMs;
      return primary;
    }

    const started = performance.now();
    try {
      const escalated = await Promise.race([
        this.opts.escalation.classify(input),
        new Promise((_, rej) => setTimeout(() => rej(new Error('deadline')), this.opts.deadlineMs)),
      ]);
      this.stats.escalated++;
      workerMs += escalated.workerMs ?? 0;
      // Take the escalation's answer ONLY on the axes that were actually
      // uncertain. Overwriting a confident primary answer with a slower model's
      // opinion is how an escalation ladder loses accuracy it already had.
      for (const axis of unsure) {
        if (escalated[axis] != null) {
          primary[axis] = escalated[axis];
          primary.confidence[axis] = escalated.confidence?.[axis] ?? primary.confidence[axis];
          primary.alternatives[axis] = escalated.alternatives?.[axis] ?? primary.alternatives[axis];
        }
      }
      if (escalated.legacy_intent != null && !rulesFrame?.legacy_intent) {
        primary.legacy_intent = escalated.legacy_intent;
      }
      primary.provenance = rulesFrame?.legacy_intent ? 'rules' : 'escalation';
    } catch {
      // Deadline blown. The primary's answer stands, and the frame says so.
      this.stats.timedOut++;
      primary.provenance = 'timeout_fallback';
      workerMs += performance.now() - started;
    }

    primary.workerMs = workerMs;
    return primary;
  }

  async unload() {
    if (this.opts.rules) await this.opts.rules.unload();
    await this.opts.primary.unload();
    if (this.opts.escalation) await this.opts.escalation.unload();
  }

  meta() {
    const total = this.stats.escalated + this.stats.primaryOnly;
    return {
      family: 'hybrid',
      params: 0,
      sizeOnDiskMB: 0,
      runtime: 'onnx',
      primary: this.opts.primary.id,
      escalation: this.opts.escalation?.id ?? null,
      marginThreshold: this.opts.marginThreshold,
      deadlineMs: this.opts.deadlineMs,
      // The number that decides whether the hybrid is worth its complexity.
      escalationRate: total ? this.stats.escalated / total : null,
      rulesHitRate: total ? this.stats.rulesHit / total : null,
      timedOut: this.stats.timedOut,
    };
  }
}
