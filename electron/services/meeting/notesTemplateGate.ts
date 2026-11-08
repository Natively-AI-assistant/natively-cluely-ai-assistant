/**
 * The Pro gate on "Regenerate as" (2026-10-15), lifted out of the
 * regenerate-meeting-summary handler unchanged so the template picker on the
 * meeting page can be tested against it.
 *
 * Regenerating AS another template is the same gate as switching to that mode
 * (modes:set-active): a non-general template needs Pro or a live trial, and the
 * notes must not be a side door to it. A plain regenerate (no override) keeps
 * the meeting's own mode and is never gated. An unknown mode id is gated like
 * any non-general one.
 *
 * Note templates (noteTemplates.ts, 2026-10-20) are gated the same way: writing
 * the notes in one needs Pro or a live trial, whether picked for the running
 * meeting or for a regenerate. Clearing one (null) is never gated.
 *
 * Platform-independent.
 */

export interface RegenerateTarget {
    modeId?: string;
    templateType?: string;
    /** A note template id; null asks for the notes without one. */
    noteTemplateId?: string | null;
}

/**
 * 'pro_required' when this regenerate is refused, else null.
 * `templateOfMode` resolves a mode id to its template type (ModesManager);
 * it may throw or return undefined.
 */
export function regenerateGate(
    target: RegenerateTarget,
    deps: { templateOfMode: (modeId: string) => string | undefined; isProOrTrialActive: () => boolean },
): 'pro_required' | null {
    const { modeId, templateType, noteTemplateId } = target ?? {};
    if (noteTemplateGate(noteTemplateId, deps.isProOrTrialActive)) return 'pro_required';
    if (!modeId && !templateType) return null;
    let resolved = templateType;
    try {
        if (modeId) resolved = deps.templateOfMode(modeId) ?? resolved;
    } catch { /* resolve best-effort; an unknown mode is gated like any non-general one */ }
    if (resolved !== 'general' && !deps.isProOrTrialActive()) return 'pro_required';
    return null;
}

/** 'pro_required' when a note template may not be used; null (clearing) and absent never are. */
export function noteTemplateGate(noteTemplateId: string | null | undefined, isProOrTrialActive: () => boolean): 'pro_required' | null {
    if (typeof noteTemplateId !== 'string' || !noteTemplateId) return null;
    return isProOrTrialActive() ? null : 'pro_required';
}
