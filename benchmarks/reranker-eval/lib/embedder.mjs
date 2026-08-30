// benchmarks/reranker-eval/lib/embedder.mjs
//
// Wraps LocalEmbeddingProvider (the same on-device embedder the production
// hybrid retriever falls back to) to compute the cosine-only BASELINE
// ranking — the control group every reranker candidate is measured against.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installElectronMock } from './electron-mock.mjs';

export class Embedder {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
    this.provider = null;
  }

  async _ensureProvider() {
    if (this.provider) return this.provider;
    installElectronMock(this.repoRoot);
    process.env.NATIVELY_LOCAL_MODELS_PATH = path.join(this.repoRoot, 'resources', 'models');
    const dist = path.resolve(this.repoRoot, 'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js');
    const { LocalEmbeddingProvider } = await import(pathToFileURL(dist).href);
    this.provider = new LocalEmbeddingProvider();
    return this.provider;
  }

  async isAvailable() {
    const p = await this._ensureProvider();
    return p.isAvailable();
  }

  async embed(text) {
    const p = await this._ensureProvider();
    return p.embed(text);
  }
}

export function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
