import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { automatedChecks, benchmarkRunId, calculateStatistics, classifyBenchmarkError, processBenchmarkImage, randomizedOrder, ratePerSecond } from './core';
import { buildBenchmarkPrompt } from './prompts';
import type {
  BenchmarkTraceEvent, BenchmarkUsage, VisionBenchmarkConfig, VisionBenchmarkModel,
  VisionBenchmarkRun, VisionBenchmarkSession,
} from './types';

export interface BenchmarkRunnerCallbacks {
  onSession?: (session: VisionBenchmarkSession) => void;
  onRunStarted?: (input: { model: VisionBenchmarkModel; runNumber: number; warmup: boolean }) => void;
  onRunCompleted?: (run: VisionBenchmarkRun) => void;
}

export interface GeminiBenchmarkClient {
  models: { generateContentStream(request: any): Promise<any> };
}

export interface BenchmarkRunnerDependencies {
  apiKey: string;
  createClient?: () => GeminiBenchmarkClient;
  now?: () => number;
}

function validateConfig(config: VisionBenchmarkConfig, models: VisionBenchmarkModel[]): void {
  if (!config.imagePath) throw Object.assign(new Error('A screenshot is required.'), { code: 'configuration' });
  if (!models.length) throw Object.assign(new Error('Select at least one model.'), { code: 'configuration' });
  if (!Number.isInteger(config.measuredRuns) || config.measuredRuns < 1 || config.measuredRuns > 100) throw Object.assign(new Error('Measured runs must be between 1 and 100.'), { code: 'configuration' });
  if (!Number.isInteger(config.warmupRuns) || config.warmupRuns < 0 || config.warmupRuns > 20) throw Object.assign(new Error('Warm-up runs must be between 0 and 20.'), { code: 'configuration' });
  if (config.timeoutMs < 1000 || config.timeoutMs > 600000) throw Object.assign(new Error('Timeout must be between 1 and 600 seconds.'), { code: 'configuration' });
  if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) throw Object.assign(new Error('Temperature must be between 0 and 2.'), { code: 'configuration' });
}

function partsFromChunk(chunk: any): any[] {
  return chunk?.candidates?.flatMap((candidate: any) => candidate?.content?.parts ?? []) ?? [];
}

function usageFromChunk(chunk: any): BenchmarkUsage | undefined {
  const usage = chunk?.usageMetadata;
  if (!usage) return undefined;
  const visible = usage.candidatesTokenCount;
  const reasoning = usage.thoughtsTokenCount;
  return {
    inputTokens: usage.promptTokenCount,
    visibleOutputTokens: visible,
    reasoningTokens: reasoning,
    totalTokens: usage.totalTokenCount,
    outputTokensCombined: visible === undefined && usage.totalTokenCount !== undefined,
  };
}

async function runOne(
  config: VisionBenchmarkConfig,
  model: VisionBenchmarkModel,
  runNumber: number,
  warmup: boolean,
  executionOrder: number,
  prompt: ReturnType<typeof buildBenchmarkPrompt>,
  client: GeminiBenchmarkClient,
  outerSignal: AbortSignal,
  now: () => number,
): Promise<VisionBenchmarkRun> {
  const runStartedAt = now();
  const startedAtIso = new Date().toISOString();
  let image = {
    sourceMimeType: '', submittedMimeType: '', originalWidth: 0, originalHeight: 0,
    submittedWidth: 0, submittedHeight: 0, originalBytes: 0, submittedBytes: 0,
    readDurationMs: 0, resizeDurationMs: 0, encodingDurationMs: 0, processingDurationMs: 0,
  };
  let requestAssemblyMs = 0;
  let response = '', reasoning = '', usage: BenchmarkUsage = {}, success = false;
  let requestStartedAt: number | undefined, firstProviderAt: number | undefined;
  let firstReasoningAt: number | undefined, firstAnswerAt: number | undefined, completedAt: number | undefined;
  const trace: BenchmarkTraceEvent[] = [];
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort(outerSignal.reason);
  outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(Object.assign(new Error('Benchmark request timed out.'), { code: 'TIMEOUT' }));
  }, config.timeoutMs);

  let runError: VisionBenchmarkRun['error'];
  try {
    if (outerSignal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
    const processed = await processBenchmarkImage(config.imagePath, config.resolution);
    image = processed.metadata;
    const assemblyStart = now();
    const request = {
      model: model.modelId,
      contents: [{ role: 'user', parts: [
        { text: prompt.userMessage },
        { inlineData: { mimeType: processed.metadata.submittedMimeType, data: processed.data } },
      ] }],
      config: {
        systemInstruction: { parts: [{ text: prompt.systemPrompt }] },
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        thinkingConfig: { thinkingLevel: config.thinking },
        abortSignal: controller.signal,
      },
    };
    requestAssemblyMs = now() - assemblyStart;
    requestStartedAt = now();
    const streamResult = await client.models.generateContentStream(request);
    const stream = streamResult?.stream ?? streamResult;
    for await (const chunk of stream) {
      const eventAt = now();
      if (firstProviderAt === undefined) {
        firstProviderAt = eventAt;
        trace.push({ type: 'provider', offsetMs: eventAt - requestStartedAt, summary: 'first provider event' });
      }
      const parts = partsFromChunk(chunk);
      let emitted = false;
      for (const part of parts) {
        const text = typeof part?.text === 'string' ? part.text : '';
        if (!text) continue;
        if (part.thought === true) {
          if (firstReasoningAt === undefined) {
            firstReasoningAt = eventAt;
            trace.push({ type: 'reasoning', offsetMs: eventAt - requestStartedAt, characters: text.length });
          }
          reasoning += text;
        } else {
          if (firstAnswerAt === undefined) {
            firstAnswerAt = eventAt;
            trace.push({ type: 'answer', offsetMs: eventAt - requestStartedAt, characters: text.length });
          }
          response += text;
        }
        emitted = true;
      }
      const chunkUsage = usageFromChunk(chunk);
      if (chunkUsage) {
        usage = chunkUsage;
        trace.push({ type: 'usage', offsetMs: eventAt - requestStartedAt, summary: 'usage metadata received' });
      } else if (!emitted) {
        trace.push({ type: 'metadata', offsetMs: eventAt - requestStartedAt, summary: 'metadata-only event' });
      }
    }
    completedAt = now();
    trace.push({ type: 'complete', offsetMs: completedAt - requestStartedAt });
    if (!response.trim()) throw Object.assign(new Error('Provider stream completed without visible answer text.'), { status: 502 });
    success = true;
  } catch (error: any) {
    if (timedOut) error = Object.assign(new Error('Benchmark request timed out.'), { code: 'TIMEOUT' });
    else if (outerSignal.aborted) error = Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
    runError = classifyBenchmarkError(error);
    trace.push({ type: 'error', offsetMs: now() - (requestStartedAt ?? runStartedAt), summary: runError.code });
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener('abort', onOuterAbort);
  }
  const runCompletedAt = now();
  const visibleDuration = firstAnswerAt !== undefined && completedAt !== undefined ? completedAt - firstAnswerAt : undefined;
  return {
    id: benchmarkRunId(), model, runNumber, warmup, executionOrder, success, startedAtIso,
    promptHash: prompt.promptHash, image, requestAssemblyMs,
    providerEventLatencyMs: requestStartedAt !== undefined && firstProviderAt !== undefined ? firstProviderAt - requestStartedAt : undefined,
    reasoningLatencyMs: requestStartedAt !== undefined && firstReasoningAt !== undefined ? firstReasoningAt - requestStartedAt : undefined,
    requestTtftMs: requestStartedAt !== undefined && firstAnswerAt !== undefined ? firstAnswerAt - requestStartedAt : undefined,
    endToEndTtftMs: firstAnswerAt !== undefined ? firstAnswerAt - runStartedAt : undefined,
    totalResponseLatencyMs: requestStartedAt !== undefined && completedAt !== undefined ? completedAt - requestStartedAt : undefined,
    endToEndLatencyMs: runCompletedAt - runStartedAt,
    outputTokensPerSecond: ratePerSecond(usage.visibleOutputTokens, visibleDuration),
    outputCharactersPerSecond: ratePerSecond(response.length, visibleDuration),
    usage, response, reasoning, trace,
    checks: automatedChecks(response, success, config.promptKind),
    ...(runError ? { error: runError } : {}),
  };
}

