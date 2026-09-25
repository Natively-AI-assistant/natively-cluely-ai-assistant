export function permissionsNeedAttention(
  check: { platform?: string; microphone?: string; screen?: string } | null | undefined,
): boolean;

export function resolveMacScreenStatus(
  rawStatus: string,
  probeCapturable: () => Promise<boolean>,
  options?: { timeoutMs?: number },
): Promise<string>;
