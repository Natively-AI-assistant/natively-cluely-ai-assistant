/**
 * App wiring for the decision cascade (campaign Phase 4.6). main.ts passes its existing LLM judge
 * hook and gets back a drop-in replacement for the engine's `judgeCandidate`.
 *
 * Mode: NATIVELY_AUTO_ANSWER_DECIDER (deciderPlatform.resolveDeciderMode) — shadow in
 * development, OFF in a packaged build. In `off` the returned hook calls the LLM judge exactly as
 * before; nothing else runs and no worker is created.
 *
 * Model: NATIVELY_DECIDER_MODEL_DIR for now (a directory per deciderManifest.ts). Phase 6 replaces
 * it with the verified download under userData. With no model, shadow is the judge alone.
 *
 * Telemetry goes to TelemetryService, the path the engine's own auto_answer_* events take (enums,
 * numbers and booleans, never text; see AutoAnswerDecider.DeciderTelemetry). Nothing reaches the
 * usage outbox (the Pro operational rows) from here.
 */
import type { JudgeRequest } from '../AutoAnswerJudge';
import type { Clock } from '../AutoAnswerClock';
import { AutoAnswerDecider, type DeciderTelemetry } from './AutoAnswerDecider';
import { createLocalLayaBackend, type LocalLayaBackend } from './LocalLayaBackend';
import { resolveDeciderMode, type DeciderMode } from './deciderPlatform';
import { ESCALATE_ALL, type DecisionBackend } from './DecisionBackend';

export interface AppDeciderOptions {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
    isPackaged: boolean;
    clock: Clock;
    llmJudge: (req: JudgeRequest, signal?: AbortSignal) => Promise<string | null>;
    telemetry?(event: DeciderTelemetry): void;
    /** Tests inject backends; production builds the local one lazily. */
    backends?: () => DecisionBackend[];
}

export interface AppDecider {
    mode: DeciderMode;
    judgeCandidate(req: JudgeRequest, signal?: AbortSignal): Promise<string | null>;
    /** Meeting start: load the model ahead of the first candidate (no-op when off or absent). */
    warmUp(): void;
    dispose(): void;
}

export function createAppDecider(o: AppDeciderOptions): AppDecider {
    const mode = resolveDeciderMode(o.env, o.isPackaged);
    if (mode === 'off') {
        return { mode, judgeCandidate: (req, signal) => o.llmJudge(req, signal), warmUp() {}, dispose() {} };
    }
    let local: LocalLayaBackend | null = null;
    const modelDir = () => (o.env.NATIVELY_DECIDER_MODEL_DIR || '').trim() || null;
    const backends = o.backends ?? (() => {
        if (!modelDir()) return [];
        local ??= createLocalLayaBackend(modelDir, o.platform);
        return [local];
    });
    const decider = new AutoAnswerDecider({
        mode: () => mode,
        backends,
        llmJudge: o.llmJudge,
        thresholds: (kind) => {
            const b = backends().find((x) => x.kind === kind) as (DecisionBackend & { thresholds?: () => typeof ESCALATE_ALL }) | undefined;
            return b?.thresholds?.() ?? ESCALATE_ALL;
        },
        clock: o.clock,
        telemetry: o.telemetry,
    });
    return {
        mode,
        judgeCandidate: (req, signal) => decider.judge(req, signal),
        warmUp: () => { try { for (const b of backends()) b.warmUp?.(); } catch { /* optional */ } },
        dispose: () => { try { local?.dispose(); } catch { /* best effort */ } local = null; },
    };
}
