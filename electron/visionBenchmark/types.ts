export type BenchmarkErrorCode =
  | 'invalid_model' | 'authentication' | 'rate_limit' | 'timeout' | 'network'
  | 'provider_error' | 'invalid_image' | 'cancelled' | 'configuration' | 'unknown';

export type BenchmarkPromptKind =
  | 'general-vision' | 'technical-interview-vision' | 'direct-vision' | 'production-mode';
export type BenchmarkThinking = 'minimal' | 'low' | 'medium' | 'high';
export type BenchmarkResolution = 'original' | 'high' | 'balanced' | 'fast';

export interface VisionBenchmarkModel {
  label: string;
  modelId: string;
  enabled: boolean;
  source: 'repository' | 'environment' | 'benchmark-config';
}

export interface VisionBenchmarkConfig {
  imagePath: string;
  modelIds: string[];
  promptKind: BenchmarkPromptKind;
  mode: string;
  question: string;
  measuredRuns: number;
  warmupRuns: number;
  thinking: BenchmarkThinking;
  resolution: BenchmarkResolution;
  temperature: number;
  maxOutputTokens: number;
  execution: 'sequential' | 'parallel';
  connection: 'warm' | 'fresh-client';
  randomizeModelOrder: boolean;
  timeoutMs: number;
  interRunDelayMs: number;
  includeScreenshotInExport: boolean;
  outputRoot?: string;
}

export interface PromptPreview {
  selectedMode: string;
  builder: string;
  systemPrompt: string;
  userMessage: string;
  systemPromptCharacters: number;
  systemPromptTokens?: number;
  userMessageCharacters: number;
  screenshotAttached: boolean;
  promptHash: string;
}

export interface ImageBenchmarkMetadata {
  sourceMimeType: string;
  submittedMimeType: string;
  originalWidth: number;
  originalHeight: number;
  submittedWidth: number;
  submittedHeight: number;
  originalBytes: number;
  submittedBytes: number;
  readDurationMs: number;
  resizeDurationMs: number;
  encodingDurationMs: number;
  processingDurationMs: number;
}

export interface BenchmarkTraceEvent {
  type: 'provider' | 'reasoning' | 'answer' | 'metadata' | 'usage' | 'complete' | 'error';
  offsetMs: number;
  characters?: number;
  summary?: string;
}

export interface BenchmarkUsage {
  inputTokens?: number;
  visibleOutputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  outputTokensCombined?: boolean;
}

export interface AutomatedQualityChecks {
  nonEmpty: boolean;
  noApiError: boolean;
  doesNotDiscussBenchmark: boolean;
  doesNotClaimMissingScreenshot: boolean;
  requiredShapeFollowed: boolean;
  compatibleLength: boolean;
}

export interface ManualQualityRatings {
  screenshotReadingAccuracy?: number;
  visibleTextAccuracy?: number;
  taskIdentification?: number;
  factualCorrectness?: number;
  instructionAdherence?: number;
  usefulness?: number;
  naturalNativelyStyle?: number;
}

export interface VisionBenchmarkRun {
  id: string;
  model: VisionBenchmarkModel;
  runNumber: number;
  warmup: boolean;
  executionOrder: number;
  success: boolean;
  startedAtIso: string;
  promptHash: string;
  image: ImageBenchmarkMetadata;
  requestAssemblyMs: number;
  providerEventLatencyMs?: number;
  reasoningLatencyMs?: number;
  requestTtftMs?: number;
  endToEndTtftMs?: number;
  totalResponseLatencyMs?: number;
  endToEndLatencyMs: number;
  outputTokensPerSecond?: number;
  outputCharactersPerSecond?: number;
  usage: BenchmarkUsage;
  response: string;
  reasoning: string;
  trace: BenchmarkTraceEvent[];
  checks: AutomatedQualityChecks;
  manualRatings?: ManualQualityRatings;
  error?: { code: BenchmarkErrorCode; message: string; retryAfterMs?: number };
}

export interface Distribution {
  count: number; min?: number; mean?: number; median?: number; p50?: number;
  p75?: number; p90?: number; p95?: number; max?: number; standardDeviation?: number;
}

export interface ModelStatistics {
  model: VisionBenchmarkModel;
  attemptedRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  metrics: Record<string, Distribution>;
  averageInputTokens?: number;
  averageVisibleOutputTokens?: number;
  averageReasoningTokens?: number;
  averageSubmittedImageBytes?: number;
  averageManualQuality?: number;
  balancedScore?: number;
}

export interface VisionBenchmarkSession {
  id: string;
  status: 'running' | 'completed' | 'cancelled';
  initiatedAtIso: string;
  completedAtIso?: string;
  config: VisionBenchmarkConfig;
  models: VisionBenchmarkModel[];
  prompt: PromptPreview;
  runs: VisionBenchmarkRun[];
  statistics: ModelStatistics[];
  executionOrder: Array<{ round: number; warmup: boolean; modelIds: string[] }>;
  balancedWeights: { latency: number; quality: number; reliability: number };
  exportPath?: string;
}

export const DEFAULT_BENCHMARK_QUESTION =
  'Analyze the attached screenshot using the active Natively mode. Identify the main question or task visible on screen and provide the exact answer Natively should display to the user. Do not discuss the benchmark.';
