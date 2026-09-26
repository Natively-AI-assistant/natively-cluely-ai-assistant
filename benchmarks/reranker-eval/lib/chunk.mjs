// benchmarks/reranker-eval/lib/chunk.mjs
//
// Wraps the app's real flat-prose chunker (electron/services/modes/
// semanticChunker.ts's semanticChunks()) so this benchmark's chunk
// boundaries match production exactly for resume/JD-style documents (no
// Table of Contents, so ModeHybridRetriever.chunkText's flat-prose branch —
// `return semanticChunks(content);` — is the one production path our
// fixtures actually exercise). Never modifies the production file; this is
// a read-only import of its compiled output.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function chunkDocument(repoRoot, text) {
  const dist = path.resolve(repoRoot, 'dist-electron/electron/services/modes/semanticChunker.js');
  const { semanticChunks } = await import(pathToFileURL(dist).href);
  return semanticChunks(text);
}
