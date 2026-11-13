/**
 * `LayaTokenizer` over a transformers.js tokenizer (the app's @huggingface/transformers 3.8,
 * already used by the router and reranker workers).
 *
 * The decider's tokenizer is the checkpoint's own `tokenizer.json` (ModernBERT BPE). It is built
 * from the JSON directly rather than through `AutoTokenizer.from_pretrained`, so the worker can
 * load it from the downloaded model folder and the parity test from its gzipped fixture with the
 * same code. Special ids are resolved from the vocabulary: transformers.js 3.8 exposes
 * `mask_token_id` and friends inconsistently (`cls_token_id` is undefined for this tokenizer,
 * measured 2026-11-10), and a silent `undefined` would build a sequence of NaNs.
 */
import type { LayaTokenizer } from './layaSequence';

/** The subset of a transformers.js PreTrainedTokenizer this adapter uses. */
export interface TransformersTokenizerLike {
    encode(text: string, options?: { add_special_tokens?: boolean }): number[];
    model: { tokens_to_ids: Map<string, number> };
}

export interface SpecialTokens {
    mask: string;
    cls: string;
    sep: string;
    pad: string;
}

/** The checkpoint's `tokenizer_config.json` names the special tokens; these are its values. */
export const LAYA_SPECIAL_TOKENS: SpecialTokens = { mask: '[MASK]', cls: '[CLS]', sep: '[SEP]', pad: '[PAD]' };

export function specialTokensFromConfig(config: Record<string, unknown> | null | undefined): SpecialTokens {
    const pick = (key: string, fallback: string) => {
        const v = config?.[key];
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object' && typeof (v as { content?: unknown }).content === 'string') return (v as { content: string }).content;
        return fallback;
    };
    return {
        mask: pick('mask_token', LAYA_SPECIAL_TOKENS.mask),
        cls: pick('cls_token', LAYA_SPECIAL_TOKENS.cls),
        sep: pick('sep_token', LAYA_SPECIAL_TOKENS.sep),
        pad: pick('pad_token', LAYA_SPECIAL_TOKENS.pad),
    };
}

export function adaptTokenizer(tok: TransformersTokenizerLike, special: SpecialTokens = LAYA_SPECIAL_TOKENS): LayaTokenizer {
    const id = (token: string) => {
        const v = tok.model?.tokens_to_ids?.get(token);
        if (typeof v !== 'number') throw new Error(`decider tokenizer has no id for special token ${token}`);
        return v;
    };
    const maskTokenId = id(special.mask);
    const clsTokenId = id(special.cls);
    const sepTokenId = id(special.sep);
    const padTokenId = id(special.pad);
    return {
        encode: (text: string) => Array.from(tok.encode(text, { add_special_tokens: false }), Number),
        maskToken: special.mask,
        maskTokenId,
        clsTokenId,
        sepTokenId,
        padTokenId,
    };
}
