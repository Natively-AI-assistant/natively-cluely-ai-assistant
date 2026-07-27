import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_DEBOUNCE_MS = 500;

export interface UseApiKeyAutoSaveOptions {
  /** Delay after the last edit before persisting. Default 500ms. */
  debounceMs?: number;
  /** When false, timers are cleared and autosave is disabled. Default true. */
  enabled?: boolean;
  /** Return false to skip autosave (empty, masked placeholders, etc.). */
  shouldSave?: (value: string) => boolean;
}

/**
 * Debounced autosave for API-key (and similar secret) inputs.
 *
 * Fires after idle, on blur, and on unmount so closing Settings never drops
 * a key the user already typed.
 *
 * Dedupes by value: once a given string has been handed to `onSave`, it will
 * not fire again until the input changes. That stops the common loop where
 * `enabled` flips false→true after a save badge timeout while the field still
 * holds the same key (STT keys used to thrash test-stt-connection forever).
 */
export function useApiKeyAutoSave(
  value: string,
  onSave: () => void | Promise<void>,
  options?: UseApiKeyAutoSaveOptions,
): { onBlur: () => void; flush: () => void } {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const enabled = options?.enabled ?? true;
  const shouldSave =
    options?.shouldSave ?? ((v: string) => v.trim().length > 0);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const shouldSaveRef = useRef(shouldSave);
  shouldSaveRef.current = shouldSave;
  const valueRef = useRef(value);
  valueRef.current = value;
  /** True while a debounce timer is outstanding (used for unmount flush). */
  const pendingRef = useRef(false);
  const inFlightRef = useRef(false);
  /**
   * Greptile: when a save is requested while another is in flight, remember to
   * run again after the in-flight save finishes so the latest value is not dropped.
   */
  const queuedRef = useRef(false);
  /** Last value passed to onSave — skip identical re-fires when enabled toggles. */
  const lastAttemptedRef = useRef<string | null>(null);

  const runSave = useCallback(() => {
    const v = valueRef.current;
    if (!shouldSaveRef.current(v)) return;
    if (lastAttemptedRef.current === v) return;
    if (inFlightRef.current) {
      // Trailing-edge: keep the newest value for a follow-up pass.
      queuedRef.current = true;
      return;
    }
    inFlightRef.current = true;
    queuedRef.current = false;
    lastAttemptedRef.current = v;
    Promise.resolve(onSaveRef.current())
      .catch((err) => console.error('[useApiKeyAutoSave]', err))
      .finally(() => {
        inFlightRef.current = false;
        if (queuedRef.current) {
          queuedRef.current = false;
          // Re-enter with the latest valueRef (may have changed during the flight).
          runSave();
        }
      });
  }, []);

  const flush = useCallback(() => {
    pendingRef.current = false;
    runSave();
  }, [runSave]);

  // Clearing the field resets the dedupe gate so the same key can be entered again.
  useEffect(() => {
    if (!value.trim()) {
      lastAttemptedRef.current = null;
    }
  }, [value]);

  // Debounce whenever the value changes. shouldSave is read via ref so an
  // inline predicate from the caller doesn't reset the timer every render.
  // `enabled` only gates; becoming true again must not re-save an unchanged value.
  useEffect(() => {
    if (!enabled || !shouldSaveRef.current(value)) {
      pendingRef.current = false;
      return;
    }
    if (lastAttemptedRef.current === value) {
      pendingRef.current = false;
      return;
    }
    pendingRef.current = true;
    const timer = setTimeout(() => {
      pendingRef.current = false;
      runSave();
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [value, enabled, debounceMs, runSave]);

  // Flush a pending debounce on unmount (registered after the debounce effect
  // so this cleanup runs first and still sees pendingRef === true).
  // Must go through runSave() so in-flight + queued trailing-edge still apply.
  useEffect(
    () => () => {
      if (pendingRef.current || queuedRef.current) {
        pendingRef.current = false;
        runSave();
      }
    },
    [runSave],
  );

  const onBlur = useCallback(() => {
    if (enabled && shouldSaveRef.current(valueRef.current)) {
      flush();
    }
  }, [enabled, flush]);

  return { onBlur, flush };
}
