// electron/context-intelligence/debug/debug-config.ts
//
// Level + content-mode resolution for Context Intelligence debug logging.
//
// Resolution order (same convention as intelligenceFlags): environment variable
// wins over the persisted UI setting, which wins over the default (off).
//
// The pure functions take explicit inputs so tests need no Electron, no env
// mutation and no settings store; the get*() bindings read the live process.

import type { ContextDebugLevel } from './debug-types';

export const CONTEXT_DEBUG_ENV = 'NATIVELY_CONTEXT_DEBUG';
export const CONTEXT_DEBUG_CONTENT_ENV = 'NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT';

export function parseDebugLevel(raw: unknown): ContextDebugLevel | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'none') return 'off';
  if (v === 'standard' || v === 'on' || v === '1' || v === 'true') return 'standard';
  if (v === 'verbose' || v === '2' || v === 'full' || v === 'debug') return 'verbose';
  return null;
}

export interface LevelInputs {
  envValue?: string | undefined;
  storedValue?: string | undefined | null;
}

/** Env > persisted setting > 'off'. Unparseable values are ignored, not errors. */
export function resolveDebugLevel(inputs: LevelInputs): ContextDebugLevel {
  const fromEnv = parseDebugLevel(inputs.envValue);
  if (fromEnv !== null) return fromEnv;
  const fromStore = parseDebugLevel(inputs.storedValue);
  if (fromStore !== null) return fromStore;
  return 'off';
}

export interface ContentModeInputs {
  envValue?: string | undefined;
  level: ContextDebugLevel;
  /** TRUE for a packaged/production build. Production REJECTS content mode. */
  isProductionBuild: boolean;
}

/**
 * Unsafe local content mode: full evidence text in logs. All three conditions
 * are required — dev build AND verbose AND the explicit env opt-in. A packaged
 * build ignores the flag entirely (fail closed).
 */
export function resolveContentInclusion(inputs: ContentModeInputs): boolean {
  if (inputs.isProductionBuild) return false;
  if (inputs.level !== 'verbose') return false;
  return String(inputs.envValue ?? '').trim() === '1';
}

// ── live bindings ───────────────────────────────────────────────────────────
//
// The stored-setting reader is INJECTED once at wiring time (ipcHandlers/main)
// so this module never imports the settings store — same inversion the rest of
// context-intelligence/ uses to stay testable without Electron.

// Anchored on globalThis (SettingsManager rule): esbuild inlines this module
// per entry bundle; the binding installed by main.ts's copy must be visible to
// every other bundle's copy.
interface BoundConfig {
  readStoredLevel: (() => string | null | undefined) | null;
  isProductionBuild: boolean | null;
}
const CONFIG_KEY = '__nativelyContextDebugConfigV1__';
function bound(): BoundConfig {
  const g = globalThis as unknown as Record<string, unknown>;
  let s = g[CONFIG_KEY] as BoundConfig | undefined;
  if (!s) { s = { readStoredLevel: null, isProductionBuild: null }; g[CONFIG_KEY] = s; }
  return s;
}

export function bindContextDebugConfig(opts: {
  readStoredLevel: () => string | null | undefined;
  isProductionBuild: boolean;
}): void {
  const s = bound();
  s.readStoredLevel = opts.readStoredLevel;
  s.isProductionBuild = opts.isProductionBuild;
}

/** Effective level for THIS moment — read per turn, so a settings change
 *  applies to the next turn without a restart. Never throws. */
export function getContextDebugLevel(): ContextDebugLevel {
  let stored: string | null | undefined;
  try { stored = bound().readStoredLevel?.(); } catch { stored = undefined; }
  return resolveDebugLevel({ envValue: process.env[CONTEXT_DEBUG_ENV], storedValue: stored });
}

/** Effective unsafe-content mode. Production detection defaults CLOSED (treat
 *  unbound as production) so an unwired call site can never leak content. */
export function getContentInclusionEnabled(level?: ContextDebugLevel): boolean {
  return resolveContentInclusion({
    envValue: process.env[CONTEXT_DEBUG_CONTENT_ENV],
    level: level ?? getContextDebugLevel(),
    isProductionBuild: bound().isProductionBuild ?? true,
  });
}

/** For the UI: where the effective value came from. */
export function describeContextDebugConfig(): {
  level: ContextDebugLevel;
  levelSource: 'environment' | 'setting' | 'default';
  contentInclusion: boolean;
} {
  const env = parseDebugLevel(process.env[CONTEXT_DEBUG_ENV]);
  let stored: string | null | undefined;
  try { stored = bound().readStoredLevel?.(); } catch { stored = undefined; }
  const storedParsed = parseDebugLevel(stored);
  const level = env ?? storedParsed ?? 'off';
  return {
    level,
    levelSource: env !== null ? 'environment' : storedParsed !== null ? 'setting' : 'default',
    contentInclusion: getContentInclusionEnabled(level),
  };
}
