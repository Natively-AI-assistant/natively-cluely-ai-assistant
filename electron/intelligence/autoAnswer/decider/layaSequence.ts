/**
 * Laya's input sequence and output decoding, ported from laya 0.4.30 (Apache-2.0).
 *
 * The decider model reads `[CLS] <type> question: <instructions> [SEP] [MASK] opt0 [MASK] opt1 …
 * [SEP] <state> [SEP]` and scores one logit per `[MASK]`. A sequence that differs from what the
 * model was trained on by one token is a model the user never got, so this file mirrors the
 * Python line for line:
 *   laya/common.py   build_head, build_sequence, render_options, render_criterion,
 *                    answer_confidence, confidence_from_probs, temp_bucket, clamp_temperature
 *   laya/onnx_agent.py  _collate_items_numpy (the ONNX input contract), _decode_answers
 * and `DeciderSequence2026_11_10.test.mjs` diffs it against fixtures the Python writes
 * (ml/auto-answer-decider/export/make_sequence_fixtures.py).
 *
 * PURE: no tokenizer, no ONNX Runtime and no fs here. The worker injects the tokenizer
 * (`LayaTokenizer`) and runs the session; tests inject the real tokenizer from a fixture.
 *
 * Not ported, because the decider never uses them: `noul`/`score` decoding, option shuffling
 * (`option_order`), the parallel option layout (the English checkpoint is sequential) and
 * per-language temperatures. The decider asks exactly one `choice` question.
 */

/** What the sequence builder needs from a tokenizer. `encode` must NOT add special tokens. */
export interface LayaTokenizer {
    encode(text: string): number[];
    readonly maskToken: string;
    readonly maskTokenId: number;
    readonly clsTokenId: number;
    readonly sepTokenId: number;
    readonly padTokenId: number;
}

/** Laya's internal question form (`Agent._to_internal`) for a choice question. */
export interface LayaChoiceQuestion {
    t: 'choice';
    ins: string;
    crit: Record<string, unknown>;
}

/** The public question shape (§4 `DECIDER_QUESTION`) → the internal one, as `_to_internal` does. */
export function toInternalChoice(q: { type: 'choice'; instructions: string; criteria: Record<string, unknown> | string[] }): LayaChoiceQuestion {
    const crit: Record<string, unknown> = Array.isArray(q.criteria)
        ? Object.fromEntries(q.criteria.map((c) => [c, null]))
        : { ...q.criteria };
    return { t: 'choice', ins: q.instructions, crit };
}

export const QTYPE_CHOICE = 0;
export const DEFAULT_MAX_LEN = 512;
export const DEFAULT_HEAD_MAX_LEN = 192;
const OPTION_MAX_TOKENS = 48;

/**
 * Python `json.dumps(value, ensure_ascii=False, separators=(", ", ": "), default=str)` for the
 * values a criterion can hold. Strings pass through untouched, as in `render_criterion`.
 */
export function renderCriterion(value: unknown): string {
    if (typeof value === 'string') return value;
    return pyJson(value);
}

function pyJson(v: unknown): string {
    if (v === null || v === undefined) return 'null';
    // JSON.stringify and Python's ensure_ascii=False escape the same characters in a string.
    if (typeof v === 'string') return JSON.stringify(v);
    // A whole float prints "1.0" in Python and "1" here. The decider's criteria are all strings,
    // so this structured path is never taken; the parity test pins the rendered options.
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`;
    if (typeof v === 'object') return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ')}}`;
    return JSON.stringify(String(v));
}

/** `render_options` for a choice question: `label` or `label: description`, in criterion order. */
export function renderChoiceOptions(q: LayaChoiceQuestion): string[] {
    return Object.entries(q.crit).map(([k, v]) => (v === null || v === undefined || v === '' ? String(k) : `${k}: ${renderCriterion(v)}`));
}

/** Python's `str.replace(mask, " ")`: every occurrence. */
const unmask = (text: string, mask: string) => text.split(mask).join(' ');

