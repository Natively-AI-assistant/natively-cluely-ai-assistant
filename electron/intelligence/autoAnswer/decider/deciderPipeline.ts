/**
 * One candidate through the decider model, end to end, with the ONNX run injected. PURE apart from
 * the injected runner: the local worker passes onnxruntime-node, tests pass fixture logits, and the
 * hosted tier (Phase 5) can run the same steps server-side so both runtimes see identical input.
 *
 *   JudgeRequest → §4 fields (deciderState) → fit into the state room (exact token counts)
 *     → Laya sequence (layaSequence) → batch of one → run → decode with the fitted temperatures
 */
import type { JudgeRequest } from '../AutoAnswerJudge';
import type { BackendDecision, DeciderLabel } from './DecisionBackend';
import {
    DECIDER_QUESTION, buildDeciderStateFields, fitDeciderState, modeIdForName,
    type DeciderStateFields,
} from './deciderState';
import {
    type LayaCalibration, type LayaChoiceQuestion, type LayaHead, type LayaOnnxBatch, type LayaTokenizer,
    DEFAULT_MAX_LEN, buildHead, buildSequence, collate, countStateTokens, decodeChoice, stateRoom, toInternalChoice,
} from './layaSequence';

/** What a model artifact ships beside its graph (manifest.json, Phase 3.5), as the pipeline needs it. */
export interface DeciderModelConfig {
    maxLen: number;
    headMaxLen: number;
    calibration: LayaCalibration;
}

/** Runs one collated batch; resolves the `logits` row for item 0 (at least k values). */
export type DeciderRunner = (batch: LayaOnnxBatch) => Promise<ArrayLike<number>>;

export interface PreparedDecider {
    tok: LayaTokenizer;
    q: LayaChoiceQuestion;
    head: LayaHead;
    room: number;
    cfg: DeciderModelConfig;
}

/** Everything that depends only on the tokenizer and config, built once per model load. */
export function prepareDecider(tok: LayaTokenizer, cfg: DeciderModelConfig): PreparedDecider {
    const q = toInternalChoice(DECIDER_QUESTION as any);
    const head = buildHead(tok, q, cfg.headMaxLen);
    return { tok, q, head, room: stateRoom(head, cfg.maxLen ?? DEFAULT_MAX_LEN), cfg };
}

/** The engine's request as §4 fields: the same builder the bench and the data engine use. */
export function fieldsForRequest(req: JudgeRequest): DeciderStateFields {
    return buildDeciderStateFields({
        candidateText: req.candidateText,
        recentTurns: req.recentTurns ?? [],
        speakers: req.speakers,
        modeId: modeIdForName(req.modeName ?? null),
        lastAnsweredText: req.lastAnsweredText ?? null,
        userName: req.userName ?? null,
        transcriptLagging: !!req.transcriptLagging,
    });
}

/** Fields → decision. `ms` is left 0; the caller times the whole call. */
export async function decideFields(p: PreparedDecider, fields: DeciderStateFields, run: DeciderRunner): Promise<BackendDecision> {
    const fit = fitDeciderState(fields, (s) => countStateTokens(p.tok, s), p.room);
    const seq = buildSequence(p.tok, fit.serialized, p.head, p.cfg.maxLen);
    const batch = collate([seq], p.tok.padTokenId);
    const k = seq.markers.length;
    const row = await run(batch);
    if (!row || row.length < k) throw new Error(`decider graph returned ${row?.length ?? 0} logits for ${k} options`);
    const a = decodeChoice(row, p.q, k, p.cfg.calibration);
    const probabilities = { answer: a.probabilities.answer ?? 0, silent: a.probabilities.silent ?? 0, wait: a.probabilities.wait ?? 0 };
    return {
        choice: a.choice as DeciderLabel,
        probabilities,
        answerConfidence: a.answerConfidence,
        entropyConfidence: a.confidence,
        // The fit gives ground before the model would cut; any right-truncation left means the
        // candidate itself may be cut, and a cut candidate is never trusted (gateDecision).
        truncated: seq.truncation.truncated,
        ms: 0,
    };
}

export function decideRequest(p: PreparedDecider, req: JudgeRequest, run: DeciderRunner): Promise<BackendDecision> {
    return decideFields(p, fieldsForRequest(req), run);
}
