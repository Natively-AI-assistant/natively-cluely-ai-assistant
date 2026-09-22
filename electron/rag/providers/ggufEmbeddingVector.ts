// electron/rag/providers/ggufEmbeddingVector.ts
//
// llama.cpp returns raw (un-normalized) embeddings — a real Qwen3-Embedding-0.6B
// vector measured L2 norm 118. The ONNX path asks transformers.js for
// `normalize: true`, so without this the two runtimes would write vectors of
// different scale into the same store. Normalize ALWAYS, after the optional
// Matryoshka truncation (truncating a unit vector leaves it non-unit).

export function finalizeGgufVector(raw: ArrayLike<number>, dimensions?: number): number[] {
  const width = dimensions && dimensions > 0 && raw.length > dimensions ? dimensions : raw.length;
  const vec = new Array<number>(width);
  let sumSq = 0;
  for (let i = 0; i < width; i++) {
    const v = raw[i];
    vec[i] = v;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < width; i++) vec[i] /= norm;
  }
  return vec;
}
