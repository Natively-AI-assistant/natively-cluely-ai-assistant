export const STT_RECONNECT_NOTICE_DELAY_MS: number;

export class SttReconnectNotice<P = any> {
  constructor(opts: {
    /** Sends the notice; return false to decline (then nothing counts as shown). */
    show: (payload: P) => boolean | void;
    delayMs?: number;
    setTimer?: (fn: () => void, ms: number) => any;
    clearTimer?: (handle: any) => void;
    /** Which meeting it is: a wait or a shown notice from an earlier one never carries over. */
    epoch?: () => unknown;
  });
  /** The notice has been sent and not settled since. */
  showing: boolean;
  /** A show is scheduled. */
  readonly pending: boolean;
  retrying(payload: P): void;
  persistent(payload: P): void;
  /** Cancels a pending show; returns whether the notice had been shown. */
  settle(): boolean;
}