export interface LayaHead {
    ids: number[];
    markers: number[];
    stats: { options: number; optionsDistinct: number; tokensPerOption: number | null };
}

/** `build_head`: `[CLS] <type> question: <ins> [SEP] [MASK] opt0 [MASK] opt1 … [SEP]`. */
export function buildHead(tok: LayaTokenizer, q: LayaChoiceQuestion, headMaxLen = DEFAULT_HEAD_MAX_LEN): LayaHead {
    const opts = renderChoiceOptions(q);
    const ins = unmask(String(q.ins), tok.maskToken);
    let headIds = tok.encode(`${q.t} question: ${ins}`);
    // `truncation=True, max_length=48` with no special tokens keeps the first 48 tokens.
    let optIds = opts.map((o) => [tok.maskTokenId, ...tok.encode(' ' + unmask(o, tok.maskToken)).slice(0, OPTION_MAX_TOKENS)]);
    let optBudget = headMaxLen - optIds.reduce((n, o) => n + o.length, 0);
    let perOption: number | null = null;
    if (optBudget < 16) {
        const per = Math.max(4, Math.floor((headMaxLen - 16) / Math.max(1, optIds.length)));
        perOption = per;
        optIds = optIds.map((o) => o.slice(0, per));
        optBudget = headMaxLen - optIds.reduce((n, o) => n + o.length, 0);
    }
    headIds = headIds.slice(0, Math.max(8, optBudget));
    const ids = [tok.clsTokenId, ...headIds, tok.sepTokenId];
    const markers: number[] = [];
    for (const o of optIds) {
        markers.push(ids.length);
        ids.push(...o);
    }
    ids.push(tok.sepTokenId);
    return { ids, markers, stats: { options: optIds.length, optionsDistinct: new Set(optIds.map((o) => o.join(','))).size, tokensPerOption: perOption } };
}

/** `state_room`: tokens left for the state after the head and the closing `[SEP]`. */
export function stateRoom(head: LayaHead, maxLen = DEFAULT_MAX_LEN): number {
    return Math.max(0, maxLen - head.ids.length - 1);
}

/** Token count of a serialized state exactly as `build_sequence` tokenizes it. */
export function countStateTokens(tok: LayaTokenizer, serializedState: string): number {
    return tok.encode(unmask(serializedState, tok.maskToken)).length;
}

export interface LayaSequence {
    ids: number[];
    markers: number[];
    truncation: { stateTokens: number; stateTokensUsed: number; stateTokensDropped: number; truncated: boolean };
}

/**
 * `build_sequence` with `truncate_left=False` (the right-truncation the agent uses for a string
 * state). The decider fits its state to the room BEFORE serializing (deciderState.fitDeciderState),
 * so `truncated` is false in practice; a true here means the fit and the model disagree on the
 * budget, and the caller should treat the result as untrustworthy.
 */
export function buildSequence(tok: LayaTokenizer, serializedState: string, head: LayaHead, maxLen = DEFAULT_MAX_LEN): LayaSequence {
    const room = stateRoom(head, maxLen);
    const stateIds = tok.encode(unmask(serializedState, tok.maskToken));
    const st = stateIds.slice(0, room);
    let ids = [...head.ids, ...st, tok.sepTokenId];
    ids = ids.slice(0, maxLen);
    const markers = head.markers.filter((m) => m < maxLen);
    return {
        ids,
        markers,
        truncation: { stateTokens: stateIds.length, stateTokensUsed: st.length, stateTokensDropped: stateIds.length - st.length, truncated: st.length < stateIds.length },
    };
}

/** ONNX inputs for a batch of sequences, `_collate_items_numpy`'s contract. */
export interface LayaOnnxBatch {
    n: number;
    length: number;
    markerCols: number;
    inputIds: BigInt64Array;
    attentionMask: BigInt64Array;
    markerPos: BigInt64Array;
    markerMask: Uint8Array;
    qtype: BigInt64Array;
}

