// electron/llm/codeVerification/types.ts
//
// Shared types for the verified-code-execution feature (see
// docs/plans/2026-06-03-verified-code-execution-design.md). Dependency-free so
// every sub-module (extract / drivers / judge / runners / orchestrator) and the
// tests can import it without cycle risk.

/** Languages we can drive + execute. Local: python/javascript. Cloud: the rest. */
export type VerifyLanguage = 'python' | 'javascript' | 'typescript' | 'java' | 'cpp' | 'c' | 'go' | 'sql';

/** Where a language runs. */
export type ExecutionBackend = 'local' | 'cloud';

/**
 * One test case. `input` is the ARGUMENT LIST passed to the entry function
 * (so a single-arg function still uses a one-element array). `expected` is the
 * value the entry function should return, compared after JSON round-trip.
 */
export interface TestCase {
  input: unknown[];
  expected: unknown;
  /** 'problem' = parsed from the problem statement (ground truth); 'model' = the
   * model's own edge case; 'smoke' = a synthesized run-without-crash check. */
  source: 'problem' | 'model' | 'smoke';
}

/**
 * Optional per-value structure hint. Dynamically-typed languages (Python/JS)
 * can't infer from a signature that an arg/return is a LeetCode linked list or
 * binary tree, so the spec may declare it. 'list' = ListNode encoded as [1,2,3];
 * 'tree' = TreeNode encoded level-order [1,2,3,null,null,4,5]; 'value' (default)
 * = a plain JSON value. C++ derives these from the signature and ignores hints.
 */
export type StructHint = 'value' | 'list' | 'tree';

/** A SQL scalar cell value as decoded from sqlite3 `.mode json` output. */
export type SqlScalar = string | number | boolean | null;
/** One SQL result-set row: column alias → scalar. */
export type SqlRow = Record<string, SqlScalar>;

/**
 * SQL verification is structurally different — there is no entry function or
 * argument list. The model writes a QUERY (the Code block) judged against a
 * schema + seed data by its RESULT SET. Present only when language === 'sql'.
 */
export interface SqlSpec {
  /** CREATE TABLE / CREATE VIEW statements, run first. */
  schema: string[];
  /** INSERT statements, run after the schema. */
  seeds: string[];
  /** Ground-truth result set: rows as {column: value} using the query's aliases. */
  expected: SqlRow[];
  /** true only when row ORDER is part of the answer; default false = multiset. */
  ordered?: boolean;
}

/** The hidden <verification_spec> the model emits, plus parsed problem examples. */
export interface VerificationSpec {
  entry: string;            // function/method name to call, e.g. "twoSum"
  language: VerifyLanguage;
  /** The RAW language string the model declared, before normalization (e.g.
   * "rust", "kotlin"). Lets the orchestrator reject an unsupported language
   * instead of coercing it to a default. '' / undefined when none declared. */
  declaredLanguageRaw?: string;
  cases: TestCase[];
  /** OPTIONAL per-argument structure hints (Python/JS linked-list/tree problems).
   * Length should match the arg count; missing/extra entries default to 'value'.
   * Backward compatible — absent means every arg is a plain JSON value. */
  argTypes?: StructHint[];
  /** OPTIONAL return-value structure hint (default 'value'). */
  retType?: StructHint;
  /** SQL-only: schema + seeds + expected result set (language === 'sql'). */
  sql?: SqlSpec;
}

/** Result of running ONE test case. */
export interface RunResult {
  case: TestCase;
  status: 'pass' | 'fail' | 'error';
  /** Raw stdout (parsed for `fail`/`pass`), or '' on error. Truncated. */
  stdout: string;
  /** Parsed actual value when the run produced JSON; undefined on error. */
  actual?: unknown;
  /** Error/compile/timeout detail for `error` (redaction-safe, truncated). */
  error?: string;
  /** Wall-clock ms for this run (for telemetry). */
  ms: number;
}

/** Overall verdict for an answer's code. */
export interface Verdict {
  /** true ONLY when at least one case ran AND every run passed. */
  passed: boolean;
  /** true when nothing could be executed (unsupported lang, no runtime, no spec). */
  skipped: boolean;
  skipReason?: 'no_spec' | 'no_code' | 'unsupported_language' | 'runtime_unavailable' | 'scope_denied';
  language?: VerifyLanguage;
  backend?: ExecutionBackend;
  results: RunResult[];
  /** The first failing/erroring run, if any (drives the correction prompt). */
  firstFailure?: RunResult;
  /** Total cases run. */
  total: number;
  /** Cases that passed. */
  passedCount: number;
}

/** Outcome of the full verify-then-maybe-correct orchestration. */
export interface VerificationOutcome {
  verdict: Verdict;
  /** Set when a correction was produced (whether or not it then verified). */
  corrected?: {
    /** The corrected full answer markdown (for a new message). */
    answer: string;
    /** true if the corrected code itself passed re-verification. */
    reVerifiedPassed: boolean;
    /** One-line, user-facing note on what was wrong. */
    note: string;
  };
}
