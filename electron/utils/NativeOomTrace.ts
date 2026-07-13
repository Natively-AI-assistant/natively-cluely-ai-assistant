import { app, contentTracing } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const TRACE_ENV = 'NATIVELY_NATIVE_OOM_TRACE';
const CONTENT_TRACE_ENV = 'NATIVELY_NATIVE_OOM_CONTENT_TRACE';
const MAX_TRACE_BYTES = 5 * 1024 * 1024;
const CONTENT_TRACE_DURATION_MS = 25_000;
const CONTENT_TRACE_RSS_DELTA_BYTES = 512 * 1024 * 1024;
const CONTENT_TRACE_RSS_MULTIPLIER = 2;

type TraceRecord = Record<string, unknown>;
type TraceApp = Pick<typeof app, 'getPath'>;
type TraceContentTracing = Pick<typeof contentTracing, 'startRecording' | 'stopRecording'>;

type IpcLedgerEntry = {
  messages: number;
  estimatedBytes: number;
};

type NativeOomTraceOptions = {
  enabled?: boolean;
  contentTraceEnabled?: boolean;
  electronApp?: TraceApp;
  tracing?: TraceContentTracing;
  traceFs?: Pick<typeof fs, 'appendFileSync' | 'existsSync' | 'mkdirSync' | 'statSync'>;
  now?: () => number;
  maxTraceBytes?: number;
};

const SAFE_STRING_FIELDS = new Set([
  'event',
  'platform',
  'electron',
  'window',
  'reason',
  'type',
  'channel',
  'isolation',
]);

const SAFE_NUMBER_FIELDS = new Set([
  'schema',
  'contentTraceRequested',
  'baselineRss',
  'triggerRss',
  'pid',
  'webContentsId',
  'rendererPid',
  'exitCode',
  'rss',
  'heapUsed',
  'heapTotal',
  'external',
  'arrayBuffers',
  'freeMemory',
  'totalMemory',
  'messages',
  'estimatedBytes',
  'workingSetSize',
  'peakWorkingSetSize',
  'privateBytes',
  'sharedBytes',
]);

const SAFE_OBJECT_FIELDS = new Set(['main', 'system', 'launcher', 'processes', 'memory', 'ipc']);

const numericMemory = (memory: Record<string, unknown> | undefined): Record<string, number> => {
  if (!memory) return {};
  return Object.fromEntries(
    Object.entries(memory).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
  ) as Record<string, number>;
};

const estimateValueBytes = (value: unknown, depth = 0): number => {
  if (depth > 4 || value == null) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return 8;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (Array.isArray(value)) {
    return value.slice(0, 64).reduce<number>((total, item) => total + estimateValueBytes(item, depth + 1), 0);
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .slice(0, 64)
      .reduce<number>((total, item) => total + estimateValueBytes(item, depth + 1), 0);
  }
  return 0;
};

const sanitizeTraceData = (data: TraceRecord): TraceRecord => {
  const sanitized: TraceRecord = {};
  for (const [key, value] of Object.entries(data)) {
    if (SAFE_STRING_FIELDS.has(key) && typeof value === 'string') {
      sanitized[key] = value.slice(0, 100);
      continue;
    }
    if (SAFE_NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
      continue;
    }
    if (SAFE_OBJECT_FIELDS.has(key)) {
      if (Array.isArray(value)) {
        sanitized[key] = value.slice(0, 128).map((item) =>
          item && typeof item === 'object' ? sanitizeTraceData(item as TraceRecord) : null,
        );
      } else if (value && typeof value === 'object') {
        sanitized[key] = sanitizeTraceData(value as TraceRecord);
      }
    }
  }
  return sanitized;
};

/**
 * Opt-in, local-only attribution for a native Browser/renderer OOM.
 *
 * Records only allowlisted process/window metadata and IPC channel byte estimates.
 * Payload values are never written to disk. Content tracing is separately opt-in,
 * uses Chromium's argument filter, and is capped to one 25-second capture.
 */
