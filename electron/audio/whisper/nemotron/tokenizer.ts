// Tokenizer for Nemotron 3.5 ASR's RNNT decoder output (id -> text).
//
// Primary path: @huggingface/transformers' AutoTokenizer, which is
// architecture-agnostic for tokenizer LOADING even though the library has no
// pipeline support for Nemotron's ASR architecture itself (confirmed during
// design — see design doc). Task 1's real inspection of this export's
// tokenizer_config.json recorded `"tokenizer_class": "T5Tokenizer"` — a
// standard, well-supported architecture — so the primary path is expected to
// succeed against the real model, not fall back. See Step 5's note in
// docs/superpowers/plans/nemotron-tensor-shapes.md for which path actually
// fired.
//
// Falls back to a hand-written vocab.txt decoder (decodeWithVocab) if
// AutoTokenizer.from_pretrained throws for any reason — e.g. tokenizer_class
// becomes unrecognized in a future model export. This is the safety net, not
// the expected path.
//
// Load strategy: @huggingface/transformers is ESM-only in this project's
// packaged-Electron runtime path (see whisperWorker.ts's `loadTransformers()`
// for the established rationale, and melFrontend.ts from this same plan for
// the same precedent — electron/tsconfig.json compiles with
// `module: CommonJS`, which rewrites a static top-level `import` into
// `require(...)`). We follow that exact precedent here — loading the package
// via a real dynamic `import()` hidden behind `new Function(...)` so
// TypeScript never sees (and never rewrites) the import expression.
import fs from 'fs';
import path from 'path';

export interface NemotronTokenizer {
  decode(ids: number[]): string;
}

// Standard SentencePiece detokenization: pieces are joined with NO
// separator (a piece with no leading `▁` is a glued continuation of the
// previous piece, e.g. ['▁un', 'happy'] -> "unhappy"), and the `▁` marker
// itself is converted to a literal space to mark word boundaries. Shared by
// both the vocab.txt fallback path and (as of Task 11 fix1) the primary
// AutoTokenizer path — see joinPieces()'s own doc comment below for why the
// primary path needs this too, not just the fallback.
function joinPieces(pieces: string[]): string {
  return pieces.join('').replace(/▁/g, ' ').trim();
}

// Fallback decoder: vocab.txt is a flat, newline-delimited id -> piece
// lookup (line N is the piece for token id N). This path only ever runs if
// AutoTokenizer.from_pretrained fails, serving as a dependency-free safety
// net. Unknown ids (outside the vocab range) are skipped rather than
// throwing, since a slightly malformed decode is more useful than a crashed
// pipeline.
export function decodeWithVocab(vocabPath: string): (ids: number[]) => string {
  const lines = fs.readFileSync(vocabPath, 'utf8').split('\n').filter(l => l.length > 0);
  return (ids: number[]): string => {
    const pieces = ids.map(id => lines[id]).filter((p): p is string => p !== undefined);
    return joinPieces(pieces);
  };
}

// Loads @huggingface/transformers via a real dynamic import() at runtime.
// Using new Function prevents TypeScript from rewriting import() → require()
// in the CommonJS output, which would fail because the package is ESM-only.
async function loadTransformers(): Promise<any> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

export async function loadNemotronTokenizer(modelDir: string): Promise<NemotronTokenizer> {
  try {
    const { AutoTokenizer } = await loadTransformers();
    const tok = await AutoTokenizer.from_pretrained(modelDir, { local_files_only: true });
    // Task 11 fix1 round: do NOT call tok.decode() directly. Confirmed by
    // direct inspection (real model, real tokenizer_config.json at
    // /tmp/nemotron-inspect): this export's tokenizer.json has no `decoder`
    // section (`tok.decoder === null`), so @huggingface/transformers'
    // PreTrainedTokenizer.decode_single falls back to `tokens.join(' ')` —
    // literally space-separating EVERY subword piece ("▁ q ui ck ▁ b r ow n"
    // instead of " quick brown") — a real, verified bug in how this export's
    // tokenizer degrades under this library's tokenizer_class=T5Tokenizer
    // loading path, not a guess. This silently deflates every downstream
    // word-overlap check even when the model's own token sequence is
    // correct (confirmed while retesting lang_id conditioning against this
    // round's Part A fix — see task-11-fix1-report.md). Bypassing tok.decode()
    // entirely and reusing the same SentencePiece joinPieces() logic the
    // vocab.txt fallback path already used avoids the library's broken
    // fallback while still using the library's own real
    // convert_ids_to_tokens()/special_tokens for the id->piece mapping and
    // special-token filtering (skip_special_tokens's own real behavior).
    return {
      decode: (ids: number[]) => {
        const tokens = tok.model.convert_ids_to_tokens(ids) as string[];
        const special: string[] = tok.special_tokens ?? [];
        return joinPieces(tokens.filter((t) => !special.includes(t)));
      },
    };
  } catch (e) {
    console.warn(
      '[nemotron/tokenizer] AutoTokenizer.from_pretrained failed, falling back to vocab.txt:',
      (e as Error)?.message,
    );
    const decode = decodeWithVocab(path.join(modelDir, 'vocab.txt'));
    return { decode };
  }
}
