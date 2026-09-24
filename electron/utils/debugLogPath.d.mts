export const DEBUG_LOG_FILENAME: string;
export function resolveDebugLogPath(opts: {
  isPackaged: boolean;
  agentUserData?: string | null;
  documentsDir: () => string;
}): string;
