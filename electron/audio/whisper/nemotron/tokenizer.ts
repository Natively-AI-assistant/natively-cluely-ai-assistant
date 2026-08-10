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

// Fallback decoder: vocab.txt is a flat, newline-delimited id -> piece
// lookup (line N is the piece for token id N). This is a crude, non-BPE-aware
// fallback (unlike the real SentencePiece decoder, it doesn't distinguish
// "continuation of the previous word" from "new word" for pieces missing the
// `▁` marker) — it space-joins every piece and then strips any `▁` markers,
// so each vocab entry decodes to its own space-separated token. That's the
// deliberate, verified behavior here (see tokenizer.test.mjs): this path only
// ever runs if AutoTokenizer.from_pretrained fails, so it trades subword
// fidelity for a simple, dependency-free safety net. Unknown ids (outside the
// vocab range) are skipped rather than throwing, since a slightly malformed
// decode is more useful than a crashed pipeline.
export function decodeWithVocab(vocabPath: string): (ids: number[]) => string {
  const lines = fs.readFileSync(vocabPath, 'utf8').split('\n').filter(l => l.length > 0);
  return (ids: number[]): string => {
    const pieces = ids.map(id => lines[id]).filter((p): p is string => p !== undefined);
    return pieces.join(' ').replace(/▁/g, '').replace(/\s+/g, ' ').trim();
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
    return { decode: (ids: number[]) => tok.decode(ids, { skip_special_tokens: true }) };
  } catch (e) {
    console.warn(
      '[nemotron/tokenizer] AutoTokenizer.from_pretrained failed, falling back to vocab.txt:',
      (e as Error)?.message,
    );
    const decode = decodeWithVocab(path.join(modelDir, 'vocab.txt'));
    return { decode };
  }
}
