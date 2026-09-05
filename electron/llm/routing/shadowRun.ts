// electron/llm/routing/shadowRun.ts
//
// Log what the router WOULD have decided, beside what the shipped classifier
// actually decided, on the same turn.
//
// This is the evidence PR 11 needs before MobileBERT and the legacy Answer
// Shape table can be removed. A benchmark on a generated corpus says the model
// is better on rows a generator wrote. It cannot say the model is better on
// this user's turns, and those are the only ones that matter.
//
// IT MUST NOT COST THE LIVE TURN ANYTHING.
//
// The router takes about 18ms round-trip. Adding that to a turn to collect data
// the user does not benefit from would be paying for the experiment with their
// latency. So the comparison is fired and forgotten: the live turn has already
// been decided and dispatched by the time this runs, and nothing here is
// awaited on the hot path.
//
// It also must not be able to break a turn. Every failure is swallowed, and
// a shadow comparison that throws records nothing rather than propagating.

import { piTelemetry } from '../piTelemetry';
import { RouterModel } from './RouterModel';
import { toLegacyIntent } from './legacyShim';
import type { LegacyIntent } from './legacyShim';

export const SHADOW_ENV_KEY = 'NATIVELY_ROUTER_SHADOW';

/**
 * Shadow logging is separate from the router flag, and both default off.
 *
 * They are separate because they answer different questions and carry different
 * risk. The router flag changes what the user gets. Shadow logging changes
 * nothing the user sees and only writes telemetry, so it can run for two weeks
 * on a build where the router itself is still off. That ordering is the point:
 * collect the evidence first, act on it second.
 */
export function isShadowRunEnabled(): boolean {
    const raw = process.env[SHADOW_ENV_KEY];
    if (raw == null || raw === '') return false;
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export interface ShadowInput {
    turn: string;
    mode: string;
    channel: string;
    history: string[];
    modeHasReferenceFiles: boolean;
    /** What the shipped three-tier classifier actually returned for this turn. */
    legacyIntent: string;
    legacyConfidence: number;
    /** Whether the live turn ended in a silence sentinel. */
    liveWasSilent: boolean;
    surface: 'speculative' | 'manual';
}

/**
 * Compare and record. Never awaited by the caller, never throws.
 *
 * Returns a promise only so tests can await it; the live path calls it with
 * `void` and moves on.
 */
export async function recordShadowDecision(input: ShadowInput): Promise<void> {
    if (!isShadowRunEnabled()) return;
    try {
        const router = RouterModel.getInstance();
        // The shadow run needs the router even when the ROUTER flag is off,
        // which is the whole point of the two flags being separate. `true`
        // is passed as the persisted preference to say "for this call, treat it
        // as enabled", without touching what the user's build actually does.
        if (!router.isAvailable(true)) return;

        const started = Date.now();
        const pred = await router.classify({
            turn: input.turn,
            mode: input.mode,
            channel: input.channel,
            history: input.history,
            modeHasReferenceFiles: input.modeHasReferenceFiles,
        }, { persistedFlag: true, timeoutMs: 250 });
        const elapsed = Date.now() - started;

        if (!pred) {
            piTelemetry.emit('router_shadow_turn', {
                mode: input.mode,
                surface: input.surface,
                outcome: 'no_opinion',
                legacy_intent: input.legacyIntent,
                live_was_silent: input.liveWasSilent,
                elapsed_ms: elapsed,
            });
            return;
        }

        // The frame the router would have handed the TurnPlanner, mapped down
        // through the same shim production would use, so the comparison is
        // against what would actually have shipped rather than against a raw
        // axis a prompt never sees.
        const mapped = toLegacyIntent({
            task: pred.needs_response === 'no' ? 'none' : 'answer',
            answer_form: 'explanation',
            mode_intent: '',
            confidence: pred.confidence as Record<string, number>,
        });

        const routerWouldSilence = pred.needs_response === 'no';

        piTelemetry.emit('router_shadow_turn', {
            mode: input.mode,
            surface: input.surface,
            outcome: 'compared',

            // The axis the decision turns on.
            router_needs_response: pred.needs_response,
            router_dialogue_act: pred.dialogue_act,
            router_confidence: Number((pred.confidence?.needs_response ?? 0).toFixed(3)),

            // What actually happened on this turn.
            live_was_silent: input.liveWasSilent,

            // The four cells that matter. `agree_silent` is a generation the
            // router would have saved. `router_would_speak` is one it would
            // have added, and that is the number that decides whether this is
            // safe, because it is the user losing an answer they got today.
            cell: routerWouldSilence === input.liveWasSilent
                ? (routerWouldSilence ? 'agree_silent' : 'agree_answer')
                : (routerWouldSilence ? 'router_would_silence' : 'router_would_speak'),

            // The legacy comparison, for the Answer Shape table's removal.
            legacy_intent: input.legacyIntent,
            legacy_confidence: Number((input.legacyConfidence ?? 0).toFixed(3)),
            shim_intent: mapped.intent as LegacyIntent,
            shim_ambiguous: mapped.ambiguous,
            shim_via: mapped.via,
            legacy_agrees: mapped.intent === input.legacyIntent,

            elapsed_ms: elapsed,
        });
    } catch {
        // A shadow comparison that throws records nothing. It never reaches the
        // turn it was observing.
    }
}
