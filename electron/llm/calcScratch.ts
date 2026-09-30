// A hidden calculation step for answers that depend on arithmetic (2026-09-30).
//
// Measured by replaying the exact recorded prompts of nine quantitative benchmark
// turns to the same model (deepseek-flash, temperature 0.2), six samples each,
// graded by deterministic validators: 23/54 correct as prompted, 29/54 with a
// "double-check the arithmetic" line, 43/54 when the model first writes its
// working as named steps. The failures were set-up errors, not slips: "you paid
// 124, I paid 74, that leaves a $50 gap, so you're owed $50" (it is 25), "six
// gateways per warehouse" for 320 sensors at 60 per gateway (six in total). An
// expression checker run on the spoken answer passes both — every stated
// operation is right — so the fix is the step before the answer, not a check
// after it: naming each quantity ("user_owes_other = 99 - 74 = 25") is what
// removes the wrong set-up.
//
// The composer asks for the working inside [[CALC]] … [[/CALC]] BEFORE the answer
// (calculationNotice, prompt-composer.ts). This module removes that block from
// the stream at the one point every provider's chunks pass through
// (LLMHelper._streamChatTracked), so no surface — overlay, typed chat, phone,
// history, usage log — ever shows or stores it, and checks each `name = expr =
// result` line deterministically (observe-only: logged, never used to rewrite).
//
// Tag drift is real: in replay the model closed with `[/CALC]` in 10 of 54
// samples, so both tags are matched loosely, and a block the model never closes
// ends at the first prose line after a blank line.

/** `[[CALC]]`, `[CALC]`, `[[ calc ]]` … at the very start of the answer. */
const OPEN_RE = /^\s*\[\[?\s*calc\s*\]\]?/i;
/** Any close variant: `[[/CALC]]`, `[/CALC]`, `[[/CALC]`, `[ / calc ]]`. */
const CLOSE_RE = /\[{1,2}\s*\/\s*calc\s*\]{1,2}/i;
/** Longest open-tag prefix worth holding for (`[[ CALC ]]` with spaces). */
const MAX_OPEN_HOLD = 12;
/** A block this long without closing is not a scratch block; release it. */
const MAX_SCRATCH_CHARS = 4000;

type Mode = 'scanning' | 'suppressing' | 'trimming' | 'passthrough';

/** Could `s` (whitespace-trimmed start) still grow into an open tag? */
function couldBeOpenTag(s: string): boolean {
  const t = s.replace(/^\s+/, '');
  if (!t) return true;
  if (t.length > MAX_OPEN_HOLD) return false;
  // Compare against the canonical tag with optional spaces/brackets removed.
  const squashed = t.replace(/\s+/g, '').toLowerCase();
  return '[[calc]]'.startsWith(squashed) || '[calc]'.startsWith(squashed);
}

/** Is this complete line part of a scratch block (a step, blank, or a bracket line)? */
function isScratchLine(line: string): boolean {
  const t = line.trim();
  return t === '' || t.includes('=') || /^\[/.test(t);
}

export class StreamingCalcFilter {
  private mode: Mode = 'scanning';
  private buf = '';
  private absorbed = '';
  /** The scratch block's body once it has been consumed (null if none). */
  public scratch: string | null = null;

  feed(chunk: string): string {
    if (this.mode === 'passthrough') return chunk;
    if (!chunk) return '';
    this.buf += chunk;
    return this.drain(false);
  }

  finish(): string {
    if (this.mode === 'passthrough') return '';
    const out = this.drain(true);
    let tail = '';
    if (this.mode === 'suppressing') {
      // Never closed. Scratch-shaped to the end → it was all scratch; keep it
      // hidden rather than show the working. Otherwise release everything.
      const lines = (this.absorbed + this.buf).split('\n');
      if (lines.every(isScratchLine)) this.scratch = this.absorbed + this.buf;
      else tail = this.absorbed + this.buf;
    } else if (this.mode === 'scanning' || this.mode === 'trimming') {
      tail = this.mode === 'scanning' ? this.buf : '';
    }
    this.mode = 'passthrough';
    this.buf = '';
    this.absorbed = '';
    return out + tail;
  }

  private drain(final: boolean): string {
    let out = '';
    for (;;) {
      if (this.mode === 'passthrough') { out += this.buf; this.buf = ''; return out; }

      if (this.mode === 'trimming') {
        this.buf = this.buf.replace(/^\s+/, '');
        if (this.buf === '') return out;
        this.mode = 'passthrough';
        continue;
      }

      if (this.mode === 'scanning') {
        const m = this.buf.match(OPEN_RE);
        if (m) {
          this.mode = 'suppressing';
          this.buf = this.buf.slice(m[0].length);
          this.absorbed = '';
          continue;
        }
        if (!final && couldBeOpenTag(this.buf)) return out; // partial tag or leading whitespace — wait
        this.mode = 'passthrough';
        continue;
      }

      // suppressing
      const close = this.buf.match(CLOSE_RE);
      if (close && close.index !== undefined) {
        // `[[/CALC]` at the very end of what has arrived may still grow a
        // second `]`: wait for it, or the user sees a stray bracket.
        if (!final && close.index + close[0].length === this.buf.length && !close[0].endsWith(']]')) return out;
        this.scratch = this.absorbed + this.buf.slice(0, close.index);
        this.buf = this.buf.slice(close.index + close[0].length);
        this.absorbed = '';
        this.mode = 'trimming';
        continue;
      }
      // No close tag (yet). A prose line after a blank line ends an unclosed
      // block: the model forgot the tag and started answering.
      const text = this.absorbed + this.buf;
      const blank = text.search(/\n[ \t]*\n/);
      if (blank !== -1) {
        const after = text.slice(blank).replace(/^\s+/, '');
        const nl = after.indexOf('\n');
        const firstLine = nl === -1 ? (final ? after : null) : after.slice(0, nl);
        if (firstLine !== null && firstLine.trim() && !isScratchLine(firstLine) && !CLOSE_RE.test(firstLine)
            && !couldBeCloseTagPrefix(firstLine)) {
          this.scratch = text.slice(0, blank);
          this.buf = after;
          this.absorbed = '';
          this.mode = 'passthrough';
          continue;
        }
      }
      // Bank all but a close-tag-sized tail.
      const keep = 12;
      if (this.buf.length > keep) {
        this.absorbed += this.buf.slice(0, this.buf.length - keep);
        this.buf = this.buf.slice(this.buf.length - keep);
      }
      if (this.absorbed.length > MAX_SCRATCH_CHARS) {
        console.warn(`[CalcScratch] block never closed after ${this.absorbed.length} chars — releasing it.`);
        out += this.absorbed; this.absorbed = '';
        this.mode = 'passthrough';
        continue;
      }
      return out;
    }
  }
}

function couldBeCloseTagPrefix(line: string): boolean {
  const s = line.replace(/\s+/g, '').toLowerCase();
  return s.length > 0 && s.length < 10 && ('[[/calc]]'.startsWith(s) || '[/calc]'.startsWith(s));
}

/** One-shot form for assembled text: removes a LEADING scratch block. */
export function stripCalcScratch(text: string): { text: string; scratch: string | null } {
  if (!text) return { text, scratch: null };
  const f = new StreamingCalcFilter();
  const out = f.feed(text) + f.finish();
  return { text: out, scratch: f.scratch };
}

export interface CalcLineCheck { line: string; name: string; stated: number | null; computed: number | null; ok: boolean | null }

const FNS: Record<string, (...a: number[]) => number> = {
  ceil: (x) => Math.ceil(x), floor: (x) => Math.floor(x), round: (x) => Math.round(x),
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), abs: (x) => Math.abs(x),
};

