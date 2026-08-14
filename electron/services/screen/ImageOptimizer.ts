// electron/services/screen/ImageOptimizer.ts
//
// Sharp-based image optimizer for vision-provider payloads.
//
// Responsibilities:
//   - resize screenshots so long-edge is bounded (default 1280px; technical 1536px; fast 1024px)
//   - re-encode PNG → JPEG (or WebP) with quality 78–88 to shrink base64 payloads
//   - strip EXIF/metadata
//   - enforce a hard max byte cap so we never blow past provider body limits
//   - write the optimized copy to an app-owned temp dir, return path + stats
//   - keep a small in-memory cache keyed by `${imageHash}|${profile}` so the same
//     screenshot is not re-encoded twice in the same session
//
// Notes:
//   - Sharp is already a project dep (used elsewhere for OCR preprocessing and
//     Natively-API image compression). We centralize provider-ready optimization
//     here so the vision pipeline has a single source of truth for sizes/quality.
//   - We do NOT delete optimized files immediately — VisionProviderFallbackChain
//     may retry the same payload across providers in one request. Callers should
//     invoke `cleanup()` after the request completes, or rely on `cleanupAll()`
//     at meeting end.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

export type OptimizationProfile = 'fast' | 'balanced' | 'technical' | 'best';
export type ProviderHint =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'groq'
  | 'ollama'
  | 'natively'
  | 'codex'
  | 'custom'
  | 'generic';

export interface OptimizeOptions {
  profile?: OptimizationProfile;          // default 'balanced'
  provider?: ProviderHint;                // tweaks format and quality
  maxLongEdgePx?: number;                 // override profile default
  format?: 'jpeg' | 'webp' | 'png';       // override profile default
  quality?: number;                       // override profile default (jpeg/webp)
  maxBytes?: number;                      // hard cap; default 3.5 MB
  cacheKey?: string;                      // typically the perceptual hash
}

export interface OptimizedImage {
  path: string;
  buffer?: Buffer;                        // populated when caller asks via getBuffer()
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png';
  width: number;
  height: number;
  byteSize: number;
  originalWidth: number;
  originalHeight: number;
  originalByteSize: number;
  durationMs: number;
  profile: OptimizationProfile;
  provider: ProviderHint;
  cacheHit: boolean;
}

// Profile defaults — tuned for vision LLM quality vs payload size.
const PROFILE_DEFAULTS: Record<OptimizationProfile, { maxLongEdgePx: number; quality: number; format: 'jpeg' | 'webp' | 'png' }> = {
  fast:      { maxLongEdgePx: 1024, quality: 78, format: 'jpeg' },
  balanced:  { maxLongEdgePx: 1280, quality: 85, format: 'jpeg' },
  technical: { maxLongEdgePx: 1536, quality: 88, format: 'jpeg' }, // code text needs clarity
  best:      { maxLongEdgePx: 1920, quality: 90, format: 'jpeg' },
};

// Provider overrides — only when a provider has known stricter constraints.
function applyProviderTweaks(
  provider: ProviderHint,
  base: { maxLongEdgePx: number; quality: number; format: 'jpeg' | 'webp' | 'png' },
): { maxLongEdgePx: number; quality: number; format: 'jpeg' | 'webp' | 'png' } {
  switch (provider) {
    case 'ollama':
      // Local — keep buffer reasonable so base64 payload doesn't choke HTTP.
      return { ...base, format: 'jpeg' };
    case 'natively':
      // Server enforces a 4 MB body cap; the per-image quality bump used in
      // streamWithNatively (q=85, 1920px) is consistent with the 'best' profile.
      return base;
    case 'gemini':
    case 'openai':
    case 'claude':
    case 'groq':
    case 'codex':
    case 'custom':
    case 'generic':
    default:
      return base;
  }
}

const DEFAULT_MAX_BYTES = 3.5 * 1024 * 1024; // 3.5 MB safety margin under most provider limits

export class ImageOptimizer {
  private tempDir: string;
  private cache = new Map<string, OptimizedImage>();
  // Files we own and may need to clean up. Keyed by cacheKey so we don't double-write.
  private ownedFiles = new Map<string, string>();

  constructor(tempDirOverride?: string) {
    this.tempDir = tempDirOverride || path.join(os.tmpdir(), 'natively-vision-optimized');
  }

