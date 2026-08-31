/**
 * Process-wide singletons that survive this repo's bundling.
 *
 * `scripts/build-electron.js` makes EVERY TypeScript file under `electron/`
 * its own esbuild entry point with `bundle: true`. A module imported by three
 * entry points is therefore inlined three times, and its module-level state
 * exists three times over. A plain `let instance` / `getInstance()` singleton
 * would silently become several instances — which, for the extension registry
 * and the licence ledger, means permission and acknowledgement checks answered
 * from the wrong state.
 *
 * Anchoring on `globalThis` gives one instance per PROCESS regardless of how
 * many bundles inlined this file. Same approach as the context-debug registry.
 */

const NAMESPACE = '__nativelyExtensionSingletons__';

type Store = Map<string, unknown>;

function store(): Store {
  const g = globalThis as unknown as Record<string, unknown>;
  let existing = g[NAMESPACE] as Store | undefined;
  if (!existing) {
    existing = new Map<string, unknown>();
    g[NAMESPACE] = existing;
  }
  return existing;
}

/** Get the process-wide instance for `key`, creating it once. */
export function processSingleton<T>(key: string, create: () => T): T {
  const s = store();
  if (!s.has(key)) s.set(key, create());
  return s.get(key) as T;
}

/**
 * Replace the process-wide instance for `key` unconditionally.
 *
 * `processSingleton` ignores its factory when the key already exists, so
 * "reset then create" is not a setter — it silently keeps the old value if
 * anything repopulates the key in between. App wiring needs a real assignment.
 */
export function setProcessSingleton<T>(key: string, value: T): void {
  store().set(key, value);
}

/** Drop a singleton. Tests only — lets each test start from a clean instance. */
export function resetProcessSingleton(key: string): void {
  store().delete(key);
}
