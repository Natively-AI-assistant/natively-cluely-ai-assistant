export const THEME_CACHE_KEY: 'natively_resolved_theme';
export const THEME_SWITCHING_ATTR: 'data-theme-switching';

export function applyResolvedTheme(
  resolved: 'light' | 'dark',
  options?: {
    /** false snaps (first paint, authoritative re-read). Default: animate. */
    animate?: boolean;
    doc?: Document;
    storage?: Pick<Storage, 'setItem'> | null;
  },
): boolean;

/** Finish every running colour transition in `doc` (flushes pending style first). */
export function settleColourTransitions(doc: Pick<Document, 'getAnimations'>): void;

/** `transitionrun` handler: finish the colour transition the event announces. */
export function settleColourTransition(event: TransitionEvent): void;
