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
  fatal_source?: string;
  error_name?: string;
  error_code?: string;
  started_up?: boolean;
  crash_where?: string;
  crash_file?: string;
  crash_line?: number;
  crash_col?: number;
  last_event?: string;
  startup_phase?: string;
  arch?: string;
  translated?: boolean;
  os_version?: number;
}

export const FATAL_SOURCES: readonly string[];
export const ERROR_NAMES: readonly string[];
export const ERROR_CODES: readonly string[];
export const STARTUP_PHASES: readonly string[];
export const LAST_EVENTS: readonly string[];
export const CRASH_WHERE: readonly string[];
export const CRASH_FILES: readonly string[];
export const ARCHES: readonly string[];
export function toSnake(label: string): string;
export function stackFacts(stack: unknown): { where?: string; file?: string; line?: number; col?: number };
export function fatalErrorFacts(err: unknown): { name?: string; code?: string; where?: string; file?: string; line?: number; col?: number };

export const STALE_MARKER_MS: number;
export const LOG_REACH_MS: number;

export function summarizeRunEnd(
  marker: unknown,
  currentVersion?: string,
  evidence?: { lastLogAt?: number | null; bootAt?: number | null },
): { key: string; props: RunEndProps } | null;
