export type RunEndHow = 'quit' | 'restart' | 'update' | 'os_shutdown' | 'signal' | 'crash' | 'vanished';

export interface RunEndProps {
  how: RunEndHow;
  minutes?: number;
  renderer_crashes?: number;
  gpu_crashes?: number;
  helper_crashes?: number;
  out_of_memory?: boolean;
  updated?: boolean;
  computer_restarted?: boolean;
}

export const STALE_MARKER_MS: number;
export const LOG_REACH_MS: number;

export function summarizeRunEnd(
  marker: unknown,
  currentVersion?: string,
  evidence?: { lastLogAt?: number | null; bootAt?: number | null },
): { key: string; props: RunEndProps } | null;
