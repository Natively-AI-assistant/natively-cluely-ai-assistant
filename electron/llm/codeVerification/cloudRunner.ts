// electron/llm/codeVerification/cloudRunner.ts
//
// Cloud execution backend for languages we can't (or won't) run locally —
// Java, C++, Go, SQL, etc. — via a Piston-compatible code-execution API
// (https://github.com/engineer-man/piston, free + self-hostable). This is the
// PLUG-IN POINT from the design's phasing: the architecture and gating are
// here, but live cloud execution stays OFF until explicitly enabled, so the
// Python/JS local slice can ship and be proven first.
//
// PRIVACY: cloud execution sends the model's CODE + the structured test inputs
// to an external service. NOTHING else (no resume/JD/transcript/persona). It is
// gated behind the `code_execution` provider-data-scope (default allowed,
// user-toggleable) — mirroring how `reference_files`/`screenshots` are gated at
// the provider boundary. When the scope is denied or the feature is disabled,
// `cloudExecutionEnabled()` returns false and the orchestrator simply skips
// (never a false "verified", never an un-consented send).

import type { TestCase, RunResult, VerifyLanguage } from './types';

/** Languages routed to the cloud backend (everything not locally runnable). */
// Languages routed to the cloud backend = those NOT runnable locally. C++/Java
// run locally (g++/javac), Go runs locally (go run), and SQL runs locally
// (sqlite3) — so the only remaining cloud candidate is C, for an eventual
// self-hosted Piston.
export const CLOUD_LANGUAGES: VerifyLanguage[] = ['c'];

/** Default public Piston endpoint. Override with NATIVELY_PISTON_URL (self-host). */
const DEFAULT_PISTON_URL = 'https://emkc.org/api/v2/piston';

/**
 * Whether cloud execution is currently permitted. OFF unless BOTH:
 *   - the feature flag NATIVELY_CODE_EXECUTION_CLOUD === 'true' (opt-in while
 *     the cloud path is being rolled out), AND
 *   - the `code_execution` provider-data-scope is not explicitly denied.
 * Reads settings defensively (never throws); returns false on any uncertainty.
 */
export const cloudExecutionEnabled = (): boolean => {
  try {
    if (process.env.NATIVELY_CODE_EXECUTION_CLOUD !== 'true') return false;
    // Honor an explicit scope denial if SettingsManager is available.
    const { SettingsManager } = require('../../services/SettingsManager');
    const policy = SettingsManager.getInstance().get('providerDataScopes');
    return policy?.code_execution !== false;
  } catch {
    return false;
  }
};

export const pistonUrl = (): string => {
  try { return process.env.NATIVELY_PISTON_URL || DEFAULT_PISTON_URL; } catch { return DEFAULT_PISTON_URL; }
};

/**
 * Run ONE case on the cloud backend. Currently a guarded stub: when cloud
 * execution is disabled (the default), it returns an `error` RunResult tagged
 * so the orchestrator treats the language as "skipped, runtime unavailable"
 * rather than a real failure. The Piston request body shape is documented below
 * so enabling it is a small, well-scoped change.
 *
 * Piston request (when enabled): POST `${pistonUrl()}/execute`
 *   { language, version: "*", files: [{ name, content: <driver source> }],
 *     stdin: "", args: [], compile_timeout, run_timeout }
 * The driver (drivers.ts, java/cpp templates) prints the sentinel-delimited
 * JSON result; parse it with parseDriverResult and judge with valuesEqual —
 * identical to the local path.
 */
export const runCaseCloud = async (
  language: VerifyLanguage,
  _code: string,
  _entry: string,
  tc: TestCase,
): Promise<RunResult> => {
  if (!cloudExecutionEnabled()) {
    return { case: tc, status: 'error', stdout: '', error: 'cloud_execution_disabled', ms: 0 };
  }
  // NOTE: live Piston integration is intentionally not wired yet (phasing).
  // When enabling: build the driver via buildDriver(language,...), POST to
  // `${pistonUrl()}/execute`, parseDriverResult(stdout), valuesEqual(actual,
  // expected). Keep the 3s run_timeout + output cap parity with localRunner.
  return { case: tc, status: 'error', stdout: '', error: `cloud_runner_pending:${language}`, ms: 0 };
};
