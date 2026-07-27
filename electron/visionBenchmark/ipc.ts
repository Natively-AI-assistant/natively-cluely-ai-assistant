import { app, dialog, shell } from 'electron';
import path from 'node:path';
import type { AppState } from '../main';
import { resolveBenchmarkModels } from './models';
import { buildBenchmarkPrompt, BENCHMARK_MODE_OPTIONS, BENCHMARK_PROMPT_OPTIONS } from './prompts';
import { exportBenchmarkSession } from './report';
import { VisionBenchmarkRunner } from './runner';
import { DEFAULT_BENCHMARK_QUESTION, type ManualQualityRatings, type VisionBenchmarkConfig, type VisionBenchmarkSession } from './types';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => void;

export function registerVisionBenchmarkIpc(safeHandle: SafeHandle, appState: AppState): void {
  if (process.env.NATIVELY_ENABLE_BENCHMARKS !== 'true') return;
  const repositoryRoot = app.getAppPath();
  let runner: VisionBenchmarkRunner | null = null;
  let session: VisionBenchmarkSession | null = null;

  // Benchmark credentials are deliberately isolated from normal Natively
  // provider selection. Never fall back to stored app credentials or another
  // environment variable: benchmark sessions must use this key only.
  const apiKey = (): string => (process.env.GEMINI_API_KEY_1 || '').trim();

  safeHandle('vision-benchmark:info', async () => ({
    enabled: true,
    models: resolveBenchmarkModels(repositoryRoot),
    promptOptions: BENCHMARK_PROMPT_OPTIONS,
    modeOptions: BENCHMARK_MODE_OPTIONS,
    defaultQuestion: DEFAULT_BENCHMARK_QUESTION,
    hasCredentials: Boolean(apiKey()),
  }));
  safeHandle('vision-benchmark:pick-image', async () => {
    const result: any = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Screenshots', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    return result.canceled ? { cancelled: true } : { cancelled: false, path: result.filePaths[0] };
  });
  safeHandle('vision-benchmark:preview-prompt', async (_event, input: Pick<VisionBenchmarkConfig, 'promptKind' | 'mode' | 'question' | 'imagePath'>) =>
    buildBenchmarkPrompt(input.promptKind, input.mode, input.question, Boolean(input.imagePath)));
  safeHandle('vision-benchmark:run', async (event, config: VisionBenchmarkConfig) => {
    if (runner) return { ok: false, error: 'A benchmark is already running.' };
    runner = new VisionBenchmarkRunner({ apiKey: apiKey() });
    try {
      session = await runner.run(config, resolveBenchmarkModels(repositoryRoot), {
        onSession: (next) => event.sender.send('vision-benchmark:progress', { type: 'session', session: next }),
        onRunStarted: (current) => event.sender.send('vision-benchmark:progress', { type: 'run-started', current }),
        onRunCompleted: (run) => event.sender.send('vision-benchmark:progress', { type: 'run-completed', run }),
      });
      return { ok: true, session };
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error) };
    } finally {
      runner = null;
    }
  });
  safeHandle('vision-benchmark:cancel', async () => {
    runner?.cancel();
    return { ok: true };
  });
  safeHandle('vision-benchmark:rate', async (_event, input: { runId: string; ratings: ManualQualityRatings }) => {
    const run = session?.runs.find((candidate) => candidate.id === input.runId);
    if (!run) return { ok: false, error: 'Run not found.' };
    for (const value of Object.values(input.ratings)) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 5)) return { ok: false, error: 'Ratings must be integers from 1 to 5.' };
    }
    run.manualRatings = input.ratings;
    return { ok: true };
  });
  safeHandle('vision-benchmark:export', async () => {
    if (!session) return { ok: false, error: 'No benchmark session is available.' };
    const exportPath = await exportBenchmarkSession(session, repositoryRoot);
    return { ok: true, path: exportPath };
  });
  safeHandle('vision-benchmark:show-export', async (_event, exportPath: string) => {
    const root = path.resolve(repositoryRoot, 'benchmark-results');
    const target = path.resolve(exportPath);
    if (!target.startsWith(root + path.sep)) return { ok: false, error: 'Invalid report path.' };
    shell.showItemInFolder(target);
    return { ok: true };
  });
}
