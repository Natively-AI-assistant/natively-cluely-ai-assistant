// electron/context-intelligence/contracts/flag.ts
//
// The ONE flag for Context Intelligence V3.
//
// DEFAULT MUST BE IDENTICAL IN DEV, TEST AND PRODUCTION.
//
// This is not stylistic. 20 of the 62 existing intelligence flags resolve
// differently in dev/test than in production (`isInternalDevTestContext`), and
// that split is the mechanism by which:
//   • composePrompt was built, tested, and never executed for a user,
//   • assistantClaims enforcement is on in tests and off in production,
//   • the OKF provenance layer — the only content-hash versioning in the system
//     — is inert in every shipped build.
//
// A rebuild that reproduces the split reproduces the outcome. So this module
// deliberately does NOT import intelligenceFlags: there is nothing to inherit
// from, and no dev-only default to accidentally adopt.
//
// See docs/context-intelligence-v3/12_ROLLOUT_AND_ROLLBACK.md §2

const ENV_KEY = 'NATIVELY_CONTEXT_INTELLIGENCE_V3';

/**
 * Where the opt-in is persisted.
 *
 * Its own small file in userData, deliberately NOT a field in intelligenceFlags:
 * this module must not import that registry (see the header — there is nothing
 * to inherit and no dev-only default to accidentally adopt), and a rollout
 * opt-in should not require a settings migration to exist.
 *
 * Test isolation uses NATIVELY_TEST_USERDATA, the same variable every harness
 * here already sets, so a developer's real opt-in can never leak into a test run
 * and flip an assertion about the default.
 */
const SETTING_FILE = 'context-intelligence-v3.json';

function settingsPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    if (process.env.NATIVELY_TEST_USERDATA) return path.join(process.env.NATIVELY_TEST_USERDATA, SETTING_FILE);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), SETTING_FILE);
    return null;
  } catch { return null; }
}

/** The persisted opt-in, or null when the user has never chosen. */
export function readPersistedSetting(): boolean | null {
  try {
    const p = settingsPath();
    if (!p) return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return typeof raw?.enabled === 'boolean' ? raw.enabled : null;
  } catch { return null; }
}

/** Persist the opt-in; null clears it back to DEFAULT_ENABLED. */
export function writePersistedSetting(enabled: boolean | null): void {
  const p = settingsPath();
  if (!p) throw new Error('no userData path available for the V3 opt-in');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (enabled === null) { try { fs.unlinkSync(p); } catch { /* already absent */ } return; }
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ enabled }, null, 2));
  fs.renameSync(tmp, p);
}

const truthy = (v: string | undefined): boolean => {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes' || s === 'enabled';
};

const falsy = (v: string | undefined): boolean => {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'off' || s === 'no' || s === 'disabled';
};

/**
 * Is the V3 pipeline enabled?
 *
 * Resolution order — note there is no environment-sensitive branch anywhere:
 *   1. explicit env var (either direction)
 *   2. explicit persisted setting (either direction)
 *   3. DEFAULT_ENABLED — one constant, every environment
 */
export const DEFAULT_ENABLED = false;

export interface FlagOverrides {
  /** Persisted user/dev setting, when the caller has SettingsManager available. */
  setting?: boolean | null;
  /** Injectable for tests — avoids mutating process.env. */
  env?: Record<string, string | undefined>;
}

export function isContextIntelligenceV3Enabled(overrides: FlagOverrides = {}): boolean {
  const env = overrides.env ?? process.env;
  const raw = env[ENV_KEY];
  if (truthy(raw)) return true;
  if (falsy(raw)) return false;
  if (typeof overrides.setting === 'boolean') return overrides.setting;

  // The persisted opt-in, read HERE rather than expected from callers.
  //
  // This branch was documented in the resolution order from the beginning and
  // was unreachable: every call site invoked this function with no arguments, so
  // `overrides.setting` was always undefined and the only working switch was the
  // env var. That is the F1 pattern — a documented path with no caller — inside
  // the flag module written to end it, and it surfaced the first time anyone
  // tried to opt in. Enabling a rollout stage must not require relaunching the
  // app from a shell with an env var set.
  const persisted = readPersistedSetting();
  if (typeof persisted === 'boolean') return persisted;

  return DEFAULT_ENABLED;
}

/**
 * Guard used at every V3 entry point.
 *
 * Returns the legacy result untouched when the flag is off, so rollback for the
 * entire migration is a flag flip rather than a revert — which holds only as
 * long as the new module stays additive.
 */
export function whenV3Enabled<T>(enabled: boolean, v3: () => T, legacy: () => T): T {
  return enabled ? v3() : legacy();
}

export const CONTEXT_INTELLIGENCE_V3_ENV_KEY = ENV_KEY;
