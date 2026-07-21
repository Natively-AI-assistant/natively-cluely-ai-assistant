// electron/llm/codeVerification/extractTests.ts
//
// PURE extraction: turn an answer (+ optional problem text) into the runnable
// pieces — the code block, the entry function, the language, and a merged/
// deduped list of test cases from three sources (problem examples, the model's
// own <verification_spec>, and a synthesized smoke case). No I/O, no model.

import type { TestCase, VerifyLanguage, VerificationSpec } from './types';

export interface ExtractedCode {
  code: string;
  language: VerifyLanguage | null;
  /** The RAW fenced-block language tag as written (e.g. "rust", "kotlin"),
   * BEFORE normalization — lets the caller distinguish "declared a language we
   * don't support" (skip) from "no tag at all" (infer). '' when no tag. */
  declaredTag: string;
  /** Raw fenced block including the ``` fences (for stash-and-strip). */
  block: string | null;
}

const LANG_ALIASES: Record<string, VerifyLanguage> = {
  py: 'python', python: 'python', python3: 'python',
  js: 'javascript', javascript: 'javascript', node: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  java: 'java',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp',
  c: 'c',
  go: 'go', golang: 'go',
  sql: 'sql',
};

/** Normalize a fenced-block language tag or free word to a VerifyLanguage. */
export const normalizeLanguage = (tag: string | null | undefined): VerifyLanguage | null => {
  if (!tag) return null;
  return LANG_ALIASES[tag.trim().toLowerCase()] ?? null;
};

/**
 * Infer language from the question/answer text when no fenced tag is present
 * ("write this in Java", a `class Solution` shape, `def ` for python, etc.).
 * Conservative — returns null rather than guess wrong.
 */
