/**
 * The decider model directory's manifest.json (campaign Phase 3.5). PURE: parse and validate only;
 * the download and sha256 verification belong to Phase 6.
 *
 *   <modelDir>/manifest.json
 *   <modelDir>/<graph>                        e.g. laya.int8.onnx
 *   <modelDir>/tokenizer/tokenizer.json, tokenizer_config.json
 *
 * Written by the export step from the fine-tuned checkpoint: its temperatures, and the per-label
 * thresholds fitted on calib (decision D1). A manifest without valid thresholds parses with
 * ESCALATE_ALL, so a model can be shadow-tested before anyone lets it decide.
 */
import { type DeciderThresholds, ESCALATE_ALL } from './DecisionBackend';
import type { DeciderModelConfig } from './deciderPipeline';

export const DECIDER_MANIFEST_SCHEMA = 1;

export interface DeciderManifest {
    id: string;
    version: string;
    graph: string;
    tokenizerDir: string;
    config: DeciderModelConfig;
    thresholds: DeciderThresholds;
    files: Array<{ path: string; sha256: string; bytes: number }>;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** A relative path inside the model directory: no absolute paths, no `..`, either separator. */
const safeRel = (p: unknown): p is string =>
    typeof p === 'string' && p.length > 0 && !/^([a-zA-Z]:)?[\\/]/.test(p) && !p.split(/[\\/]/).includes('..');

function thresholdsOf(raw: any): DeciderThresholds {
    if (!raw || typeof raw !== 'object') return ESCALATE_ALL;
    const one = (v: unknown) => (isNum(v) && v > 0 && v <= 1 ? v : Infinity);
    return { answer: one(raw.answer), silent: one(raw.silent), wait: one(raw.wait) };
}

/** Throws with a reason on anything the worker could not load safely. */
export function parseDeciderManifest(json: unknown): DeciderManifest {
    const m = json as any;
    if (!m || typeof m !== 'object') throw new Error('manifest: not an object');
    if (m.schema !== DECIDER_MANIFEST_SCHEMA) throw new Error(`manifest: schema ${m.schema} (want ${DECIDER_MANIFEST_SCHEMA})`);
    if (typeof m.id !== 'string' || typeof m.version !== 'string') throw new Error('manifest: id/version');
    if (!safeRel(m.graph)) throw new Error('manifest: graph path');
    const tokenizerDir = m.tokenizer ?? 'tokenizer';
    if (!safeRel(tokenizerDir)) throw new Error('manifest: tokenizer path');
    const maxLen = m.max_len ?? 512;
    const headMaxLen = m.head_max_len ?? 192;
    if (!isNum(maxLen) || !isNum(headMaxLen) || headMaxLen >= maxLen) throw new Error('manifest: max_len/head_max_len');
    const cal = m.calibration ?? {};
    const temperature = Array.isArray(cal.temperature) && cal.temperature.every(isNum) ? cal.temperature : [1, 1, 1];
    const byOpt: Record<string, number> = {};
    for (const [k, v] of Object.entries(cal.temperature_by_options ?? {})) if (isNum(v)) byOpt[k] = v;
    const files = Array.isArray(m.files) ? m.files : [];
    for (const f of files) {
        if (!safeRel(f?.path) || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256) || !isNum(f.bytes)) {
            throw new Error('manifest: files entry');
        }
    }
    return {
        id: m.id, version: m.version, graph: m.graph, tokenizerDir,
        config: { maxLen, headMaxLen, calibration: { temperature, temperatureByOptions: byOpt } },
        thresholds: thresholdsOf(m.thresholds),
        files,
    };
}
