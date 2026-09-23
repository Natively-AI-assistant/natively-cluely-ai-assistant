/**
 * True unless `next` is a full PhoneMirrorInfo snapshot (carries the resolved
 * `port` + `bindAddress`). The launcher-side `phone-mirror:status` broadcast is
 * a flag subset and reports partial.
 */
export function isPartialPhoneMirrorStatus(next: unknown): boolean;

/**
 * Fold a `phone-mirror:status` broadcast into the current PhoneMirrorInfo.
 * Full snapshot → replaces (or keeps `prev` when nothing the UI keys on
 * changed). Partial flag subset → only the flags it carries are laid over
 * `prev`. Returns `prev` itself when nothing changed.
 */
export function mergePhoneMirrorStatus<T extends Record<string, any>>(prev: T, next: unknown): T;