export const inferLanguageFromText = (text: string): VerifyLanguage | null => {
  const t = text.toLowerCase();
  // Explicit "in <lang>" / "<lang> code" requests win.
  for (const [word, lang] of Object.entries(LANG_ALIASES)) {
    if (new RegExp(`\\b(in|using|with)\\s+${word.replace('+', '\\+')}\\b`, 'i').test(t)) return lang;
  }
  if (/\bpublic\s+class\b|\bsystem\.out\b|\bpublic\s+\w+\s+\w+\s*\(/.test(text)) return 'java';
  if (/#include\b|\bstd::|\bcout\b|\bint\s+main\s*\(/.test(text)) return 'cpp';
  if (/\bdef\s+\w+\s*\(|\bprint\s*\(/.test(text)) return 'python';
  if (/\bfunction\s+\w+\s*\(|\bconst\s+\w+\s*=|\bconsole\.log\b|=>/.test(text)) return 'javascript';
  if (/\bselect\b[\s\S]*\bfrom\b/i.test(text)) return 'sql';
  return null;
};

/** Extract the FIRST fenced code block (language tag + body + raw block). */
export const extractCodeBlock = (answer: string): ExtractedCode => {
  const match = answer.match(/```([a-zA-Z0-9+#.\-]*)\s*\n([\s\S]+?)```/);
  if (!match) return { code: '', language: null, declaredTag: '', block: null };
  return {
    code: (match[2] || '').trim(),
    language: normalizeLanguage(match[1]),
    declaredTag: (match[1] || '').trim(),
    block: match[0],
  };
};

/**
 * Extract the hidden <verification_spec> JSON block the model emits. Returns the
 * parsed spec and the raw block (so the caller can strip it before display).
 * Tolerant: accepts a ```json fenced spec or a bare tag; returns null on absence
 * or parse failure (verification then falls back to problem-example/smoke).
 */
export const extractVerificationSpec = (answer: string): { spec: VerificationSpec | null; block: string | null } => {
  const m = answer.match(/<verification_spec>\s*([\s\S]*?)\s*<\/verification_spec>/i);
  if (!m) return { spec: null, block: null };
  const raw = m[1].replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed) return { spec: null, block: m[0] };
    const language = normalizeLanguage(parsed.language);

    // ── SQL spec: schema/seeds/expected, NO entry/cases. Validated separately. ──
    if (language === 'sql') {
      const sqlRaw = (parsed.sql && typeof parsed.sql === 'object') ? parsed.sql : parsed;
      const strArr = (a: any): string[] => Array.isArray(a) ? a.filter((s: any) => typeof s === 'string' && s.trim()) : [];
      const schema = strArr(sqlRaw.schema);
      const seeds = strArr(sqlRaw.seeds);
      const expected = Array.isArray(sqlRaw.expected)
        ? sqlRaw.expected.filter((r: any) => r && typeof r === 'object' && !Array.isArray(r))
        : [];
      const ordered = sqlRaw.ordered === true;
      // Empty schema or expected → leave sql undefined so the orchestrator skips
      // (we never run an unseeded query or judge against nothing).
      const sql = (schema.length > 0 && expected.length > 0) ? { schema, seeds, expected, ordered } : undefined;
      return {
        spec: { entry: typeof parsed.entry === 'string' ? parsed.entry : 'query', language: 'sql', cases: [], sql },
        block: m[0],
      };
    }

    // ── Function spec: entry + cases (existing path). ──
    if (typeof parsed.entry !== 'string' || !Array.isArray(parsed.cases)) {
      return { spec: null, block: m[0] };
    }
    const cases: TestCase[] = parsed.cases
      .filter((c: any) => c && Array.isArray(c.input) && 'expected' in c)
      .map((c: any) => ({ input: c.input, expected: c.expected, source: 'model' as const }));
    // Optional structure hints (Python/JS linked-list/tree problems). Sanitized
    // to the known set; anything else → 'value' (backward compatible).
    const asHint = (h: any): 'value' | 'list' | 'tree' => (h === 'list' || h === 'tree') ? h : 'value';
    const argTypes = Array.isArray(parsed.argTypes) ? parsed.argTypes.map(asHint) : undefined;
    const retType = parsed.retType !== undefined ? asHint(parsed.retType) : undefined;
    // Preserve the model's RAW declared language so the orchestrator can reject
    // an unsupported one (rust/kotlin/php/…). We must NOT coerce an unknown
    // language to 'python' — that silently ran foreign code in the wrong
    // interpreter. `language` stays the normalized value when known (else
    // 'python' as a last-resort default ONLY when nothing was declared).
    const declaredLanguageRaw = typeof parsed.language === 'string' ? parsed.language.trim() : '';
    return {
      spec: { entry: parsed.entry.trim(), language: (language ?? 'python'), declaredLanguageRaw, cases, argTypes, retType },
      block: m[0],
    };
  } catch {
    return { spec: null, block: m[0] };
  }
};

/**
 * Parse worked examples ("Input: nums = [2,7], target = 9  Output: [0,1]") from
 * a problem statement / OCR text. Best-effort and conservative: only emits a
 * case when BOTH an input and an output are confidently parseable as JSON-ish
 * values. These are ground-truth cases (source: 'problem').
 *
 * Note: input parsing here yields a single positional value per "Input:" unless
 * the text clearly lists multiple `name = value` pairs, in which case each value
 * becomes a positional arg in textual order. The orchestrator only USES problem
 * cases whose arity matches the entry's; mismatches are dropped at run time.
 */
export const parseProblemExamples = (problemText: string | undefined): TestCase[] => {
  if (!problemText) return [];
  const cases: TestCase[] = [];
  // Match "Input: ... Output: ..." (or "Example N: Input ... Output ...").
  const re = /input\s*:?\s*([\s\S]*?)\s*output\s*:?\s*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(problemText)) !== null) {
    const inputs = parseAssignmentsOrValue(m[1]);
    const expected = parseLooseJson(m[2].trim());
    if (inputs !== null && expected !== undefined) {
      cases.push({ input: inputs, expected, source: 'problem' });
    }
    if (cases.length >= 5) break; // cap problem-derived cases
  }
  return cases;
};

// "nums = [1,2], target = 9" → [[1,2], 9] ; or a bare "[1,2,0]" → [[1,2,0]].
const parseAssignmentsOrValue = (segment: string): unknown[] | null => {
  const assignments = [...segment.matchAll(/[A-Za-z_]\w*\s*=\s*([^,\n][^=]*?)(?=(?:,\s*[A-Za-z_]\w*\s*=)|$)/g)];
  if (assignments.length > 0) {
    const vals = assignments.map(a => parseLooseJson(a[1].trim())).filter(v => v !== undefined);
    return vals.length > 0 ? vals : null;
  }
  const single = parseLooseJson(segment.trim());
  return single === undefined ? null : [single];
};

// Parse a JSON-ish token: arrays/objects/numbers/booleans/strings, lenient on
// trailing punctuation and single quotes. Returns undefined when not parseable.
const parseLooseJson = (token: string): unknown => {
  let t = token.trim().replace(/[.;]+$/, '').trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch { /* fall through */ }
  try { return JSON.parse(t.replace(/'/g, '"')); } catch { /* fall through */ }
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null') return null;
  // A bare unquoted word/string (e.g. "Odd") → treat as string.
  if (/^[A-Za-z][\w ]*$/.test(t)) return t;
  return undefined;
};

/** Stable key for dedupe: input + expected JSON. */
const caseKey = (c: TestCase): string => {
  try { return JSON.stringify([c.input, c.expected]); } catch { return `${String(c.input)}|${String(c.expected)}`; }
};

/**
 * Merge problem + model cases, dedupe (problem source wins on collision), cap.
 * Problem cases are listed FIRST so they're judged first (ground truth).
 */
export const mergeTestCases = (problem: TestCase[], model: TestCase[], cap = 12): TestCase[] => {
  const seen = new Set<string>();
  const out: TestCase[] = [];
  for (const c of [...problem, ...model]) {
    const key = caseKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
};
