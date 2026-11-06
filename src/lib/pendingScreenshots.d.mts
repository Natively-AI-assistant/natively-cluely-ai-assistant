export declare const PENDING_SHOT_WAIT_MS: number;

export interface PendingScreenshots<T extends { path: string }> {
  track(capture: Promise<T | null | undefined>): Promise<T | null>;
  inFlight(): boolean;
  settle(timeoutMs?: number): Promise<T[]>;
  claimed(path: string): boolean;
}

export declare function createPendingScreenshots<T extends { path: string }>(): PendingScreenshots<T>;
