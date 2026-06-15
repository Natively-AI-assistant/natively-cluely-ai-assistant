// electron/llm/liveSessionMemoryConfig.ts
//
// Feature flag + ROLLOUT controls for wiring the validated long-range SessionMemory
// model (SessionMemory + resolveSessionFollowup) into the LIVE hot path. The model is
// proven by the follow-up / long-session benchmarks (100% resolution, 0 cross-mode
// leaks); this flag controls whether the LIVE product uses it for follow-up
// resolution.
//
// WIRED TODAY: the IntelligenceEngine "What to answer?" (live transcript) path —
// the only surface with real multi-turn history. The manual chat path is SINGLE-SHOT
// (no conversation history is threaded to its IPC handler), so SessionMemory has
// nothing to recall there; manual mode already returns the deterministic
// context-free clarification for bare follow-ups. The meeting/sales/lecture modes
// flow through the SAME WTA path (they're live transcript surfaces), so their mode
// boundaries apply via toMemoryMode/toSurface. Per-turn the engine REBUILDS memory
// from the session's transcript window (no separate persisted store) — the transcript
// IS the durable substrate, so a wide window + ms→seconds conversion gives long-range
// recall without a parallel cache to keep in sync.
//
// ROLLOUT POSTURE (release 2026-06-07c):
//   • DEFAULT OFF in production — a new resolver on the live answer path is opt-in
//     until live-soaked. When OFF, the proven single-prior-turn FollowUpResolver +
//     transcript-window extractor path is used UNCHANGED (zero risk to current users).
//   • DEFAULT ON for internal/dev/test/benchmark — so CI + the live-session-memory
//     benchmark exercise the wired path.
//   • GRADUAL ROLLOUT: a percentage gate (0–100) with DETERMINISTIC per-session
//     bucketing — the same session id is always in or out of the rollout, so a user's
//     experience is stable within a session. Percent unset → no percentage gating
//     (falls through to the env/settings/default decision).
//   • EMERGENCY KILL SWITCH overrides everything (env or settings) → force OFF.
//
// Decision precedence (highest first):
//   1. KILL SWITCH on            → OFF (no override)
//   2. env override on/off       → that value (subject to the rollout gate for "on"-by-default)
//   3. settings opt-in true/false→ that value
//   4. internal/dev/test/bench   → ON
//   5. rollout percent           → bucketed ON/OFF (production gradual rollout)
//   6. default                   → OFF
//
// Reads defensively (never throws). Privacy: this module only reads config — it
// never touches resume/JD/transcript content. Logs are MARKER-ONLY.

export interface LiveSessionMemoryRolloutConfig {
  /** Final decision for this session. */
  enabled: boolean;
  /** Why (marker for telemetry — no raw content). */
  reason: 'kill_switch' | 'env_on' | 'env_off' | 'settings_on' | 'settings_off'
    | 'internal_context' | 'rollout_in' | 'rollout_out' | 'default_off' | 'default_on';
  /** The rollout percent in effect (0–100), or null when not gating by percent. */
  rolloutPercent: number | null;
  /** The session's deterministic bucket (0–99) when percentage gating applies. */
  bucket: number | null;
  /** Bounded memory item cap. */
  maxItems: number;
  /** Marker-only debug logging on? */
  debugMarkersOnly: boolean;
  /** Kill switch engaged? */
  killSwitch: boolean;
}

let cachedEnv: 'on' | 'off' | null | undefined; // undefined = not read; null = no override

function readEnvOverride(): 'on' | 'off' | null {
  if (cachedEnv !== undefined) return cachedEnv ?? null;
  let result: 'on' | 'off' | null = null;
  try {
    const v = (process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY || '').trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'on' || v === 'enabled') result = 'on';
    else if (v === '0' || v === 'false' || v === 'off' || v === 'disabled') result = 'off';
  } catch { result = null; }
  cachedEnv = result;
  return result;
}

/** Emergency kill switch (env or settings) — overrides everything to OFF. */
function killSwitchEngaged(): boolean {
  try {
    const v = (process.env.NATIVELY_LIVE_SESSION_MEMORY_KILL_SWITCH || '').trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'on' || v === 'enabled') return true;
  } catch { /* ignore */ }
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    if (SettingsManager.getInstance().get('liveSessionMemoryKillSwitch') === true) return true;
  } catch { /* settings unavailable */ }
  return false;
}

/** Is this an internal/dev/test/benchmark context (default-ON contexts)? */
function isInternalContext(): boolean {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return true;
    if (process.env.BENCHMARK_MODEL) return true; // any benchmark run
    if (process.env.NATIVELY_INTERNAL === '1' || process.env.NATIVELY_DEV === '1') return true;
  } catch { /* default false */ }
  return false;
}