export class NativeOomTrace {
  private readonly enabled: boolean;
  private readonly contentTraceEnabled: boolean;
  private readonly electronApp: TraceApp;
  private readonly tracing: TraceContentTracing;
  private readonly traceFs: Pick<typeof fs, 'appendFileSync' | 'existsSync' | 'mkdirSync' | 'statSync'>;
  private readonly now: () => number;
  private readonly maxTraceBytes: number;
  private readonly ledger = new Map<string, IpcLedgerEntry>();
  private tracePath: string | null = null;
  private contentTracePath: string | null = null;
  private contentTraceTimer: NodeJS.Timeout | null = null;
  private contentTraceRunning = false;
  private contentTraceStarted = false;
  private baselineRss: number | null = null;
  private armedLauncherPid: number | null = null;
  private stopped = false;

  constructor(options: NativeOomTraceOptions = {}) {
    this.enabled = options.enabled ?? process.env[TRACE_ENV] === '1';
    this.contentTraceEnabled = options.contentTraceEnabled ?? process.env[CONTENT_TRACE_ENV] === '1';
    this.electronApp = options.electronApp ?? app;
    this.tracing = options.tracing ?? contentTracing;
    this.traceFs = options.traceFs ?? fs;
    this.now = options.now ?? Date.now;
    this.maxTraceBytes = options.maxTraceBytes ?? MAX_TRACE_BYTES;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  initialize(): void {
    if (!this.enabled || this.tracePath) return;
    try {
      const dir = path.join(this.electronApp.getPath('userData'), 'diagnostics');
      this.traceFs.mkdirSync(dir, { recursive: true });
      this.tracePath = path.join(dir, `native-oom-${this.now()}-${process.pid}.ndjson`);
      this.write('session-start', {
        schema: 1,
        contentTraceRequested: this.contentTraceEnabled ? 1 : 0,
        pid: process.pid,
        platform: process.platform,
        electron: process.versions.electron,
      });
      console.warn(`[NativeOomTrace] enabled; metadata trace: ${this.tracePath}`);
    } catch (error: any) {
      console.warn('[NativeOomTrace] failed to initialize:', error?.message || error);
    }
  }

  record(event: string, data: TraceRecord = {}): void {
    if (!this.enabled || this.stopped) return;
    this.write(event, data);
  }

  sample(
    mainMemory: NodeJS.MemoryUsage,
    metrics: Array<Record<string, unknown>>,
    launcher?: { webContentsId: number; pid: number },
    system?: { freeMemory: number; totalMemory: number },
  ): void {
    if (!this.enabled || this.stopped) return;
    const processes = metrics.map((metric) => ({
      type: typeof metric.type === 'string' ? metric.type : 'unknown',
      pid: typeof metric.pid === 'number' ? metric.pid : 0,
      memory: numericMemory(metric.memory as Record<string, unknown> | undefined),
    }));
    const launcherPid = launcher?.pid ?? this.armedLauncherPid;
    if (this.baselineRss === null && mainMemory.rss > 0) {
      this.baselineRss = mainMemory.rss;
      this.write('rss-baseline', { baselineRss: this.baselineRss, rendererPid: launcherPid ?? 0 });
    } else if (
      this.baselineRss !== null &&
      this.armedLauncherPid &&
      mainMemory.rss >= Math.max(
        this.baselineRss + CONTENT_TRACE_RSS_DELTA_BYTES,
        this.baselineRss * CONTENT_TRACE_RSS_MULTIPLIER,
      )
    ) {
      this.write('rss-growth-threshold-crossed', {
        baselineRss: this.baselineRss,
        triggerRss: mainMemory.rss,
        rendererPid: this.armedLauncherPid,
      });
      void this.startContentTrace(this.armedLauncherPid);
    }
    this.write('sample', {
      main: {
        rss: mainMemory.rss,
        heapUsed: mainMemory.heapUsed,
        heapTotal: mainMemory.heapTotal,
        external: mainMemory.external,
        arrayBuffers: mainMemory.arrayBuffers,
      },
      system: system ?? {},
      launcher: launcher ?? {},
      processes,
      ipc: this.ledgerSnapshot(),
    });
  }

  recordOutboundIpc(webContentsId: number, channel: string, args: unknown[]): void {
    if (!this.enabled || this.stopped) return;
    const key = `${webContentsId}:${channel}`;
    const entry = this.ledger.get(key) ?? { messages: 0, estimatedBytes: 0 };
    entry.messages += 1;
    entry.estimatedBytes += args.reduce<number>((total, arg) => total + estimateValueBytes(arg), 0);
    this.ledger.set(key, entry);
  }

  /**
   * Arm a bounded Chromium capture for the first meaningful native RSS jump.
   * Starting a fixed 25-second trace at first paint missed the historical leak,
   * which accumulated several minutes later in a healthy Vite session.
   */
  armContentTrace(launcherPid: number): void {
    if (!this.enabled || !this.contentTraceEnabled || this.stopped || launcherPid <= 0) return;
    this.armedLauncherPid = launcherPid;
    this.write('content-trace-armed', { rendererPid: launcherPid });
  }

  async startContentTrace(launcherPid: number): Promise<void> {
    if (
      !this.enabled ||
      !this.contentTraceEnabled ||
      this.contentTraceRunning ||
      this.contentTraceStarted ||
      this.stopped ||
      launcherPid <= 0
    ) {
      return;
    }
    this.contentTraceStarted = true;
    try {
      const dir = path.join(this.electronApp.getPath('userData'), 'diagnostics');
      this.traceFs.mkdirSync(dir, { recursive: true });
      this.contentTracePath = path.join(dir, `native-oom-content-${this.now()}-${process.pid}.json`);
      await this.tracing.startRecording({
        included_categories: [
          'electron',
          'memory-infra',
          'disabled-by-default-memory-infra',
          'disabled-by-default-memory-infra.v8.code_stats',
          'mojom',
          'toplevel',
          'cc',
          'gpu',
          'renderer.scheduler',
        ],
        included_process_ids: [process.pid, launcherPid],
        enable_argument_filter: true,
        recording_mode: 'record-until-full',
        trace_buffer_size_in_kb: 16 * 1024,
      });
      this.contentTraceRunning = true;
      this.write('content-trace-started', { rendererPid: launcherPid });
      console.warn(`[NativeOomTrace] Chromium content trace started; will stop in ${CONTENT_TRACE_DURATION_MS / 1000}s`);
      this.contentTraceTimer = setTimeout(() => void this.stopContentTrace('timeout'), CONTENT_TRACE_DURATION_MS);
      this.contentTraceTimer.unref?.();
      if (this.stopped) await this.stopContentTrace('session-stop-during-start');
    } catch (error: any) {
      this.write('content-trace-start-failed', { reason: 'start-failed' });
      console.warn('[NativeOomTrace] content trace start failed:', error?.message || error);
    }
  }

  async stopContentTrace(reason: string): Promise<void> {
    if (!this.contentTraceRunning) return;
    this.contentTraceRunning = false;
    if (this.contentTraceTimer) {
      clearTimeout(this.contentTraceTimer);
      this.contentTraceTimer = null;
    }
    try {
      await this.tracing.stopRecording(this.contentTracePath || undefined);
      this.write('content-trace-stopped', { reason });
      console.warn(`[NativeOomTrace] Chromium content trace saved: ${this.contentTracePath}`);
    } catch (error: any) {
      this.write('content-trace-stop-failed', { reason: 'stop-failed' });
      console.warn('[NativeOomTrace] content trace stop failed:', error?.message || error);
    }
  }

  stop(reason: string): void {
    if (!this.enabled || this.stopped) return;
    this.write('session-stop', { reason });
    void this.stopContentTrace(reason);
    this.stopped = true;
  }

  private ledgerSnapshot(): Array<{ webContentsId: number; channel: string; messages: number; estimatedBytes: number }> {
    const snapshot = [...this.ledger.entries()].map(([key, value]) => {
      const separator = key.indexOf(':');
      return {
        webContentsId: Number(key.slice(0, separator)),
        channel: key.slice(separator + 1),
        ...value,
      };
    });
    // Each sample reports the preceding heartbeat interval. Clearing here keeps
    // the opt-in diagnostic itself bounded even across long-running sessions or
    // repeated renderer recovery (new webContents IDs).
    this.ledger.clear();
    return snapshot;
  }

  private write(event: string, data: TraceRecord): void {
    if (!this.tracePath) return;
    try {
      if (this.traceFs.existsSync(this.tracePath) && this.traceFs.statSync(this.tracePath).size >= this.maxTraceBytes) return;
      const safe = sanitizeTraceData(data);
      this.traceFs.appendFileSync(
        this.tracePath,
        `${JSON.stringify({ at: new Date().toISOString(), event, ...safe })}\n`,
      );
    } catch {
      // Diagnostics must not affect the product or an OOM path.
    }
  }
}
