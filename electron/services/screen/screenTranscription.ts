import path from 'path';
import { composeScreenDescription } from './screenDescription';
import type { ScreenUnderstandingResult, UserAction } from './ScreenUnderstandingService';
import { hasOnDeviceScreenText } from '../../context-intelligence/question/on-device-screen';
import {
  getScreenshotDescription,
  hashImageSet,
  putScreenshotDescription,
} from './ScreenshotDescriptionStore';

/**
 * Transcribe a screenshot for the CONVERSATION RECORD, once per distinct screen.
 *
 * WHY THIS IS A SEPARATE CALL FROM THE ONE THAT ANSWERS THE TURN
 * One `understand()` call cannot serve both jobs. The answering call is asked to
 * "analyze the attached screenshot and answer concisely", which is correct for
 * the question in front of the user and worthless as a record. Verified live on
 * a real profile: the text stored for a build-failure screenshot was
 *
 *   "Your build failed because you've run out of disk quota. You need to free up
 *    some space and then rerun the command with the --no-cache flag."
 *
 * — second person, paraphrased, and containing neither the FATAL error code nor
 * the ticket reference the user asked about two turns later. Reusing it was the
 * reason a follow-up could never recover an identifier.
 *
 * Widening the answering prompt instead was rejected: it changes the shape of
 * every screenshot answer to serve a consumer the user never sees, which is how
 * the coding-template regression happened.
 *
 * COST AND LATENCY
 * Off the critical path by contract — every caller invokes this AFTER its answer
 * has been delivered. Cached on the attachment set, so a re-captured screen is
 * free, and skipped entirely when the set is already described.
 */
export interface ScreenMemoryOptions {
  /** `false` for automatic captures (see VisionProviderBuildInputs). */
  allowOAuthRecord?: boolean;
  /**
   * The short read to fall back on when the transcription comes back empty
   * (2026-11-06): the answering-style describe call the turn used to make
   * BEFORE its answer, which screenPrepass.ts now skips when the answer reads
   * the image itself. Without it, a failed transcription left later turns only
   * "could not be read", where they used to have that call's summary. Given by
   * the turns that skip the call (typed chat, What to answer) and the turns
   * recorded since (custom buttons, phone questions).
   *
   * The backup's text goes to the conversation record only, NEVER the
   * description store: that store holds transcriptions alone (one writer), so
   * the next capture of this screen still gets a real transcription.
   */
  backupDescribe?: BackupRead;
}

/**
 * The reads that make a SHORT description (DIRECT_VISION_SYSTEM_PROMPT,
 * visionPrompts.ts). Any other action — `dynamic_action`, for one — takes the
 * same long JSON extraction as the transcription, so as a backup it would
 * repeat the read that just failed.
 */
export type BackupRead = Extract<UserAction, 'manual_use_screen' | 'what_to_say'>;

/** Failures the backup cannot get past: it runs under the same policy, with fewer readers. */
const BACKUP_CANNOT_HELP = new Set(['no_vision_provider', 'privacy_blocked', 'scope_blocked']);

/**
 * The last backup reads, by the screenshots' file names (2026-11-06). The store
 * keeps transcriptions only (a paraphrase there would be served as one, and
 * would stop the screen from ever being transcribed), so a backup reaches the
 * conversation through its caller's ring. Direct Assist keeps its own history,
 * not the ring, and reads its backups here (getBackupScreenRead).
 *
 * By name, not bytes: every image Natively saves is named with a UUID, and the
 * name outlives the file, which the screenshot queue deletes past five. In
 * memory only, like the ring.
 */
const BACKUP_READS_KEPT = 32;
const backupReads = new Map<string, string>();

function backupReadKey(imagePaths: readonly string[]): string | null {
  const names = imagePaths.map((imagePath) => path.basename(String(imagePath || ''))).filter(Boolean);
  return names.length && names.length === imagePaths.length ? names.sort().join('\n') : null;
}

