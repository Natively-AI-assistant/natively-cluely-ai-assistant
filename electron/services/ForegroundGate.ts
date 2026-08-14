// electron/services/ForegroundGate.ts
//
// BACKGROUND-JOB ISOLATION (manual regression 2026-06-12, P9).
//
// After a meeting ends, summary generation + RAG chunking + embedding
// persistence all run in the Electron MAIN process. better-sqlite3 calls are
// SYNCHRONOUS, so a draining embedding queue interleaves dozens of blocking DB
// statements with the user's manual questions — the "app lags/hangs after ~50
// questions" report. There is no thread to move them to without a worker
// rewrite; what we CAN do cheaply and safely is make every background drain
// loop YIELD while a foreground answer is in flight.
//
// Priority model (spec):
//   P0  UI/manual/WTA answer in flight  → background loops PAUSE
//   P1  active STT transcript           → unaffected (already event-driven)
//   P2+ live RAG / meeting summary / embeddings → check the gate between items
//
// Usage:
//   ForegroundGate.begin('manual')   // when a manual/WTA request starts
//   ForegroundGate.end('manual')     // in its finally
//   await ForegroundGate.waitUntilIdle()  // background loops, between items
//
// The gate is advisory and self-healing: a leaked begin() auto-expires after
// 60s so a crashed request can never freeze background processing forever.

const FOREGROUND_TIMEOUT_MS = 60_000;
const POLL_MS = 250;

class ForegroundGateImpl {
    private active = new Map<string, number>(); // token → startedAt

    /** Mark a foreground request as in flight. Returns a token for end(). */
    begin(kind: 'manual' | 'wta' | 'ui' = 'manual'): string {
        const token = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.active.set(token, Date.now());
        return token;
    }

    end(token: string): void {
        this.active.delete(token);
    }

    /** True when any un-expired foreground request is in flight. */
    isBusy(): boolean {
        if (this.active.size === 0) return false;
        const now = Date.now();
        for (const [token, startedAt] of this.active) {
            if (now - startedAt > FOREGROUND_TIMEOUT_MS) this.active.delete(token); // leaked
        }
        return this.active.size > 0;
    }

    /**
     * Resolve once no foreground work is in flight (checked every 250ms,
     * hard-capped at `maxWaitMs` so background work always eventually runs).
     */
    async waitUntilIdle(maxWaitMs = 30_000): Promise<void> {
        const start = Date.now();
        while (this.isBusy() && Date.now() - start < maxWaitMs) {
            await new Promise((r) => setTimeout(r, POLL_MS));
        }
    }
}

export const ForegroundGate = new ForegroundGateImpl();
