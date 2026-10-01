// electron/llm/codeVerification/syntaxCheck.ts
//
// Compile-only syntax check for fenced JavaScript in an answer (2026-09-30).
//
// OBSERVE-ONLY: the result is recorded as telemetry / a debug note on the turn;
// nothing here rewrites, blocks or regenerates an answer.
//
// Why node:vm is acceptable HERE when localRunner.ts says "never vm/eval in
// process": that rule is about RUNNING model code — vm shares Electron's heap
// and is not a security boundary. `new vm.Script(code)` only PARSES and
// compiles the source; the script is never run (no runInContext/runInThisContext
// call exists in this file), so no model-written statement executes. V8 parses
// function bodies lazily, but its pre-parser still reports early syntax errors
// inside nested functions, so a bad token deep in a helper is caught too.
//
// JavaScript only. TypeScript/TSX needs a transpiler that is a devDependency
// (not shipped), so ```ts / ```tsx fences are not checked. JSX inside a
// ```js/```javascript fence is reported as `skipped: 'jsx'` rather than as an
// error, because JSX is not JavaScript syntax and flagging it would be a false
// alarm on a correct React answer.
//
// Pure Node (node:vm) — identical on macOS and Windows.

import * as vm from 'node:vm';

export type JsSyntaxOutcome =
  | { ok: true; mode: 'script' | 'module' | 'async' }
  | { ok: false; message: string; line?: number }
  | { ok: null; skipped: 'jsx' | 'empty' };

export interface FencedJsSyntaxSummary {
  /** Fenced ```js / ```javascript blocks found. */
  blocks: number;
  /** Blocks compiled cleanly. */
  valid: number;
  /** Blocks with a syntax error. */
  invalid: number;
  /** Blocks not judged (JSX, empty). */
  skipped: number;
  /** First failure, if any (message is V8's, never the code). */
  firstError?: { block: number; message: string; line?: number };
}

const JS_FENCE_RE = /```[ \t]*(javascript|js|mjs|cjs|node)[ \t]*\r?\n([\s\S]*?)(?:```|$)/gi;

/** Rough JSX sniff: a tag opening right after `(`, `return`, `=`, `=>`, `,` or line start. */
const JSX_RE = /(?:^|[=(,:?]|=>|\breturn)\s*<(?:[A-Za-z][\w.:-]*|>)[\s/>]/m;

const compiles = (code: string): { ok: true } | { ok: false; message: string; line?: number } => {
  try {
    // Compile only; the returned Script is discarded without ever running.
    new vm.Script(code, { filename: 'answer-snippet.js' });
    return { ok: true };
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 200);
    // V8 puts "answer-snippet.js:LINE" at the top of the stack for SyntaxErrors.
    const m = /answer-snippet\.js:(\d+)/.exec(String(err?.stack ?? ''));
    return { ok: false, message, ...(m ? { line: Number(m[1]) } : {}) };
  }
};

/**
 * ES module syntax neutralized for a Script-goal parse, line count preserved
 * (so a reported line number still points at the answer's line):
 *   import … from '…';      → blank line
 *   export default <expr>   → void <expr>
 *   export const/function/class/let/var/async → the declaration
 *   export { … } / export * from '…' → blank line
 */
const neutralizeModuleSyntax = (code: string): string =>
  code
    .split('\n')
    .map((line) => {
      if (/^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"][^'"]+['"]\s*;?\s*$/.test(line)) return '';
      if (/^\s*export\s+(?:\*|\{)[^;]*;?\s*$/.test(line)) return '';
      if (/^\s*export\s+default\s+/.test(line)) return line.replace(/export\s+default\s+/, 'void ');
      return line.replace(/^(\s*)export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/, '$1');
    })
    .join('\n');

/** Check one JavaScript source string. Never throws, never executes it. */
export function checkJavaScriptSyntax(code: string): JsSyntaxOutcome {
  const src = String(code ?? '');
  if (!src.trim()) return { ok: null, skipped: 'empty' };
  const first = compiles(src);
  if (first.ok) return { ok: true, mode: 'script' };

  // ES modules: `import`/`export` are only legal in a module, which a Script
  // parse rejects. Re-check with the module syntax neutralized.
  let lastError = first;
  if (/^\s*(?:import|export)\b/m.test(src)) {
    const asModule = compiles(neutralizeModuleSyntax(src));
    if (asModule.ok) return { ok: true, mode: 'module' };
    lastError = asModule;
  }
  // Top-level await is legal in a module / REPL-style snippet.
  if (/\bawait\b/.test(src)) {
    const wrapped = compiles(`(async () => {\n${neutralizeModuleSyntax(src)}\n})`);
    if (wrapped.ok) return { ok: true, mode: 'async' };
  }
  if (JSX_RE.test(src)) return { ok: null, skipped: 'jsx' };
  return { ok: false, message: lastError.message, ...(lastError.line ? { line: lastError.line } : {}) };
}

/** Check every fenced ```js / ```javascript block in an answer. */
export function checkFencedJavaScriptSyntax(answer: string): FencedJsSyntaxSummary {
  const summary: FencedJsSyntaxSummary = { blocks: 0, valid: 0, invalid: 0, skipped: 0 };
  const text = String(answer ?? '');
  JS_FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JS_FENCE_RE.exec(text)) !== null) {
    summary.blocks++;
    const outcome = checkJavaScriptSyntax(m[2]);
    if (outcome.ok === true) summary.valid++;
    else if (outcome.ok === null) summary.skipped++;
    else {
      summary.invalid++;
      if (!summary.firstError) {
        summary.firstError = { block: summary.blocks, message: outcome.message, ...(outcome.line ? { line: outcome.line } : {}) };
      }
    }
    if (m[0].length === 0) JS_FENCE_RE.lastIndex++;
  }
  return summary;
}
