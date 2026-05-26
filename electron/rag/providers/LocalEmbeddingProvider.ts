// @huggingface/transformers is ESM-only — must use dynamic import()
import path from 'path';
import { app } from 'electron';
import { IEmbeddingProvider } from './IEmbeddingProvider';

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'local';
  readonly dimensions = 384; // all-MiniLM-L6-v2

  private pipe: any = null;
  private loadingPromise: Promise<void> | null = null; // prevents concurrent init races
  private modelPath: string;

  constructor() {
    // Point to the bundled model inside the app's resources.
    // In dev: use app.getAppPath() so the path is independent of how esbuild
    // bundles this file (bundle: true inlines the provider into main.js, which
    // makes __dirname-relative paths fragile).
    // In prod: app.isPackaged = true → use process.resourcesPath (electron-builder extraResources).
    this.modelPath = path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      'models'
    );
  }

  async isAvailable(): Promise<boolean> {
    // Local model is ALWAYS available after install — this is the guarantee
    try {
      await this.ensureLoaded();
      return true;
    } catch (e) {
      console.error('[LocalEmbeddingProvider] Model failed to load:', e);
      return false;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipe) return;

    // If another caller already kicked off loading, wait for that same promise
    // rather than launching a second concurrent pipeline() call.
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = (async () => {
      // Use new Function() to force a true ESM dynamic import at runtime.
      // TypeScript with module:commonjs rewrites `await import(...)` to
      // `Promise.resolve().then(() => require(...))`, which fails for ESM-only
      // packages like @huggingface/transformers. The new Function() trick is opaque
      // to the TypeScript compiler so it is left as a real import() call.
      const { pipeline, env } = await (new Function('return import("@huggingface/transformers")')()) as any;

      // Tell transformers.js to use the local path, never download in production
      env.allowRemoteModels = false;
      env.localModelPath = this.modelPath;

      this.pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        local_files_only: true,
      });
    })();

    try {
      await this.loadingPromise;
    } catch (e) {
      // Reset so a future call can retry
      this.loadingPromise = null;
      throw e;
    }
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // all-MiniLM-L6-v2 is symmetric
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    // transformers.js handles batching internally
    const output = await this.pipe(texts, { pooling: 'mean', normalize: true });
    // output.data is flat [n * 384], reshape it
    const batchSize = texts.length;
    const result: number[][] = [];
    for (let i = 0; i < batchSize; i++) {
      result.push(Array.from(output.data.slice(i * this.dimensions, (i + 1) * this.dimensions)));
    }
    return result;
  }
}