/**
 * Evaluate one arithmetic expression: numbers, + - * / ( ), unary minus, names
 * defined earlier (vars), and the functions above. A small recursive-descent
 * parser — model output is never handed to eval/Function. Throws on anything else.
 */
export function evalCalcExpression(src: string, vars: ReadonlyMap<string, number> = new Map()): number {
  const toks = String(src).replace(/[$,](?=\d)/g, '').match(/\d+(?:\.\d+)?%?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/,×x÷]|\S/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const take = (t?: string) => { const v = toks[i]; if (t !== undefined && v !== t) throw new Error(`expected ${t}`); i++; return v; };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === '*' || peek() === '/' || peek() === '×' || peek() === '÷' || (peek() === 'x' && i + 1 < toks.length && /^[\d(]/.test(toks[i + 1]))) {
      const op = take();
      const r = factor();
      v = op === '/' || op === '÷' ? v / r : v * r;
    }
    return v;
  };
  const factor = (): number => {
    const t = peek();
    if (t === undefined) throw new Error('unexpected end');
    if (t === '-') { take(); return -factor(); }
    if (t === '+') { take(); return factor(); }
    if (t === '(') { take(); const v = expr(); take(')'); return v; }
    if (/^\d/.test(t)) { take(); return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t); }
    if (/^[A-Za-z_]/.test(t)) {
      take();
      const fn = FNS[t.toLowerCase()];
      if (fn && peek() === '(') {
        take('(');
        const args = [expr()];
        while (peek() === ',') { take(); args.push(expr()); }
        take(')');
        return fn(...args);
      }
      if (vars.has(t)) return vars.get(t) as number;
      throw new Error(`unknown name ${t}`);
    }
    throw new Error(`unexpected ${t}`);
  };
  const v = expr();
  if (i !== toks.length) throw new Error('trailing input');
  if (!Number.isFinite(v)) throw new Error('not finite');
  return v;
}

/**
 * Check `name = expression = result` lines left to right. Names defined by
 * earlier lines may be used later. A line that does not parse is skipped
 * (ok: null), never guessed. Observe-only: the caller logs mismatches.
 */
export function verifyCalcScratch(block: string): { lines: CalcLineCheck[]; mismatches: number; checked: number } {
  const vars = new Map<string, number>();
  const lines: CalcLineCheck[] = [];
  let mismatches = 0; let checked = 0;
  for (const raw of String(block ?? '').split('\n')) {
    const line = raw.trim();
    if (!line.includes('=')) continue;
    const parts = line.split('=').map((x) => x.trim());
    const name = parts[0].replace(/[^A-Za-z0-9_]/g, '_');
    const statedNum = (() => { const n = Number(parts[parts.length - 1].replace(/[$,%]/g, '').split(/\s/)[0]); return Number.isFinite(n) ? n : null; })();
    let computed: number | null = null;
    if (parts.length >= 3) {
      try { computed = evalCalcExpression(parts.slice(1, -1).join('='), vars); } catch { computed = null; }
    }
    let ok: boolean | null = null;
    if (computed !== null && statedNum !== null) {
      checked++;
      ok = Math.abs(computed - statedNum) <= Math.max(0.011, Math.abs(statedNum) * 0.005);
      if (!ok) mismatches++;
    }
    if (statedNum !== null || computed !== null) vars.set(name, computed !== null && ok === false ? computed : (statedNum ?? computed) as number);
    lines.push({ line, name, stated: statedNum, computed, ok });
  }
  return { lines, mismatches, checked };
}
