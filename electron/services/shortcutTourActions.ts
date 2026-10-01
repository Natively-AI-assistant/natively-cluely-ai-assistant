// The global shortcuts the first-launch tour teaches (src/components/onboarding/
// ShortcutTour.tsx). While the tour is up, AppState routes exactly these to the
// tour's renderer as practice presses instead of running them.
//
// Its own module, not a field in main.ts: GlobalShortcutTargeting.test.mjs
// locates the real 'chat:whatToAnswer' dispatch by the first occurrence of the
// literal in main.ts, and a second one earlier in the file would move that
// window onto the wrong code.
export const SHORTCUT_TOUR_ACTIONS: ReadonlySet<string> = new Set([
  'general:toggle-visibility',
  'general:take-screenshot',
  'chat:whatToAnswer',
]);
