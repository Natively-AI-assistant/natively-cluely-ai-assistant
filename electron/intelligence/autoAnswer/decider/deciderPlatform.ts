/**
 * Platform-dependent choices for the local decider, behind an injected platform (CLAUDE.md:
 * never mutate `process.platform`; test both branches).
 *
 * ── Execution providers ───────────────────────────────────────────────────────────────────────
 * onnxruntime-node 1.22 (the app's runtime) ships:
 *   win32 x64 / arm64  DirectML.dll beside onnxruntime.dll   → 'dml' is loadable
 *   darwin arm64 / x64 libonnxruntime.1.22.0.dylib           → CoreML EP, when built in
 *
 * DEFAULTS ARE CPU ON BOTH, by measurement, not by assumption:
 *   darwin  Phase 0 (2026-11-09, M4 Air, zero-shot Laya, results/ledger.jsonl): the CoreML EP's
 *           MLProgram format failed to build (error -7) and the NeuralNetwork format split the
 *           graph into 92-277 partitions, p50 356-1839 ms against int8 CPU's ~216-243 ms.
 *           CoreML is opt-in (NATIVELY_DECIDER_EP=coreml) until a fine-tuned re-export
 *           measures faster.
 *   win32   DirectML is unmeasured on any Windows machine (decision D2 is pending). It stays
 *           opt-in (NATIVELY_DECIDER_EP=dml) until the Windows bench reports it.
 * An EP that fails to initialise falls back to the next in the list; CPU is always last.
 *
 * ── Threads ───────────────────────────────────────────────────────────────────────────────────
 * The app's ONNX default is 1 intra-op thread, sized for MiniLM-class models. Laya-large at 1
 * thread is several times slower than the ~300 ms p90 measured at 4. Half the logical cores,
 * capped at 4: measured on the M4, 4 threads p90 316-319 ms, and the default 10 (efficiency
 * cores included) was slower at p90 439 ms.
 */

export type DeciderMode = 'off' | 'shadow' | 'on';

/**
 * NATIVELY_AUTO_ANSWER_DECIDER = off | shadow | on. Default: `shadow` in development, `off` in a
 * packaged build until the cutover gate (Phase 7) is passed and Evin approves. Changing the
 * packaged default is a stop-and-ask item (campaign rule 6).
 */
export function resolveDeciderMode(env: Record<string, string | undefined>, isPackaged: boolean): DeciderMode {
    const raw = (env.NATIVELY_AUTO_ANSWER_DECIDER ?? '').trim().toLowerCase();
    if (raw === 'off' || raw === 'shadow' || raw === 'on') return raw;
    return isPackaged ? 'off' : 'shadow';
}

export type DeciderEp = 'cpu' | 'coreml' | 'dml';

/** The ordered EP list for the decider session. Throws on a platform Natively does not support. */
export function executionProvidersFor(platform: NodeJS.Platform, env: Record<string, string | undefined> = {}): DeciderEp[] {
    const wanted = (env.NATIVELY_DECIDER_EP ?? '').trim().toLowerCase();
    switch (platform) {
        case 'darwin':
            return wanted === 'coreml' ? ['coreml', 'cpu'] : ['cpu'];
        case 'win32':
            return wanted === 'dml' || wanted === 'directml' ? ['dml', 'cpu'] : ['cpu'];
        default:
            throw new Error(`Unsupported platform for the Auto Answer decider: ${platform}`);
    }
}

/** onnxruntime-node `executionProviders` entries for the list above. */
export function ortExecutionProviders(eps: DeciderEp[]): Array<string | Record<string, unknown>> {
    return eps.map((ep) => {
        if (ep === 'coreml') return { name: 'coreml', coreMlFlags: 0 };
        if (ep === 'dml') return { name: 'dml' };
        return 'cpu';
    });
}

export function deciderIntraOpThreads(logicalCores: number, env: Record<string, string | undefined> = {}): number {
    const override = Number.parseInt(env.NATIVELY_DECIDER_THREADS ?? '', 10);
    if (Number.isFinite(override) && override > 0) return override;
    return Math.max(1, Math.min(4, Math.floor((logicalCores || 2) / 2)));
}
