// electron/llm/codeVerification/judge.ts
//
// PURE comparison of an actual run result against the expected value. Exact
// (deep) match by default, with a few SAFE normalizations so a correct answer
// isn't failed on representation: numeric int/float equality (1 === 1.0),
// string/number coercion only when one side is clearly the stringified other,
// and an opt-in order-insensitive array compare.

export interface CompareOptions {
  /** When true, arrays compare as multisets (order ignored). Default false. */
  orderInsensitive?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep structural equality with safe numeric/string normalization. */
export const valuesEqual = (a: unknown, b: unknown, opts: CompareOptions = {}): boolean => {
  if (a === b) return true;

  // Numeric: treat 1 and 1.0 (and "1" vs 1 only when both represent the same
  // finite number) as equal.
  const an = asFiniteNumber(a);
  const bn = asFiniteNumber(b);
  if (an !== null && bn !== null) return an === bn;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (opts.orderInsensitive) {
      const used = new Array(b.length).fill(false);
      return a.every(av => {
        const idx = b.findIndex((bv, i) => !used[i] && valuesEqual(av, bv, opts));
        if (idx < 0) return false;
        used[idx] = true;
        return true;
      });
    }
    return a.every((av, i) => valuesEqual(av, b[i], opts));
  }

  if (isObj(a) && isObj(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every(k => k in b && valuesEqual(a[k], b[k], opts));
  }

  // Boolean vs its string form ("true"/"false") — tolerate a stringified bool.
  if (typeof a === 'boolean' && typeof b === 'string') return String(a) === b.toLowerCase();
  if (typeof b === 'boolean' && typeof a === 'string') return String(b) === a.toLowerCase();

  return false;
};

const asFiniteNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Short, redaction-safe rendering of a value for a correction note / telemetry. */
export const renderValue = (v: unknown, max = 80): string => {
  let s: string;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = 'undefined';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

// ── SQL result-set comparison ────────────────────────────────────────────────
// Rows are objects keyed by column ALIAS (column order is not meaningful → we
// match by name). Each row's key SET must match exactly (a stray SELECT * that
// returns extra columns is a mismatch → fail). Row order is ignored UNLESS
// `ordered` is true (default false = multiset compare — the key guard against
// falsely failing a correct unordered answer). Cell values use valuesEqual, so
// NULL/numeric/text representation differences (sqlite emits bools as 0/1, text
// affinity can surface "90000" vs 90000) normalize safely and never tighten logic.

const rowsEqual = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false;
  return ak.every(k => valuesEqual(a[k], b[k]));
};

export const compareResultSet = (
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
  ordered = false,
): boolean => {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  if (ordered) {
    return expected.every((row, i) => rowsEqual(actual[i], row));
  }
  // Order-insensitive multiset: each expected row matches a distinct actual row.
  const used = new Array(actual.length).fill(false);
  return expected.every(exp => {
    const idx = actual.findIndex((act, i) => !used[i] && rowsEqual(act, exp));
    if (idx < 0) return false;
    used[idx] = true;
    return true;
  });
};
