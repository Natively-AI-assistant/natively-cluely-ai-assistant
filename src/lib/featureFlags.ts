/**
 * Frontend Feature Flags
 *
 * Premium features are gated on the backend via electronAPI IPC calls.
 * This file provides an optional compile-time switch to completely
 * hide premium UI elements from the source-available build.
 *
 * All premium components already degrade gracefully when the backend
 * returns `false` for license checks, so this flag is primarily
 * for cosmetic control (hiding upgrade buttons, promo toasters, etc.).
 */

export const FEATURES = {
  /** Set to false to completely hide premium UI elements */
  PREMIUM_ENABLED: true,
} as const;
