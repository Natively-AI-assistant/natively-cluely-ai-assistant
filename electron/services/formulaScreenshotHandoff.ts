/**
 * Hands the images for a ⌘/Ctrl+Y capture's formulas (issue #645) to the
 * answer that needs them.
 *
 * When the page text has formulas drawn only as SVG, the extension sends its
 * own image of them with the text, or, when it could not draw them, main takes
 * a screenshot after the ack. The overlay copies its attachments when an
 * answer starts, so in the one-motion ⌘Y→Enter flow the answer is already on
 * its way when those images are saved: attached in the overlay they would miss
 * this answer and ride the next question instead. So an answer request whose
 * page text has formula markers claims them while they are being saved or
 * taken and gets them from main; only unclaimed ones are attached in the
 * overlay. The extension's image is ready when the ack is, so that wait is a
 * file write; the screenshot fallback waits for the capture.
 *
 * Pure: no Electron, so the timing cases are testable on any OS.
 */

import path from 'node:path';
import { hasFormulaMarker, UNREADABLE_FORMULA_MARKER } from './pageCaptureFallback';

/**
 * How long an automatic capture's formula images wait for the answer that
 * pulled the capture. It asks as soon as the capture is in, so this only
 * keeps them from a later answer about another page.
 */
export const AUTO_FORMULA_IMAGE_MAX_AGE_MS = 10_000;

/** Name prefix of the extension's formula images (ScreenshotHelper.addFormulaImages). */
export const FORMULA_IMAGE_PREFIX = 'formulas-';

export function isFormulaImagePath(imagePath: string): boolean {
  return path.basename(imagePath).startsWith(FORMULA_IMAGE_PREFIX);
}

/**
 * `pageText` as the answer request will send it: each `[formula N, see image]`
 * that none of `imagePaths` shows becomes [formula not captured]. Formula
 * images lose their place to the user's own images when an answer can take
 * no more, and the text must not point the model at one it does not have.
 * Unchanged when a formula image in the request has no known range.
 */
export function markMissingFormulas(
  pageText: string,
  imagePaths: string[] | undefined,
  rangeOf: (imagePath: string) => [number, number] | undefined,
): string {
  if (!/\[formula \d+, see image\]/.test(pageText)) return pageText;
  const ranges: Array<[number, number]> = [];
  for (const p of imagePaths ?? []) {
    if (!isFormulaImagePath(p)) continue;
    const range = rangeOf(p);
    if (!range) return pageText;
    ranges.push(range);
  }
  return pageText.replace(/\[formula (\d+), see image\]/g, (marker, n: string) =>
    ranges.some(([first, last]) => Number(n) >= first && Number(n) <= last) ? marker : UNREADABLE_FORMULA_MARKER,
  );
}

export interface FormulaShot {
  /** True once an answer request is waiting for these images. */
  readonly claimed: boolean;
  /**
   * Called when the images exist, right before they would be attached in the
   * overlay. False when a waiting request takes them instead.
   */
  deliverToOverlay(): boolean;
  /** The image paths, or null when none were or will be saved. Only the first call counts. */
  settle(paths: string[] | null): void;
}

export interface FormulaScreenshotHandoffOptions {
  /** A capture's page text can be used minutes later; its screenshot only within the motion that took it. */
  maxAgeMs?: number;
  /** Long enough for the extension's ack and one screenshot (the fallback). */
  waitMs?: number;
  /** Both answer requests take at most five images. */
  maxImages?: number;
  now?: () => number;
}

interface Shot extends FormulaShot {
  at: number;
  maxAgeMs: number;
  done: Promise<string[] | null>;
  claimed: boolean;
  delivered: boolean;
}

export class FormulaScreenshotHandoff {
  private shot: Shot | null = null;
  private readonly maxAgeMs: number;
  private readonly waitMs: number;
  private readonly maxImages: number;
  private readonly now: () => number;

  constructor(opts: FormulaScreenshotHandoffOptions = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? 60_000;
    this.waitMs = opts.waitMs ?? 6_000;
    this.maxImages = opts.maxImages ?? 5;
    this.now = opts.now ?? Date.now;
  }

  /**
   * At the start of a ⌘/Ctrl+Y capture: the answer request can arrive before
   * the ack. An automatic capture opens one for the answer that pulled it,
   * which asks right away: `maxAgeMs` keeps a later answer from taking images
   * that one did not.
   */
  open(opts: { maxAgeMs?: number } = {}): FormulaShot {
    let resolve: (paths: string[] | null) => void = () => {};
    const done = new Promise<string[] | null>((r) => { resolve = r; });
    const shot: Shot = {
      at: this.now(),
      maxAgeMs: opts.maxAgeMs ?? this.maxAgeMs,
      done,
      claimed: false,
      delivered: false,
      settle: (paths) => resolve(paths),
      deliverToOverlay: () => {
        if (shot.claimed) return false;
        shot.delivered = true;
        return true;
      },
    };
    this.shot = shot;
    return shot;
  }

  /**
   * `imagePaths` for an answer request carrying `pageText`, with the formula
   * images added when the overlay could not have had them yet; waits for them
   * while they are being saved or taken. Unchanged when the text has no
   * formula markers, the images are already in the overlay, another request
   * took them, or they do not come in time (they are then attached in the
   * overlay when they do). The user's own images come first: formula images
   * only fill the places left.
   */
  async addTo(pageText: string | undefined, imagePaths: string[] | undefined): Promise<string[] | undefined> {
    const shot = this.shot;
    if (!shot || shot.claimed || shot.delivered) return imagePaths;
    if (!hasFormulaMarker(pageText)) return imagePaths;
    if (this.now() - shot.at > shot.maxAgeMs) return imagePaths;
    shot.claimed = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), this.waitMs); });
    const paths = await Promise.race([shot.done, timedOut]);
    clearTimeout(timer);
    if (paths === 'timeout') {
      shot.claimed = false;
      return imagePaths;
    }
    if (this.shot === shot) this.shot = null;
    // Formula images already in the request are an earlier capture's: their
    // numbers are not this text's.
    const current = (imagePaths ?? []).filter((p) => !isFormulaImagePath(p));
    const added = (paths ?? []).filter((p) => p && !current.includes(p)).slice(0, Math.max(0, this.maxImages - current.length));
    if (!added.length && current.length === (imagePaths ?? []).length) return imagePaths;
    return [...current, ...added];
  }
}