function rememberBackupRead(imagePaths: readonly string[], text: string): void {
  const key = backupReadKey(imagePaths);
  if (!key || !text) return;
  backupReads.delete(key);
  backupReads.set(key, text);
  while (backupReads.size > BACKUP_READS_KEPT) {
    const oldest = backupReads.keys().next().value;
    if (oldest === undefined) break;
    backupReads.delete(oldest);
  }
}

/** The backup read kept for this set of screenshots, '' when there is none. */
export function getBackupScreenRead(imagePaths: readonly string[]): string {
  const key = backupReadKey(imagePaths);
  return (key && backupReads.get(key)) || '';
}

/**
 * Which stored transcription a set of screenshot NAMES has (2026-11-06). The
 * store keys on the files' bytes, so once the screenshot queue deletes a file
 * its transcription can no longer be found from the path: Direct Assist, which
 * looks it up that way for its own history, lost the screen of every turn
 * more than five screenshots back. Remembered whenever a set is transcribed or
 * found already transcribed; in memory, like the backup reads.
 */
const TRANSCRIBED_NAMES_KEPT = 64;
const transcribedByName = new Map<string, string>();

function rememberTranscribedNames(imagePaths: readonly string[], sha: string): void {
  const key = backupReadKey(imagePaths);
  if (!key || !sha) return;
  transcribedByName.delete(key);
  transcribedByName.set(key, sha);
  while (transcribedByName.size > TRANSCRIBED_NAMES_KEPT) {
    const oldest = transcribedByName.keys().next().value;
    if (oldest === undefined) break;
    transcribedByName.delete(oldest);
  }
}

/** The stored transcription of this set of screenshots, found by their names; '' when there is none. */
export function getTranscriptionByNames(imagePaths: readonly string[]): string {
  const key = backupReadKey(imagePaths);
  const sha = key ? transcribedByName.get(key) : undefined;
  if (!sha) return '';
  try {
    return getScreenshotDescription(sha)?.description ?? '';
  } catch {
    return '';
  }
}

export async function transcribeScreenForMemory(
  imagePaths: readonly string[],
  /** The turn's question, passed only as disambiguation context. */
  transcriptHint?: string,
  options: ScreenMemoryOptions = {},
): Promise<string> {
  if (!imagePaths.length) return '';
  try {
    const sha = hashImageSet(imagePaths);
    if (!sha) return '';
    const { getScreenUnderstandingService } = require('./ScreenUnderstandingService');
    const { SettingsManager } = require('../SettingsManager');
    const { CredentialsManager } = require('../CredentialsManager');
    const settings = SettingsManager.getInstance();
    const cached = getScreenshotDescription(sha);
    // A description made while this screenshot was being KEPT ON THIS DEVICE
    // is reused only while that setting is still on. With it off, the user is
    // sending this very screenshot to a provider again, so it is read again
    // under today's setting (and the row replaced) rather than recorded as
    // text no cloud model may ever be shown.
    const stale = hasOnDeviceScreenText(cached?.description) && settings.getScreenUnderstandingMode() !== 'private_vision';
    if (cached?.description && !stale) {
      rememberTranscribedNames(imagePaths, sha);
      return cached.description;
    }

    const credentials = CredentialsManager.getInstance();
    const providerScopes = settings.get('providerDataScopes') || {};
    // ONE policy, read the same way as the other call sites — a transcription
    // is still a screenshot leaving the device, and `private_vision` and a
    // denied `screenshots` scope bind it exactly as they bind the answer.
    const read = (userAction: UserAction): Promise<ScreenUnderstandingResult> => getScreenUnderstandingService().understand({
      modeId: 'screen-memory',
      transcript: transcriptHint,
      userAction,
      allowOAuthRecord: options.allowOAuthRecord,
      qualityMode: 'balanced',
      imagePaths: [...imagePaths],
      screenUnderstandingMode: settings.getScreenUnderstandingMode(),
      technicalInterviewVisionFirst: settings.getTechnicalInterviewVisionFirst(),
      providerPolicy: {
        localOnly: settings.getScreenUnderstandingMode() === 'private_vision',
        allowScreenshots: providerScopes.screenshots !== false,
        visionAvailable: credentials.anyVisionProviderConfigured?.() ?? true,
        localVisionAvailable: credentials.anyLocalVisionProviderConfigured?.() ?? false,
      },
    });

    // 'transcribe' is the whole point: it reaches STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
    // which every existing call site missed.
    const result = await read('transcribe');

    const text = composeScreenDescription(result);
    if (text) {
      putScreenshotDescription(sha, text, result?.providerUsed ?? '', result?.modelUsed ?? '');
      rememberTranscribedNames(imagePaths, sha);
      return text;
    }
    if (options.backupDescribe && !BACKUP_CANNOT_HELP.has(String(result?.failureReason ?? ''))) {
      const backup = composeScreenDescription(await read(options.backupDescribe));
      rememberBackupRead(imagePaths, backup);
      console.log('[screen-memory] transcription came back empty; backup read', {
        recorded: Boolean(backup), chars: backup.length, failureReason: result?.failureReason,
      });
      return backup;
    }
    return text;
  } catch (error: any) {
    // NEVER silent: with no transcription the next follow-up cannot answer about
    // this screen, and that is indistinguishable from a bad answer.
    console.warn('[screen-memory] transcription failed — this screenshot will not be recallable:',
      error?.message ?? error);
    return '';
  }
}