export function collate(seqs: LayaSequence[], padId: number): LayaOnnxBatch {
    const n = seqs.length;
    const L = Math.max(...seqs.map((s) => s.ids.length));
    const kmax = Math.max(...seqs.map((s) => s.markers.length));
    // At least 2 marker columns: the exported head takes topk(2) (see the onnx_agent.py comment).
    const K = Math.max(kmax, 2);
    const inputIds = new BigInt64Array(n * L).fill(BigInt(padId));
    const attentionMask = new BigInt64Array(n * L);
    const markerPos = new BigInt64Array(n * K);
    const markerMask = new Uint8Array(n * K);
    const qtype = new BigInt64Array(n).fill(BigInt(QTYPE_CHOICE));
    seqs.forEach((s, i) => {
        s.ids.forEach((id, j) => { inputIds[i * L + j] = BigInt(id); attentionMask[i * L + j] = 1n; });
        s.markers.forEach((m, j) => { markerPos[i * K + j] = BigInt(m); markerMask[i * K + j] = 1; });
    });
    return { n, length: L, markerCols: K, inputIds, attentionMask, markerPos, markerMask, qtype };
}

export const TEMP_MIN = 0.5;
export const TEMP_MAX = 5.0;
/** `clamp_temperature`: refuse a sharpening or flattening fit outside [0.5, 5]. */
export function clampTemperature(t: number, lo = TEMP_MIN, hi = TEMP_MAX): number {
    if (typeof t !== 'number' || !Number.isFinite(t)) return 1.0;   // NaN, ±inf, not a number
    return Math.min(hi, Math.max(lo, t));
}

/** `temp_bucket` for a choice question with k options. */
export function tempBucket(k: number): string {
    const size = k <= 2 ? '2' : k <= 5 ? '3-5' : k <= 10 ? '6-10' : '11+';
    return `choice:${size}`;
}

export interface LayaCalibration {
    /** Per-qtype temperatures [choice, score, noul], as the checkpoint config stores them. */
    temperature: number[];
    /** Per-bucket overrides ("choice:3-5"). Wins over `temperature`. */
    temperatureByOptions?: Record<string, number>;
}

export interface LayaChoiceAnswer {
    choice: string;
    probabilities: Record<string, number>;
    /** Normalized-entropy concentration. NOT calibrated; logged, never gated on (decision D1). */
    confidence: number;
    /** max(p) after the fitted temperature: the calibrated number the cascade gates on (D1). */
    answerConfidence: number;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** `_decode_answers` for one choice row: temperature, softmax over the k markers, confidences. */
export function decodeChoice(logitsRow: ArrayLike<number>, q: LayaChoiceQuestion, k: number, cal: LayaCalibration): LayaChoiceAnswer {
    const raw = cal.temperatureByOptions?.[tempBucket(k)];
    const t = raw !== undefined ? clampTemperature(raw) : clampTemperature(cal.temperature[QTYPE_CHOICE] ?? 1);
    const z = Array.from({ length: k }, (_, i) => Number(logitsRow[i]) / t);
    const zmax = Math.max(...z);
    const e = z.map((v) => Math.exp(v - zmax));
    const sum = e.reduce((a, b) => a + b, 0);
    const p = e.map((v) => v / sum);
    const keys = Object.keys(q.crit);
    let best = 0;
    for (let i = 1; i < k; i++) if (p[i] > p[best]) best = i;
    let confidence = 1;
    if (k >= 2) {
        const ent = -p.reduce((acc, x) => acc + x * Math.log(Math.min(1, Math.max(1e-12, x))), 0);
        confidence = Math.min(1, Math.max(0, 1 - ent / Math.log(k)));
    }
    return {
        choice: keys[best],
        probabilities: Object.fromEntries(keys.slice(0, k).map((key, i) => [key, round4(p[i])])),
        confidence: round4(confidence),
        answerConfidence: round4(Math.min(1, Math.max(0, p[best]))),
    };
}