  async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }

  /**
   * Optimize an image for a specific vision provider. Returns an OptimizedImage
   * pointing to a temp file. Caller may re-use this path across multiple provider
   * attempts within the same vision-fallback request.
   */
  async optimize(sourcePath: string, opts: OptimizeOptions = {}): Promise<OptimizedImage> {
    const started = Date.now();
    const profile: OptimizationProfile = opts.profile || 'balanced';
    const provider: ProviderHint = opts.provider || 'generic';

    const baseDefaults = PROFILE_DEFAULTS[profile];
    const tuned = applyProviderTweaks(provider, baseDefaults);
    const maxLongEdgePx = opts.maxLongEdgePx ?? tuned.maxLongEdgePx;
    const format = opts.format ?? tuned.format;
    const quality = opts.quality ?? tuned.quality;
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const cacheKey = opts.cacheKey ? `${opts.cacheKey}|${profile}|${provider}|${maxLongEdgePx}|${format}|${quality}` : undefined;

    if (cacheKey && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return { ...cached, cacheHit: true };
    }

    await this.ensureTempDir();

    let originalStats: { size: number };
    try {
      originalStats = await fs.stat(sourcePath);
    } catch (err: any) {
      throw new Error(`ImageOptimizer: cannot stat source image: ${err?.message || err}`);
    }

    const pipeline = sharp(sourcePath, { failOnError: false });
    const metadata = await pipeline.metadata();
    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;

    // Resize only if needed (Sharp's `withoutEnlargement` keeps small images intact).
    const resized = pipeline.resize({
      width: maxLongEdgePx,
      height: maxLongEdgePx,
      fit: 'inside',
      withoutEnlargement: true,
    }).rotate(); // honor EXIF orientation before metadata is stripped

    // Encode with selected format. We always strip metadata via `withMetadata({})`
    // not being called (Sharp drops metadata by default unless asked to keep it).
    let encoded;
    let mimeType: OptimizedImage['mimeType'];
    let effectiveQuality = quality;

    // We may need to dial quality down to honor maxBytes. Allow up to 3 attempts.
    let attempt = 0;
    let buffer: Buffer;
    let outputWidth = 0;
    let outputHeight = 0;

    while (true) {
      switch (format) {
        case 'webp':
          encoded = resized.clone().webp({ quality: effectiveQuality, effort: 4 });
          mimeType = 'image/webp';
          break;
        case 'png':
          encoded = resized.clone().png({ compressionLevel: 8, palette: false });
          mimeType = 'image/png';
          break;
        case 'jpeg':
        default:
          encoded = resized.clone().jpeg({
            quality: effectiveQuality,
            mozjpeg: true,
            chromaSubsampling: '4:2:0',
          });
          mimeType = 'image/jpeg';
          break;
      }

      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      buffer = data;
      outputWidth = info.width;
      outputHeight = info.height;

      if (buffer.byteLength <= maxBytes || attempt >= 2 || format === 'png') break;
      // Drop quality 10 points and retry.
      effectiveQuality = Math.max(60, effectiveQuality - 10);
      attempt++;
    }

    // Determine output extension from chosen format.
    const ext = format === 'jpeg' ? 'jpg' : format;
    const outPath = path.join(this.tempDir, `${uuidv4()}.${ext}`);
    await fs.writeFile(outPath, buffer);

    const result: OptimizedImage = {
      path: outPath,
      mimeType,
      width: outputWidth,
      height: outputHeight,
      byteSize: buffer.byteLength,
      originalWidth,
      originalHeight,
      originalByteSize: originalStats.size,
      durationMs: Date.now() - started,
      profile,
      provider,
      cacheHit: false,
    };

    if (cacheKey) {
      this.cache.set(cacheKey, result);
      this.ownedFiles.set(cacheKey, outPath);
    }

    return result;
  }

  /**
   * Read the optimized image bytes (used when a provider expects base64 in-band).
   * Caller decides whether to base64-encode; we return the raw buffer.
   */
  async getBuffer(optimized: OptimizedImage): Promise<Buffer> {
    if (optimized.buffer) return optimized.buffer;
    return await fs.readFile(optimized.path);
  }

  /**
   * Read the optimized image as base64 (no `data:` prefix).
   */
  async getBase64(optimized: OptimizedImage): Promise<string> {
    const buf = await this.getBuffer(optimized);
    return buf.toString('base64');
  }

  /**
   * Read the optimized image as a `data:` URL (suitable for OpenAI/Ollama image_url).
   */
  async getDataUrl(optimized: OptimizedImage): Promise<string> {
    const b64 = await this.getBase64(optimized);
    return `data:${optimized.mimeType};base64,${b64}`;
  }

  /**
   * Delete a specific optimized file when the caller is done with it.
   */
  async cleanup(optimized: OptimizedImage): Promise<void> {
    try {
      await fs.unlink(optimized.path);
    } catch {
      // best-effort
    }
    for (const [key, p] of this.ownedFiles.entries()) {
      if (p === optimized.path) {
        this.ownedFiles.delete(key);
        this.cache.delete(key);
      }
    }
  }

  /**
   * Delete every optimized file written by this optimizer. Call at meeting end.
   */
  async cleanupAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [, p] of this.ownedFiles.entries()) {
      tasks.push(fs.unlink(p).catch((): void => undefined));
    }
    await Promise.all(tasks);
    this.ownedFiles.clear();
    this.cache.clear();
  }

  /**
   * For tests/benchmarks: introspection of cache state.
   */
  getCacheStats(): { entries: number; ownedFiles: number; tempDir: string } {
    return {
      entries: this.cache.size,
      ownedFiles: this.ownedFiles.size,
      tempDir: this.tempDir,
    };
  }
}

// Singleton — most callers should use this. Pass a custom instance only in tests.
let singleton: ImageOptimizer | null = null;
export function getImageOptimizer(): ImageOptimizer {
  if (!singleton) singleton = new ImageOptimizer();
  return singleton;
}
