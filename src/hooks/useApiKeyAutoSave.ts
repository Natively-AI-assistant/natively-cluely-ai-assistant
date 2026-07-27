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

  const runSave = useCallback(() => {
    const v = valueRef.current;
    if (!shouldSaveRef.current(v) || inFlightRef.current) return;
    inFlightRef.current = true;
    Promise.resolve(onSaveRef.current())
      .catch((err) => console.error('[useApiKeyAutoSave]', err))
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  const flush = useCallback(() => {
    pendingRef.current = false;
    runSave();
  }, [runSave]);

  // Debounce whenever the value changes. shouldSave is read via ref so an
  // inline predicate from the caller doesn't reset the timer every render.
  useEffect(() => {
    if (!enabled || !shouldSaveRef.current(value)) {
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
  useEffect(
    () => () => {
      if (pendingRef.current) {
        pendingRef.current = false;
        try {
          void Promise.resolve(onSaveRef.current()).catch(() => {});
        } catch {
          /* renderer unmounting */
        }
      }
    },
    [],
  );

  const onBlur = useCallback(() => {
    if (enabled && shouldSaveRef.current(valueRef.current)) {
      flush();
    }
  }, [enabled, flush]);

  return { onBlur, flush };
}
