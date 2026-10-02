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
