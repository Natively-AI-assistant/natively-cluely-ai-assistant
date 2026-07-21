// electron/llm/codeVerification/sqlRunner.ts
//
// PURE SQL verification core (GAP B). SQL doesn't fit the entry(args)→return
// model: the model writes a QUERY (the Code block) judged against a schema +
// seed data by its RESULT SET. We run it in `sqlite3 -safe -bail :memory:` with
// `.mode json` (one SELECT → a JSON array of row objects on stdout), and judge
// the rows. THE SAFETY INVARIANT: a SQL answer is `fail` ONLY when it ran
// successfully on sqlite AND the rows differ from expected. Any sqlite parse/
// runtime error (incl. MySQL-dialect-only constructs) is an `error` → skip,
// never a false fail. Non-SELECT / side-effecting queries are skipped (we don't
// judge a mutation by a result set). The actual spawn lives in localRunner
// (shares the sandbox); this module is the pure builder + parser.

import type { SqlRow } from './types';

/**
 * True when `query` is a SINGLE read-only SELECT (optionally a `WITH ... )
 * SELECT` CTE). Everything else — UPDATE/DELETE/INSERT/CREATE/DROP/REPLACE/
 * PRAGMA/ATTACH/VACUUM, or multiple `;`-separated statements — is NOT verifiable
 * by result set, so we skip. Conservative: any doubt → false → skip.
 */
export const isReadOnlySelect = (query: string): boolean => {
  if (!query || typeof query !== 'string') return false;
  // Strip line (-- ) and block (/* */) comments, then trim.
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (!stripped) return false;
  // Reject multiple statements: a semicolon anywhere except a single optional
  // trailing one means >1 statement.
  const withoutTrailing = stripped.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) return false;
  // Must START with SELECT or WITH (CTE). A WITH must ultimately SELECT (and must
  // not contain a data-modifying CTE like `WITH ... AS (DELETE ...)`).
  const head = withoutTrailing.toLowerCase();
  const startsSelect = /^select\b/.test(head);
  const startsWith = /^with\b/.test(head);
  if (!startsSelect && !startsWith) return false;
  // Defense in depth: reject any side-effecting / fs / dialect-escape keyword
  // appearing as a word anywhere (covers a sneaky CTE-embedded mutation).
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate)\b/i.test(withoutTrailing)) {
    return false;
  }
  return true;
};

/**
 * Build the sqlite3 script: `.mode json` + a bounded statement timeout + the
 * schema (DDL) + seeds (DML) + the model's SELECT. Only the trailing SELECT
 * emits rows, so stdout IS the result set. Returns null when the query isn't a
 * verifiable read-only SELECT, or schema/expected are missing (→ skip).
 */
export const buildSqlScript = (query: string, schema: string[], seeds: string[]): string | null => {
  if (!isReadOnlySelect(query)) return null;
  if (!Array.isArray(schema) || schema.length === 0) return null;
  const stmt = (s: string) => s.trim().replace(/;\s*$/, '') + ';';
  const lines: string[] = ['.mode json', '.timeout 2000'];
  for (const s of schema) if (typeof s === 'string' && s.trim()) lines.push(stmt(s));
  for (const s of (seeds || [])) if (typeof s === 'string' && s.trim()) lines.push(stmt(s));
  lines.push(stmt(query));
  return lines.join('\n') + '\n';
};

/**
 * Parse sqlite3 `.mode json` stdout into rows. sqlite emits a JSON array of
 * objects (or nothing for an empty result). Returns found:false when stdout has
 * no parseable JSON array (→ the caller treats it as an error/skip).
 */
export const parseSqlRows = (stdout: string): { found: boolean; rows?: SqlRow[] } => {
  const t = (stdout || '').trim();
  if (t === '') return { found: true, rows: [] }; // empty result set is valid
  // sqlite3 .mode json prints a single JSON array (possibly across lines).
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end <= start) return { found: false };
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(parsed)) return { found: false };
    return { found: true, rows: parsed as SqlRow[] };
  } catch {
    return { found: false };
  }
};
