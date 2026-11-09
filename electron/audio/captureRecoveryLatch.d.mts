export const CAPTURE_RECOVERY_SPAN_MS: number;

export interface CaptureWarningLike {
  channel?: 'mic' | 'system' | string;
  terminal?: boolean;
  stuck?: boolean;
  /** false: real audio says nothing about this warning (it never clears by recovery). */
  clearsOnRecovery?: boolean;
  recovered?: boolean;
}

export function warningArmsRecovery(payload: CaptureWarningLike | null | undefined): boolean;

export class CaptureRecoveryLatch {
  constructor(opts?: { spanMs?: number });
  spanMs: number;
  noteWarning(payload: CaptureWarningLike): boolean;
  isArmed(channel: 'mic' | 'system'): boolean;
  noteAudio(channel: 'mic' | 'system', nowMs: number, hasSignal: boolean): boolean;
  reset(): void;
}
