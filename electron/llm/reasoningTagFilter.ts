// electron/llm/reasoningTagFilter.ts
//
// Suppress a model's chain-of-thought block when a provider streams it inline
// in the content channel instead of out-of-band.
//
// WHY (2026-09-03): `qwen/qwen3.6-27b` — the Groq default since the 2026-08-23
// Llama retirement — emits its whole reasoning inside `<think>…</think>` in
// `delta.content`. Every streamWith* generator in LLMHelper forwards
// `delta.content` verbatim, so the model's private deliberation (including it
// quoting the system prompt back: `The contract says: "output these EXACT
// markdown headings"`) rendered in the overlay AND was stored by SessionTracker
// as conversation history, poisoning the next turn's prompt.
//
// groqReasoningParams fixes that at the request layer for Groq. This is the
// SECOND layer, and it is not redundant: the request fix covers one provider,
// and the bug arrived in the first place because a model swap silently changed
// what the content channel contains. DeepSeek (`deepseek-v4-flash`), NVIDIA NIM,
// LiteLLM and user-configured custom providers all forward `delta.content` the
// same way and can serve a thinking model at any time. natively-api has its own
// stripper for MiniMax's `</mm:think>` shape; nothing client-side did.
//
// WHY A STATE MACHINE and not a regex: the tags arrive split across deltas.
// A per-chunk `.replace(/<think>[\s\S]*?<\/think>/g, '')` matches nothing in
// practice, because a single chunk almost never contains both tags — a live
// Groq capture opened with the chunk `"\n<think>\n"` alone. The open tag, the
// close tag, and even `<` + `think>` can land in different chunks, so the
// filter has to hold a partial tag across the boundary.
//
// WHY LEADING-ONLY: suppression is armed only until the first real output
// character. Thinking models put the block first, and refusing to touch
// mid-answer text means a legitimate answer that *discusses* `<think>` tags —
// a coding answer about this very bug — can never be eaten.
//
// NEVER BLANK: an unclosed block (max_tokens truncation, an abort) would
// otherwise swallow the entire answer, turning a cosmetic leak into a missing
// one. Both escape hatches flush what was absorbed instead: exceeding
// MAX_ABSORBED_CHARS mid-stream, and end-of-stream with the block still open.
//
// Platform note: pure string state, no I/O, no platform branch — identical
// behaviour on darwin and win32.

/**
 * Tag names treated as a reasoning block. Compared case-insensitively and after
 * dropping any XML namespace prefix, so `<mm:think>` (MiniMax) matches `think`.
 */
const REASONING_TAGS: ReadonlySet<string> = new Set([
  'think',
  'thinking',
  'reasoning',
  'reason',
]);

/**
 * Longest opening tag we will wait for before deciding the `<` was ordinary
 * text. Comfortably past `<reasoning attr="...">` while bounding how long the
 * first token can be held back — this sits on the TTFT path.
 */
const MAX_OPEN_TAG_CHARS = 200;

/**
 * Hard ceiling on how much a single unterminated block may absorb before the
 * filter gives up and flushes. A real qwen3 think block on a live answer runs
 * a few thousand characters; anything past this is a model that never closed
 * the tag, and holding more just delays a blank answer.
 */
const MAX_ABSORBED_CHARS = 40_000;

/**
 * `trimming` exists because the close tag routinely lands in its own chunk. In
 * the live capture the deltas were `…</thi`, `nk>`, `\n\nReal answer.` — so the
 * blank lines that separated the block from the answer arrived AFTER the state
 * machine had already stopped suppressing, and a same-chunk trim missed them,
 * leaving the answer opening with stray newlines. Trimming spans chunks and
 * ends at the first non-whitespace character.
 */
type Mode = 'scanning' | 'suppressing' | 'trimming' | 'passthrough';

export class StreamingReasoningFilter {
  private mode: Mode = 'scanning';
  /** Bytes held back: a partial tag while scanning, a partial close tag while suppressing. */
  private buf = '';
  /** Everything swallowed inside the current block, kept so a flush is never blank. */
  private absorbed = '';
  /** Literal close tag for the block currently open, e.g. `</mm:think>`. */
  private closeTag = '';

  /** True once a reasoning block was fully consumed — for telemetry/tests. */
  public strippedBlock = false;

