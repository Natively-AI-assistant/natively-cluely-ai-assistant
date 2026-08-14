// triggerGate.ts
// Pure predicate for the "What to answer" trigger cooldown.
//
// The cooldown exists ONLY to rate-limit the AUTOMATIC speculative pre-fetch so
// it does not spam the LLM on every interviewer partial. It must NEVER silence
// an explicit user action (manual hotkey / button press, or an image attach).
//
// P0 this guards against: the speculative system continuously refreshes
// `lastTriggerTime` on every interviewer question (IntelligenceEngine stamps it
// on every speculative completion). Once a conversation is flowing the
// interviewer talks constantly, so a user's manual hotkey press — which they
// naturally make right after the interviewer's question — lands inside the
// cooldown window the speculation just refreshed and the engine returns null.
// The symptom: "What to answer" works for the first few messages and then
// silently stops responding. Explicit user intent therefore bypasses the gate.

export interface TriggerGateInput {
    /** Whether the call carries attached image(s) — always explicit user intent. */
    hasImages: boolean;
    /** Whether this is an automatic speculative pre-fetch (subject to throttling). */
    isSpeculative: boolean;
    /** Explicit bypass flag (set true for manual hotkey/button presses and tests). */
    skipCooldown: boolean;
    /** Current timestamp (ms). */
    now: number;
    /** Last time any trigger fired (ms). */
    lastTriggerTime: number;
    /** Cooldown window (ms). */
    triggerCooldown: number;
}

/**
 * Returns true when this invocation should be throttled (and the caller should
 * return null without running). Explicit user intent — images, the skipCooldown
 * flag — is never throttled; the speculative pre-fetch reserves its own slot and
 * is likewise never blocked here (it self-throttles before it fires).
 */
export function shouldThrottleTrigger(input: TriggerGateInput): boolean {
    const { hasImages, isSpeculative, skipCooldown, now, lastTriggerTime, triggerCooldown } = input;
    if (hasImages || isSpeculative || skipCooldown) return false;
    return now - lastTriggerTime < triggerCooldown;
}
