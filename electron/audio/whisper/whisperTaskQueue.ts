/**
 * One Whisper / Moonshine pass at a time in the worker, finals first.
 *
 * ONNX Runtime's run() is synchronous on the worker thread, and the worker's
 * async message handler used to start every transcribe the moment it arrived.
 * When a model is slower than speech (Whisper Small on an older PC, 5-11 s a
 * pass) the passes piled up and shared the CPU: no result came back until the
 * speaker stopped, and at Stop the drain deadline killed the worker with
 * nothing saved (issue #668, reproduced 2026-10-21 with whisper-tiny posted
 * faster than it runs: 0 of 26 results while audio kept arriving).
 *
 * Now a pass runs only when the one before it is done. Finals, the text that
 * is kept, go in order and ahead of any partial. Only the newest partial is
 * worth running, so an older one waiting is answered as skipped. When a final
 * waited longer than `behindAfterMs`, `behind` is called (at most once per
 * `behindAfterMs`) so the host can tell the user to pick a lighter model.
 */
export interface WhisperQueueTask {
  taskId: string;
  streaming: boolean;
}

export interface WhisperTaskQueueOptions<T extends WhisperQueueTask> {
  run: (task: T) => Promise<void>;
  skip: (task: T) => void;
  behind?: (waitedMs: number) => void;
  now?: () => number;
  behindAfterMs?: number;
}

export function createWhisperTaskQueue<T extends WhisperQueueTask>(opts: WhisperTaskQueueOptions<T>) {
  const now = opts.now ?? (() => Date.now());
  const behindAfterMs = opts.behindAfterMs ?? 30_000;
  const finals: Array<{ task: T; at: number }> = [];
  let partial: T | null = null;
  let running = false;
  let lastBehindAt = Number.NEGATIVE_INFINITY;

  const dropPartial = () => {
    if (!partial) return;
    const old = partial;
    partial = null;
    opts.skip(old);
  };

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        let task: T;
        const final = finals.shift();
        if (final) {
          const waited = now() - final.at;
          if (waited > behindAfterMs && now() - lastBehindAt >= behindAfterMs) {
            lastBehindAt = now();
            opts.behind?.(waited);
          }
          task = final.task;
        } else if (partial) {
          task = partial;
          partial = null;
        } else {
          break;
        }
        // run() posts its own result or error; a throw here is a bug in it,
        // and must not stop the tasks queued behind.
        try { await opts.run(task); } catch { /* reported by run() */ }
      }
    } finally {
      running = false;
    }
  };

  return {
    push(task: T): void {
      // A newer partial covers more audio than a waiting one; a final closes
      // the segment the waiting partial was a preview of.
      dropPartial();
      if (task.streaming) partial = task;
      else finals.push({ task, at: now() });
      void drain();
    },
    /** Tasks waiting, not counting the one running. */
    get waiting(): number {
      return finals.length + (partial ? 1 : 0);
    },
  };
}
