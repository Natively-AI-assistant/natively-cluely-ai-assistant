/**
 * Bookkeeping for which global shortcuts the OS refused.
 *
 * Split out of KeybindManager so the rules below are testable without an
 * Electron runtime — KeybindManager imports `electron` at module scope, so it
 * cannot be loaded under `node --test`. Same shape as toggleStateReducer.ts.
 *
 * Why this state exists at all: registration failures are pushed to renderers
 * over IPC, but the first registration pass runs from KeybindManager's
 * constructor, before any BrowserWindow exists. Those pushes reach nobody. A
 * renderer mounting later has to be able to ask what the current situation is,
 * which means the outcome of every attempt has to be retained, not just
 * announced.
 */

/** Failing keybind id -> the accelerator that could not be registered. */
export type KeybindRegistrationFailures = Readonly<Record<string, string>>;

export const NO_REGISTRATION_FAILURES: KeybindRegistrationFailures = Object.freeze({});

/**
 * Folds one register() outcome into the failure set.
 *
 * Success deletes rather than merely skipping: an id that failed earlier and
 * registers now must stop being reported, otherwise the user is told to rebind
 * a shortcut that already works. That is the health-check recovery path.
 */
export function recordRegistrationOutcome(
    state: KeybindRegistrationFailures,
    id: string,
    accelerator: string,
    ok: boolean,
): KeybindRegistrationFailures {
    if (ok) {
        if (!(id in state)) return state;
        const next = { ...state };
        delete next[id];
        return next;
    }

    if (state[id] === accelerator) return state;
    return { ...state, [id]: accelerator };
}

/**
 * The starting point for a full re-registration pass.
 *
 * Entries for ids this pass WILL attempt are dropped: the pass is about to
 * re-derive them, and keeping a stale verdict would race the fresh one.
 *
 * Entries for ids the pass will NOT attempt are KEPT. This is the load-bearing
 * half. registerGlobalShortcuts() skips every id shouldRegister() rejects, and
 * in launcher mode that is all of chat:* — so clearing unconditionally meant a
 * chat shortcut that genuinely lost its accelerator to another app had its
 * recorded failure erased the moment the user returned to the launcher. That is
 * exactly where Settings is opened, i.e. exactly when the renderer asks for the
 * snapshot, so the conflict badge could never appear for the shortcuts most
 * likely to be conflicted.
 *
 * A conflict is a property of the OS and the other app, not of which mode
 * Natively happens to be in. When a pass does not re-test an id, the last
 * verdict we actually observed is the best answer available, and it is the
 * answer the user needs while they are in Settings trying to fix it.
 *
 * @param isAttempted Predicate matching registerGlobalShortcuts()'s own filter:
 *                    true when this pass will call register() for that id.
 *                    Omitted (the default) means "attempts everything", which
 *                    reproduces the old clear-all behaviour.
 */
export function beginFullRegistrationPass(
    state: KeybindRegistrationFailures = NO_REGISTRATION_FAILURES,
    isAttempted: (id: string) => boolean = () => true,
): KeybindRegistrationFailures {
    const retained: Record<string, string> = {};
    let kept = 0;
    for (const id of Object.keys(state)) {
        if (isAttempted(id)) continue;
        retained[id] = state[id];
        kept++;
    }
    return kept === 0 ? NO_REGISTRATION_FAILURES : retained;
}

/** Wire format for the renderer: a stable, sorted list of `{ id, accelerator }`. */
export function listRegistrationFailures(
    state: KeybindRegistrationFailures,
): { id: string; accelerator: string }[] {
    return Object.keys(state)
        .sort()
        .map(id => ({ id, accelerator: state[id] }));
}