/** The configured rollout percent (0–100), or null when unset/invalid (no gating). */
function rolloutPercent(): number | null {
  try {
    const raw = process.env.NATIVELY_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT;
    if (raw == null || raw.trim() === '') {
      const { SettingsManager } = require('../services/SettingsManager');
      const sv = SettingsManager.getInstance().get('liveSessionMemoryRolloutPercent');
      if (typeof sv === 'number' && Number.isFinite(sv)) return Math.max(0, Math.min(100, Math.floor(sv)));
      return null;
    }
    const v = parseInt(raw, 10);
    if (Number.isFinite(v)) return Math.max(0, Math.min(100, v));
  } catch { /* ignore */ }
  return null;
}

/**
 * Deterministic bucket 0–99 for a session id (stable for the same id, uniformly
 * distributed). A simple FNV-1a hash mod 100 — no crypto needed, no PII stored (we
 * hash the id, never log it). Empty id → bucket 0 (consistent).
 */
export function sessionBucket(sessionId: string | undefined | null): number {
  const s = String(sessionId ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/**
 * Resolve the FULL rollout decision for a session. `sessionId` enables deterministic
 * percentage bucketing; omit it for a context-only decision (env/settings/default).
 */
export function resolveLiveSessionMemoryConfig(sessionId?: string): LiveSessionMemoryRolloutConfig {
  const maxItems = liveSessionMemoryMaxItems();
  const debugMarkersOnly = liveSessionMemoryDebug();
  const kill = killSwitchEngaged();
  const base: Omit<LiveSessionMemoryRolloutConfig, 'enabled' | 'reason' | 'rolloutPercent' | 'bucket'> = {
    maxItems, debugMarkersOnly, killSwitch: kill,
  };

  // 1. Kill switch wins outright.
  if (kill) return { ...base, enabled: false, reason: 'kill_switch', rolloutPercent: null, bucket: null };

  // 2. Explicit env override.
  const env = readEnvOverride();
  if (env === 'off') return { ...base, enabled: false, reason: 'env_off', rolloutPercent: null, bucket: null };
  if (env === 'on') return { ...base, enabled: true, reason: 'env_on', rolloutPercent: null, bucket: null };

  // 3. Settings opt-in.
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    const v = SettingsManager.getInstance().get('enableLiveSessionMemory');
    if (v === true) return { ...base, enabled: true, reason: 'settings_on', rolloutPercent: null, bucket: null };
    if (v === false) return { ...base, enabled: false, reason: 'settings_off', rolloutPercent: null, bucket: null };
  } catch { /* settings unavailable */ }

  // 4. Internal/dev/test/benchmark → ON.
  if (isInternalContext()) return { ...base, enabled: true, reason: 'internal_context', rolloutPercent: null, bucket: null };

  // 5. Percentage rollout (production gradual rollout).
  const pct = rolloutPercent();
  if (pct != null) {
    if (pct <= 0) return { ...base, enabled: false, reason: 'rollout_out', rolloutPercent: pct, bucket: null };
    if (pct >= 100) return { ...base, enabled: true, reason: 'rollout_in', rolloutPercent: pct, bucket: null };
    // A partial rollout needs a session id to bucket deterministically. Without one,
    // default OFF (don't lump all id-less sessions into one bucket and skew the
    // cohort) — code-review 2026-06-07c.
    if (!String(sessionId ?? '').trim()) {
      return { ...base, enabled: false, reason: 'rollout_out', rolloutPercent: pct, bucket: null };
    }
    const bucket = sessionBucket(sessionId);
    const inRollout = bucket < pct;
    return { ...base, enabled: inRollout, reason: inRollout ? 'rollout_in' : 'rollout_out', rolloutPercent: pct, bucket };
  }

  // 6. Default ON (PI v3, W6d). The live SessionMemory shipped behind a
  // default-OFF flag (2026-06-07c) and has since been validated: 50-session/
  // 132-check live replay 100% with 0 context leaks + 1240-test suite green.
  // Long-range follow-up recall is now part of the core answer quality
  // contract, so production defaults ON. EVERY override above still wins:
  // kill switch → env → settings(false) → percentage rollout(0) all force OFF.
  return { ...base, enabled: true, reason: 'default_on', rolloutPercent: null, bucket: null };
}

/**
 * True when the LIVE hot path should use SessionMemory for follow-up resolution.
 * `sessionId` (optional) enables deterministic per-session percentage bucketing.
 */
export function isLiveSessionMemoryEnabled(sessionId?: string): boolean {
  return resolveLiveSessionMemoryConfig(sessionId).enabled;
}

/** Max items kept in a live SessionMemory (bounded to prevent unbounded growth). */
export function liveSessionMemoryMaxItems(): number {
  try {
    const v = parseInt(process.env.NATIVELY_SESSION_MEMORY_MAX_ITEMS || '', 10);
    if (Number.isFinite(v) && v >= 20 && v <= 2000) return v;
  } catch { /* default */ }
  return 200;
}

/** Whether to emit (redaction-safe, marker-only) session-memory debug logs. */
export function liveSessionMemoryDebug(): boolean {
  try { return (process.env.NATIVELY_SESSION_MEMORY_DEBUG || '').trim().toLowerCase() === 'true'; }
  catch { return false; }
}

/** Test-only: reset the cached env read. */
export function __resetLiveSessionMemoryCache(): void { cachedEnv = undefined; }
