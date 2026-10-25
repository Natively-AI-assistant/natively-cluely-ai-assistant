// Ambient declaration for src/lib/readAloudChunker.mjs. Source of truth is the
// .mjs — keep this file in sync if its exports change.

export const SOFT_CAP: number;
export const CODE_NOTICE: string;

export function cleanForSpeech(text: string): string;

export interface ReadAloudChunker {
    /** Feed one streamed token; returns the sentences it completed. */
    push(token: string): string[];
    /** End of stream; returns whatever is left. The chunker is spent after. */
    flush(): string[];
}

export function createChunker(): ReadAloudChunker;