export class VisionBenchmarkRunner {
  private controller: AbortController | null = null;
  constructor(private readonly deps: BenchmarkRunnerDependencies) {}
  cancel(): void { this.controller?.abort(new DOMException('Cancelled', 'AbortError')); }

  async run(config: VisionBenchmarkConfig, availableModels: VisionBenchmarkModel[], callbacks: BenchmarkRunnerCallbacks = {}): Promise<VisionBenchmarkSession> {
    const models = config.modelIds.map((id) => availableModels.find((model) => model.modelId === id))
      .filter((model): model is VisionBenchmarkModel => Boolean(model));
    validateConfig(config, models);
    if (!this.deps.apiKey.trim()) throw Object.assign(new Error('Gemini API key is not configured.'), { code: 'configuration' });
    this.controller = new AbortController();
    const prompt = buildBenchmarkPrompt(config.promptKind, config.mode, config.question, true);
    const session: VisionBenchmarkSession = {
      id: randomUUID(), status: 'running', initiatedAtIso: new Date().toISOString(),
      config, models, prompt, runs: [], statistics: [], executionOrder: [],
      balancedWeights: { latency: .45, quality: .45, reliability: .10 },
    };
    callbacks.onSession?.(session);
    const createClient = this.deps.createClient ?? (() => new GoogleGenAI({
      apiKey: this.deps.apiKey, httpOptions: { apiVersion: 'v1alpha' },
    }) as GeminiBenchmarkClient);
    const warmClient = config.connection === 'warm' ? createClient() : undefined;
    const totalRounds = config.warmupRuns + config.measuredRuns;
    let orderCounter = 0;
    for (let round = 0; round < totalRounds && !this.controller.signal.aborted; round++) {
      const warmup = round < config.warmupRuns;
      const runNumber = warmup ? round + 1 : round - config.warmupRuns + 1;
      const ordered = randomizedOrder(models, config.randomizeModelOrder);
      session.executionOrder.push({ round: runNumber, warmup, modelIds: ordered.map((model) => model.modelId) });
      const execute = async (model: VisionBenchmarkModel) => {
        callbacks.onRunStarted?.({ model, runNumber, warmup });
        const client = warmClient ?? createClient();
        const run = await runOne(config, model, runNumber, warmup, ++orderCounter, prompt, client, this.controller!.signal, this.deps.now ?? performance.now.bind(performance));
        session.runs.push(run);
        callbacks.onRunCompleted?.(run);
        return run;
      };
      if (config.execution === 'parallel') await Promise.all(ordered.map(execute));
      else {
        for (const model of ordered) {
          if (this.controller.signal.aborted) break;
          await execute(model);
          if (config.interRunDelayMs > 0 && !this.controller.signal.aborted) {
            await delay(config.interRunDelayMs, undefined, { signal: this.controller.signal }).catch((): void => undefined);
          }
        }
      }
    }
    session.status = this.controller.signal.aborted ? 'cancelled' : 'completed';
    session.completedAtIso = new Date().toISOString();
    session.statistics = calculateStatistics(models, session.runs);
    callbacks.onSession?.(session);
    return session;
  }
}
