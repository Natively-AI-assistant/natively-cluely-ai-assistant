import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {
  AutomatedQualityChecks, BenchmarkErrorCode, BenchmarkResolution, Distribution,
  ImageBenchmarkMetadata, ModelStatistics, VisionBenchmarkModel, VisionBenchmarkRun,
} from './types';

const SECRET_KEY_RE = /^(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|secret|password|credential)$/i;
const API_VALUE_RE = /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{16,}|Bearer\s+[^\s"']+)\b/gi;
const BASE64_RE = /\b[A-Za-z0-9+/]{512,}={0,2}\b/g;

export function redactSecrets(value: unknown, key = ''): unknown {
  if (SECRET_KEY_RE.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value.replace(API_VALUE_RE, '[REDACTED]').replace(BASE64_RE, '[BINARY OMITTED]');
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, redactSecrets(child, childKey)]));
  }
  return value;
}

export function promptHash(systemPrompt: string, userMessage: string): string {
  return createHash('sha256').update(systemPrompt).update('\0').update(userMessage).digest('hex');
}

export function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}
export function median(values: number[]): number | undefined { return percentile(values, 50); }
/** Linear interpolation between closest ranks, equivalent to R-7 / Excel PERCENTILE.INC. */
export function percentile(values: number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const fraction = rank - low;
  return sorted[low] + ((sorted[low + 1] ?? sorted[low]) - sorted[low]) * fraction;
}
export function standardDeviation(values: number[]): number | undefined {
  const avg = mean(values);
  if (avg === undefined) return undefined;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}
export function distribution(values: number[]): Distribution {
  if (!values.length) return { count: 0 };
  return {
    count: values.length, min: Math.min(...values), mean: mean(values), median: median(values),
    p50: percentile(values, 50), p75: percentile(values, 75), p90: percentile(values, 90),
    p95: percentile(values, 95), max: Math.max(...values), standardDeviation: standardDeviation(values),
  };
}
export function ratePerSecond(units: number | undefined, durationMs: number | undefined): number | undefined {
  if (units === undefined || durationMs === undefined || durationMs <= 0) return undefined;
  return units / (durationMs / 1000);
}

export function randomizedOrder<T>(values: readonly T[], randomize: boolean, rng = Math.random): T[] {
  const result = [...values];
  if (!randomize) return result;
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const LONG_EDGE: Record<BenchmarkResolution, number | undefined> = {
  original: undefined, high: 1536, balanced: 1280, fast: 1024,
};

export async function processBenchmarkImage(imagePath: string, resolution: BenchmarkResolution): Promise<{
  data: string; buffer: Buffer; metadata: ImageBenchmarkMetadata;
}> {
  const ext = path.extname(imagePath).toLowerCase();
  const sourceMimeType = MIME_BY_EXT[ext];
  if (!sourceMimeType) throw Object.assign(new Error('Only PNG, JPEG, and WebP screenshots are supported.'), { code: 'invalid_image' });
  let source: Buffer;
  const readStart = performance.now();
  try { source = await fs.readFile(imagePath); } catch { throw Object.assign(new Error('Screenshot could not be read.'), { code: 'invalid_image' }); }
  const readDurationMs = performance.now() - readStart;
  let original;
  try { original = await sharp(source, { failOnError: true }).metadata(); } catch {
    throw Object.assign(new Error('The selected file is not a valid image.'), { code: 'invalid_image' });
  }
  if (!original.width || !original.height) throw Object.assign(new Error('Image dimensions are unavailable.'), { code: 'invalid_image' });

  const resizeStart = performance.now();
  const edge = LONG_EDGE[resolution];
  const raw = await sharp(source).rotate().resize(edge ? {
    width: edge, height: edge, fit: 'inside', withoutEnlargement: true,
  } : undefined).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const resizeDurationMs = performance.now() - resizeStart;
  const encodingStart = performance.now();
  const buffer = await sharp(raw.data, { raw: raw.info }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  const encodingDurationMs = performance.now() - encodingStart;
  return {
    data: buffer.toString('base64'), buffer,
    metadata: {
      sourceMimeType, submittedMimeType: 'image/jpeg',
      originalWidth: original.width, originalHeight: original.height,
      submittedWidth: raw.info.width, submittedHeight: raw.info.height,
      originalBytes: source.byteLength, submittedBytes: buffer.byteLength,
      readDurationMs, resizeDurationMs, encodingDurationMs,
      processingDurationMs: readDurationMs + resizeDurationMs + encodingDurationMs,
    },
  };
}

export function classifyBenchmarkError(error: any): { code: BenchmarkErrorCode; message: string; retryAfterMs?: number } {
  const raw = String(error?.message || error || 'Unknown benchmark error');
  const status = Number(error?.status || error?.statusCode || 0);
  let code: BenchmarkErrorCode = 'unknown';
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') code = 'cancelled';
  else if (error?.code === 'TIMEOUT') code = 'timeout';
  else if (status === 401 || /api key|unauthenticated|authentication/i.test(raw)) code = 'authentication';
  else if (status === 429 || /rate.?limit|resource_exhausted/i.test(raw)) code = 'rate_limit';
  else if (status === 404 || /model.*(?:not found|does not exist|unsupported|invalid)|permission.*model/i.test(raw)) code = 'invalid_model';
  else if (/fetch failed|ECONN|ENOTFOUND|network|socket/i.test(raw)) code = 'network';
  else if (status >= 400 || /provider|google genai/i.test(raw)) code = 'provider_error';
  const retryAfter = error?.headers?.get?.('retry-after') ?? error?.retryAfter;
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
  return { code, message: String(redactSecrets(raw)).slice(0, 1000), ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}) };
}

