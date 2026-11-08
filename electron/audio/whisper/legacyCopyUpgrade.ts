/**
 * Moves the selected local model off the copy an earlier version downloaded,
 * on its own, outside meetings.
 *
 * Whisper used to come from Xenova's exports. Their encoders return every
 * layer's attention map as an output: Whisper Small peaks at ~3 GB a call
 * against 0.65 GB for onnx-community's, with the same text (see
 * WhisperModelInfo.repoId). A machine that downloaded the old copy keeps
 * loading it, and with one worker per channel that is ~6 GB for Small. Until
 * now only a Settings button moved it (issue #668: Whisper Small on a Windows
 * PC that never produced a transcript).
 *
 * What it does, for the models Local STT is set to use:
 *  - starts the download of the current copy when no meeting is running,
 *    through the download service (resumable, one owner per model). The old
 *    copy keeps working meanwhile: a meeting never waits for this;
 *  - pauses it when a meeting starts (the partial files stay), including one
 *    still on its way to starting, and resumes it a minute after the meeting
 *    ends, once the meeting's workers and summary are done. A stop is
 *    cooperative (onnxWorkerShutdown.ts): a download already inside its
 *    final model load finishes that load first;
 *  - leaves a download started from Settings alone;
 *  - skips a model when the disk lacks room for the new copy next to the old
 *    one. A cancel the user made, or a download that failed, is not retried
 *    this session; a start that is refused is retried at the next chance, up
 *    to three times (the worker of a paused download may still be stopping).
 *    Settings still offers Update, and the next launch tries again;
 *  - when the update completes, `onUpgraded` lets the host re-warm the model
 *    from the new copy, after the meeting when one is running. The launch
 *    sweep then deletes the old copy.
 *
 * No OS-specific behaviour: the download service and the sweep handle paths
 * and file locking per platform.
 */

import type { LocalModelDownloadStatus } from '../../services/LocalModelDownloadService';

/** Room left on the disk after the new copy, besides the copy itself. */
export const LEGACY_UPGRADE_DISK_MARGIN_BYTES = 2 * 1024 ** 3;
/** Wait after a meeting ends before resuming, for its teardown and summary. */
export const LEGACY_UPGRADE_RESUME_DELAY_MS = 60_000;
const MAX_REFUSED_STARTS = 3;

export interface LegacyCopyUpgradeDeps {
  /** The local models in use (global + per-channel); empty when Local STT is not the provider. */
  selectedModelIds(): string[];
  /** Runs from an earlier version's copy and a current copy exists to download. */
  isUpgradeAvailable(modelId: string): boolean;
  isMeetingActive(): boolean;
  /** The service's state for this model, null when it has none. */
  downloadStatus(modelId: string): LocalModelDownloadStatus | null;
  start(modelId: string): Promise<{ success: boolean; error?: string; alreadyDownloading?: boolean }>;
  cancel(modelId: string): void;
  /** Bytes the current copy needs. 0 when unknown. */
  downloadBytes(modelId: string): number;
  /** Free bytes where the models live, null when it cannot be read. */
  freeDiskBytes(): number | null;
  /** Called outside meetings only. */
  onUpgraded?(modelId: string): void;
  /** Runs `fn` after `ms`; setTimeout (unref'd) when omitted. */
  later?(fn: () => void, ms: number): void;
  log?(message: string): void;
}

const IN_FLIGHT: ReadonlySet<LocalModelDownloadStatus> = new Set(['downloading', 'verifying']);

