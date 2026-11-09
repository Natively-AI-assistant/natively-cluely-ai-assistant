export declare const MAX_PENDING_EVENTS: number;

export interface OrchestratorEventChannel<E> {
  emit(e: E): void;
  attach(fn: (e: E) => void): () => void;
  pendingCount(): number;
}

export function createOrchestratorEventChannel<E>(options?: { maxPending?: number }): OrchestratorEventChannel<E>;