export function automatedChecks(response: string, success: boolean, promptKind: string): AutomatedQualityChecks {
  const trimmed = response.trim();
  return {
    nonEmpty: trimmed.length > 0,
    noApiError: success,
    doesNotDiscussBenchmark: !/\b(?:benchmark|model comparison|latency test)\b/i.test(trimmed),
    doesNotClaimMissingScreenshot: !/(?:cannot|can't|unable to).{0,30}(?:see|access|view).{0,20}(?:image|screenshot)/i.test(trimmed),
    requiredShapeFollowed: promptKind !== 'technical-interview-vision' || /(?:approach|complexity|```|O\()/i.test(trimmed),
    compatibleLength: trimmed.length > 0 && trimmed.length <= (promptKind === 'technical-interview-vision' ? 20000 : 8000),
  };
}

const avgDefined = (values: Array<number | undefined>) => mean(values.filter((v): v is number => v !== undefined));
export function calculateStatistics(models: VisionBenchmarkModel[], runs: VisionBenchmarkRun[]): ModelStatistics[] {
  const stats: ModelStatistics[] = models.map((model) => {
    const attempted = runs.filter((run) => !run.warmup && run.model.modelId === model.modelId);
    const good = attempted.filter((run) => run.success);
    const metric = (key: keyof VisionBenchmarkRun) =>
      distribution(good.map((run) => run[key]).filter((v): v is number => typeof v === 'number'));
    const manual = good.flatMap((run) => Object.values(run.manualRatings ?? {}).filter((v): v is number => typeof v === 'number'));
    return {
      model, attemptedRuns: attempted.length, successfulRuns: good.length,
      failedRuns: attempted.length - good.length,
      successRate: attempted.length ? good.length / attempted.length : 0,
      metrics: {
        providerEventLatencyMs: metric('providerEventLatencyMs'), reasoningLatencyMs: metric('reasoningLatencyMs'),
        requestTtftMs: metric('requestTtftMs'), endToEndTtftMs: metric('endToEndTtftMs'),
        totalResponseLatencyMs: metric('totalResponseLatencyMs'), endToEndLatencyMs: metric('endToEndLatencyMs'),
        screenshotProcessingMs: distribution(good.map((r) => r.image.processingDurationMs)),
        requestAssemblyMs: metric('requestAssemblyMs'), outputTokensPerSecond: metric('outputTokensPerSecond'),
        outputCharactersPerSecond: metric('outputCharactersPerSecond'),
      },
      averageInputTokens: avgDefined(good.map((r) => r.usage.inputTokens)),
      averageVisibleOutputTokens: avgDefined(good.map((r) => r.usage.visibleOutputTokens)),
      averageReasoningTokens: avgDefined(good.map((r) => r.usage.reasoningTokens)),
      averageSubmittedImageBytes: avgDefined(good.map((r) => r.image.submittedBytes)),
      averageManualQuality: mean(manual),
    } satisfies ModelStatistics;
  });
  const latencies = stats.map((s) => s.metrics.requestTtftMs.median).filter((v): v is number => v !== undefined);
  const qualities = stats.map((s) => s.averageManualQuality).filter((v): v is number => v !== undefined);
  const minLatency = Math.min(...latencies), maxLatency = Math.max(...latencies);
  for (const stat of stats) {
    const latency = stat.metrics.requestTtftMs.median;
    const latencyScore = latency === undefined ? 0 : maxLatency === minLatency ? 1 : 1 - ((latency - minLatency) / (maxLatency - minLatency));
    const qualityScore = stat.averageManualQuality === undefined ? (qualities.length ? 0 : 0.5) : stat.averageManualQuality / 5;
    stat.balancedScore = latencyScore * .45 + qualityScore * .45 + stat.successRate * .10;
  }
  return stats;
}

export function benchmarkRunId(): string { return randomUUID(); }