export function createLegacyCopyUpgrader(deps: LegacyCopyUpgradeDeps) {
  const log = (m: string) => deps.log?.(`[LegacyCopyUpgrade] ${m}`);
  const later = deps.later ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    (t as any).unref?.();
  });
  // Downloads this started (and so may pause), and the ones paused for a meeting.
  const ours = new Set<string>();
  const pausedForMeeting = new Set<string>();
  // Not retried until the next launch.
  const gaveUp = new Set<string>();
  const refusedStarts = new Map<string, number>();
  // Completed during a meeting: re-warmed after it.
  const upgradedDuringMeeting = new Set<string>();
  let running = false;

  function pause(id: string): void {
    pausedForMeeting.add(id);
    log(`${id}: paused for the meeting`);
    try { deps.cancel(id); } catch { /* the download service logs its own failures */ }
  }

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const id of new Set(deps.selectedModelIds())) {
        if (deps.isMeetingActive()) return;
        if (gaveUp.has(id) || !deps.isUpgradeAvailable(id)) continue;
        const status = deps.downloadStatus(id);
        // Already on its way, started here or from Settings.
        if (status && IN_FLIGHT.has(status)) continue;
        const free = deps.freeDiskBytes();
        const need = deps.downloadBytes(id) + LEGACY_UPGRADE_DISK_MARGIN_BYTES;
        if (free !== null && free < need) {
          log(`${id}: not enough free disk for the lighter copy (${Math.round(free / 1024 ** 2)} MB free, ${Math.round(need / 1024 ** 2)} MB wanted); Settings › Audio still offers Update`);
          continue;
        }
        ours.add(id);
        pausedForMeeting.delete(id);
        log(`${id}: downloading the lighter copy in the background`);
        let result: Awaited<ReturnType<LegacyCopyUpgradeDeps['start']>>;
        try {
          result = await deps.start(id);
        } catch (e: any) {
          result = { success: false, error: e?.message ?? String(e) };
        }
        if (result.alreadyDownloading) {
          // Someone else's download got there first: theirs to run.
          ours.delete(id);
          continue;
        }
        if (!result.success) {
          ours.delete(id);
          const refused = (refusedStarts.get(id) ?? 0) + 1;
          refusedStarts.set(id, refused);
          if (refused >= MAX_REFUSED_STARTS) gaveUp.add(id);
          log(`${id}: the update did not start (${result.error ?? 'unknown'})${refused >= MAX_REFUSED_STARTS ? '; not retried until the next launch' : ''}`);
          continue;
        }
        refusedStarts.delete(id);
        // A meeting began while start() was on its way.
        if (deps.isMeetingActive()) pause(id);
      }
    } finally {
      running = false;
    }
  }

  return {
    run,

    /** Call on every meeting start and stop. */
    onMeetingStateChanged(active: boolean): void {
      if (active) {
        for (const id of ours) {
          const status = deps.downloadStatus(id);
          if (status && IN_FLIGHT.has(status)) pause(id);
        }
        return;
      }
      later(() => {
        if (deps.isMeetingActive()) return;
        for (const id of upgradedDuringMeeting) {
          try { deps.onUpgraded?.(id); } catch { /* the host's re-warm is best-effort */ }
        }
        upgradedDuringMeeting.clear();
        void run();
      }, LEGACY_UPGRADE_RESUME_DELAY_MS);
    },

    /** Call with every download-service state change. */
    onDownloadStatus(modelId: string, status: LocalModelDownloadStatus): void {
      if (!ours.has(modelId) || IN_FLIGHT.has(status)) return;
      if (status === 'complete') {
        ours.delete(modelId);
        pausedForMeeting.delete(modelId);
        log(`${modelId}: now on the lighter copy`);
        if (deps.isMeetingActive()) {
          upgradedDuringMeeting.add(modelId);
          return;
        }
        try { deps.onUpgraded?.(modelId); } catch { /* the host's re-warm is best-effort */ }
        return;
      }
      // A pause for a meeting reads as 'cancelled' and resumes after it.
      if (status === 'cancelled' && pausedForMeeting.has(modelId)) return;
      ours.delete(modelId);
      gaveUp.add(modelId);
      log(`${modelId}: the update ended as ${status}; not retried until the next launch`);
    },
  };
}

export type LegacyCopyUpgrader = ReturnType<typeof createLegacyCopyUpgrader>;
