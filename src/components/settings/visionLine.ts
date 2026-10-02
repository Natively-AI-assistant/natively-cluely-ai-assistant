// What the "Reads images" line under a model row says (Settings › AI Providers).
// Pure, and on its own so it can be run by a test: the component file is JSX.
import type { VisionModelState } from '../../types/electron';

/** What "Auto" means for this model right now, as one short line. */
export function visionAutoText(state: VisionModelState, t: (text: string) => string): string {
    if (state.checking) return t('Checking…');
    // The provider could not be asked just now (no credit, rate limit, down).
    // No code and no provider text: nothing here is the user's to fix.
    if (state.inconclusive) return t('Could not test just now · try again later');
    const { reads, source } = state.auto;
    if (reads === 'unknown') return state.testable ? t('Not known yet · tested when you select it') : t('Not known');
    if (source === 'test') return reads === 'yes' ? t('Yes · tested') : t('No · tested');
    if (source === 'provider') return reads === 'yes' ? t('Yes · reported by the provider') : t('No · reported by the provider');
    return reads === 'yes' ? t('Yes') : t('No');
}

/** The whole status: what Auto says, or — when the user answered — what Auto would have said. */
export function visionStatusText(state: VisionModelState, t: (text: string) => string): string {
    const auto = visionAutoText(state, t);
    return state.setting === 'auto' ? auto : `${t('Auto would say')}: ${auto}`;
}

/**
 * Is the status line the answer in force? Only on Auto with a settled yes or
 * no. A running test, a test that could not finish, "not known", and "Auto
 * would say …" under the user's own On or Off are not: they are drawn quieter.
 */
export function visionAnswerInForce(state: VisionModelState): boolean {
    return state.setting === 'auto' && !state.checking && !state.inconclusive && state.auto.reads !== 'unknown';
}

/**
 * The rows as shown: main's answers, with "the last test could not finish" laid
 * over the ids it is still true for. The list has to remember that itself — main
 * re-reads every state on any change and knows nothing of it. But it stops being
 * true once a test is running again, or once one has since SETTLED: when a
 * re-test cannot finish main forgets the old result, so a tested answer seen
 * afterwards is a newer one (the model was picked and tested in the background).
 * Without that the line went on saying "Could not test just now" over an answer
 * it now had.
 *
 * Not covered: a model the provider's own list answers for keeps that source
 * after a passed test, so a test that settles while this window is not looking
 * (no "Checking…" seen) leaves the note up until the row is clicked again.
 */
export function visionStatesShown(
    states: Record<string, VisionModelState | null>,
    inconclusive: ReadonlySet<string>,
): Record<string, VisionModelState | null> {
    if (inconclusive.size === 0) return states;
    const out: Record<string, VisionModelState | null> = { ...states };
    for (const id of inconclusive) {
        const s = out[id];
        if (s && !s.checking && s.auto.source !== 'test') out[id] = { ...s, inconclusive: true };
    }
    return out;
}

/**
 * The same rule, for the note itself: which ids are still "could not finish"
 * after main's answers were read again. Laying the note over the states only
 * hid it — a tested answer that later stopped applying (a self-hosted
 * provider's address changed) brought the old note back. Returns the same set
 * when nothing is dropped, so a state setter can bail out.
 */
export function visionNotesKept(
    inconclusive: ReadonlySet<string>,
    states: Record<string, VisionModelState | null>,
): ReadonlySet<string> {
    let kept: Set<string> | null = null;
    for (const id of inconclusive) {
        const s = states[id];
        if (s && (s.checking || s.auto.source === 'test')) (kept ??= new Set(inconclusive)).delete(id);
    }
    return kept ?? inconclusive;
}
