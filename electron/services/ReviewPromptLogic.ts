// electron/services/ReviewPromptLogic.ts
// Pure prompt-eligibility logic, extracted so it can be unit-tested without
// booting Electron. Both the desktop ReviewService and the renderer-side
// ReviewPromptHost can call these.
//
// The matching backend helper lives in natively-api/reviews.js — keep them
// in sync. (Tested via the review test suite — drift would surface as a
// disagreeing eligibility answer between client and server.)

const PROMPT_FIRST_SESSION_THRESHOLD = 3
const PROMPT_FIRST_USAGE_MS_THRESHOLD = 30 * 60 * 1000
const PROMPT_REDISPLAY_SESSION_THRESHOLD = 3
const PROMPT_REDISPLAY_DELAY_MS = 7 * 24 * 60 * 60 * 1000

export type PromptState = {
    has_reviewed?: boolean
    dismissed_count?: number
    dont_show_again?: boolean
    last_prompted_at?: string | null
    last_dismissed_at?: string | null
    next_eligible_at?: string | null
    session_count?: number
    total_usage_ms?: number
}

export interface EligibilityResult {
    eligible: boolean
    reason: string
    next_eligible_at?: string | null
}

export function shouldShowPromptLocal(state: PromptState | null | undefined, now: number = Date.now()): EligibilityResult {
    if (!state) return { eligible: false, reason: 'no_state' }
    if (state.has_reviewed) return { eligible: false, reason: 'has_reviewed' }
    if (state.dont_show_again) return { eligible: false, reason: 'dont_show_again' }
    if (state.next_eligible_at && new Date(state.next_eligible_at).getTime() > now) {
        return { eligible: false, reason: 'cooldown', next_eligible_at: state.next_eligible_at }
    }
    const sessions = Number(state.session_count) || 0
    const usageMs = Number(state.total_usage_ms) || 0
    if ((state.dismissed_count || 0) === 0) {
        if (sessions >= PROMPT_FIRST_SESSION_THRESHOLD || usageMs >= PROMPT_FIRST_USAGE_MS_THRESHOLD) {
            return { eligible: true, reason: 'first_time_threshold_met' }
        }
        return { eligible: false, reason: 'first_time_threshold_not_met' }
    }
    // Anchor 7-day redisplay to last_dismissed_at (fall back to last_prompted_at
    // for backwards compatibility with state files written before the fix).
    const anchor = state.last_dismissed_at || state.last_prompted_at
    const anchorMs = anchor ? new Date(anchor).getTime() : 0
    const ageMs = anchorMs ? (now - anchorMs) : Number.POSITIVE_INFINITY
    if (ageMs >= PROMPT_REDISPLAY_DELAY_MS) return { eligible: true, reason: 'redisplay_delay_met' }
    if (sessions >= PROMPT_FIRST_SESSION_THRESHOLD + (state.dismissed_count * PROMPT_REDISPLAY_SESSION_THRESHOLD)) {
        return { eligible: true, reason: 'redisplay_sessions_met' }
    }
    return { eligible: false, reason: 'redisplay_threshold_not_met' }
}

export const REVIEW_PROMPT_CONSTANTS = {
    PROMPT_FIRST_SESSION_THRESHOLD,
    PROMPT_FIRST_USAGE_MS_THRESHOLD,
    PROMPT_REDISPLAY_SESSION_THRESHOLD,
    PROMPT_REDISPLAY_DELAY_MS,
}