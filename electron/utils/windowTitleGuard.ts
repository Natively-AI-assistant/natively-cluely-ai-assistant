// While undetectable, the renderer's HTML <title> ("Natively") must not own the
// window title — a proctor enumerating window titles would read the brand. The
// page loads async (after createWindow), and Electron's default page-title-updated
// behaviour pushes the <title> into the window title, clobbering the disguise set
// by _applyDisguise. This guard prevents that default and re-asserts the disguise
// title, so the window title stays the disguise name for the whole session.
//
// In normal mode the guard is inert: the page title "Natively" is the expected
// title there, so we let it through.
//
// Pure (no electron import) so it can be unit-tested in bare `node --test`. The
// state is read through getters at EVENT time (not attach time), so a mid-session
// undetectable toggle is honoured without re-attaching.

export interface PageTitleGuardDeps {
  /** Current undetectable state, read when the page title changes. */
  isUndetectable: () => boolean;
  /** The disguise window title to re-assert (e.g. "Activity Monitor"). */
  disguiseTitle: () => string;
  /** Apply the title to the owning window (caller no-ops if destroyed). */
  setTitle: (title: string) => void;
}

export function createPageTitleGuard(deps: PageTitleGuardDeps) {
  return (event: { preventDefault: () => void }): void => {
    if (!deps.isUndetectable()) return;
    event.preventDefault();
    deps.setTitle(deps.disguiseTitle());
  };
}