/**
 * Wait for a description only up to `waitMs`. Resolves with the text if it
 * came in time, else with null, and `late` still resolves with the eventual
 * text (or '' on failure) so the caller can fill it in afterwards.
 *
 * For a user action that must not hang on a slow reader: Notes › Attach image
 * waited out the whole record, which is 30 s for a signed-in Codex /
 * Antigravity model and 45 s for Ollama.
 */
export async function awaitDescriptionWithin(
  describing: Promise<string>,
  waitMs: number,
): Promise<{ text: string | null; late: Promise<string> }> {
  const late = describing.then((text) => String(text ?? '').trim()).catch(() => '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const text = await Promise.race([
    late,
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); }),
  ]);
  clearTimeout(timer);
  return { text: text || null, late };
}

/**
 * Descriptions still being written for images already attached to the notes,
 * by entry object. Notes › Attach image returns after the pre-pass budget and
 * lets a slower reader finish in the background; the notes writer waits for
 * these before it reads the descriptions (awaitPendingImageDescriptions), so
 * an image attached just before Stop is still described. A WeakMap, not a
 * field on the entry: the entry is saved with the meeting and a Promise is not
 * data.
 */
const pendingDescriptions = new WeakMap<object, Promise<string>>();

export function notePendingImageDescription(entry: object, late: Promise<string>): void {
  const settled: Promise<string> = late
    .catch(() => '')
    .finally(() => { if (pendingDescriptions.get(entry) === settled) pendingDescriptions.delete(entry); });
  pendingDescriptions.set(entry, settled);
}

/**
 * Wait for any still-pending descriptions of these entries, up to the longest
 * record time limit (the Ollama one, 45 s). Never throws; returns at once when
 * nothing is pending.
 */
export async function awaitPendingImageDescriptions(entries: unknown): Promise<void> {
  if (!Array.isArray(entries)) return;
  const pending = entries
    .map((e) => (e && typeof e === 'object' ? pendingDescriptions.get(e) : undefined))
    .filter((p): p is Promise<string> => !!p);
  if (!pending.length) return;
  const { OLLAMA_RECORD_BUDGET_MS } = require('./ScreenUnderstandingService');
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, OLLAMA_RECORD_BUDGET_MS); }),
  ]);
  clearTimeout(timer);
}