  /**
   * Feed one streamed chunk. Returns the text that should be emitted, which may
   * be empty (held back) or longer than the input (a held partial released).
   */
  feed(chunk: string): string {
    if (this.mode === 'passthrough') return chunk;
    if (!chunk) return '';
    this.buf += chunk;
    return this.drain();
  }

  /**
   * Call once the upstream stream has ended. Returns whatever is still held:
   * a partial tag that turned out to be ordinary text, or — when the model
   * never closed its block — the absorbed reasoning, because showing that beats
   * showing nothing.
   */
  finish(): string {
    if (this.mode === 'passthrough') return '';
    const tail = this.mode === 'suppressing' ? this.absorbed + this.buf : this.buf;
    this.mode = 'passthrough';
    this.buf = '';
    this.absorbed = '';
    return tail;
  }

  private drain(): string {
    let out = '';
    // Each pass either emits, transitions, or returns for more input. A
    // transition always shortens `buf`, so this terminates.
    for (;;) {
      if (this.mode === 'passthrough') {
        out += this.buf;
        this.buf = '';
        return out;
      }

      if (this.mode === 'trimming') {
        const trimmed = this.buf.replace(/^\s+/, '');
        this.buf = trimmed;
        if (trimmed === '') return out; // still nothing but the block's trailing blank lines.
        this.mode = 'passthrough';
        continue;
      }

      if (this.mode === 'scanning') {
        // Leading whitespace may precede the tag (live Groq opens with "\n<think>\n"),
        // so hold it rather than treating it as real output.
        const lead = this.buf.replace(/^\s+/, '');
        if (lead === '') return out; // nothing but whitespace yet — wait.
        if (!lead.startsWith('<')) {
          // Real output began. Nothing to strip on this stream.
          this.mode = 'passthrough';
          continue;
        }
        const ltIndex = this.buf.length - lead.length;
        const gtIndex = this.buf.indexOf('>', ltIndex);
        if (gtIndex === -1) {
          if (this.buf.length - ltIndex > MAX_OPEN_TAG_CHARS) {
            // Too long to be a tag — it was ordinary text starting with '<'.
            this.mode = 'passthrough';
            continue;
          }
          return out; // partial tag straddling the chunk boundary — wait.
        }
        const rawName = this.buf.slice(ltIndex + 1, gtIndex).trim().split(/[\s/]/)[0] || '';
        const bareName = rawName.includes(':') ? rawName.slice(rawName.indexOf(':') + 1) : rawName;
        if (!REASONING_TAGS.has(bareName.toLowerCase())) {
          // Some other tag (a leaked prompt-structure block, markup) — not ours
          // to strip. isLeakedInternalTagBlock in answerPolish.ts owns that case.
          this.mode = 'passthrough';
          continue;
        }
        this.closeTag = `</${rawName}>`;
        this.mode = 'suppressing';
        this.absorbed = '';
        this.buf = this.buf.slice(gtIndex + 1);
        continue;
      }

      // suppressing
      const closeAt = this.buf.toLowerCase().indexOf(this.closeTag.toLowerCase());
      if (closeAt !== -1) {
        this.strippedBlock = true;
        this.buf = this.buf.slice(closeAt + this.closeTag.length);
        this.absorbed = '';
        this.mode = 'trimming';
        continue;
      }
      // No close yet. Keep only enough tail to complete a close tag that is
      // straddling the boundary; bank the rest so a flush is never blank.
      const keep = Math.max(0, this.closeTag.length - 1);
      if (this.buf.length > keep) {
        this.absorbed += this.buf.slice(0, this.buf.length - keep);
        this.buf = this.buf.slice(this.buf.length - keep);
      }
      if (this.absorbed.length > MAX_ABSORBED_CHARS) {
        // The model never closed the tag. Release everything rather than let a
        // guard against a cosmetic leak eat the whole answer.
        console.warn(
          `[ReasoningFilter] ${this.closeTag} never arrived after ${this.absorbed.length} chars — releasing the buffer.`,
        );
        out += this.absorbed;
        this.absorbed = '';
        this.mode = 'passthrough';
        continue;
      }
      return out;
    }
  }
}

/**
 * One-shot form for non-streaming responses and for text already assembled.
 * Same leading-only rule as the streaming filter.
 */
export function stripLeadingReasoningBlock(text: string): string {
  if (!text) return text;
  const f = new StreamingReasoningFilter();
  return f.feed(text) + f.finish();
}
