import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Cache of screenshot transcriptions, keyed by the exact bytes of the image.
 *
 * Describing a screen costs a vision call with a multi-second budget
 * (SCREEN_UNDERSTANDING_TOTAL_BUDGET_MS), and users re-attach the SAME screen
 * constantly — the same error dialog, the same slide, a fresh capture of an
 * unchanged window. Every one of those paid the full cost again, and the result
 * was thrown away when the in-memory conversation ring died with the session.
 *
 * WHY A CONTENT HASH AND NOT ImageHashService
 * ImageHashService.computeHash is a 16x16 grayscale average hash, built for
 * change detection: it is SUPPOSED to collapse near-identical frames. Used as a
 * cache key it would serve one screen's transcription for a different screen
 * that merely looks similar at that resolution — two terminal windows, two
 * slides from one deck, the same dialog with a different error code. The whole
 * point of this feature is answering "what was the error code", so a
 * near-collision is not a stale cache entry, it is a confident lie about
 * something the user can see with their own eyes.
 *
 * FAILURE POLICY
 * Every method degrades to "no cache" rather than throwing. This is an
 * optimisation over a path that already works without it; a corrupt row or a
 * closed database must never fail a live answer.
 */

/** Rows retained. Bounds the table without needing a scheduled sweep. */
export const MAX_SCREENSHOT_DESCRIPTIONS = 500;

interface DescriptionRow {
  description: string;
  provider: string;
  model: string;
}

type SqliteDb = {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
};

function db(): SqliteDb | null {
  try {
    const { DatabaseManager } = require('../../db/DatabaseManager');
    return DatabaseManager.getInstance().getDb() ?? null;
  } catch {
    return null;
  }
}

/** sha256 of the file's bytes. Null when the file is gone or unreadable — the
 *  expected case once ScreenshotHelper has unlinked it past its 5-deep queue. */
export function hashImageFile(imagePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * The key for an attachment SET, which is the unit a description actually
 * describes: one `understand()` call over N images returns ONE result about all
 * of them, so there is no honest way to attribute it to any single image.
 *
 * Keying per-image meant a multi-image turn could never be cached — it could
 * not be WRITTEN without attributing one description to one arbitrary screen,
 * so it was never READ either. Keying by the set removes the attribution
 * question instead of answering it wrongly.
 *
 * Sorted before hashing so the same screenshots in a different order are the
 * same set. Null if ANY member is unreadable: a partial set is a different set,
 * and serving its description would describe screens that are not in the turn.
 */
export function hashImageSet(imagePaths: readonly string[]): string | null {
  if (!imagePaths.length) return null;
  const members: string[] = [];
  for (const imagePath of imagePaths) {
    const hash = hashImageFile(imagePath);
    if (!hash) return null;
    members.push(hash);
  }
  if (members.length === 1) return members[0];
  return crypto.createHash('sha256').update(members.sort().join(':')).digest('hex');
}

export function getScreenshotDescription(imageSha256: string): DescriptionRow | null {
  if (!imageSha256) return null;
  try {
    const row = db()?.prepare(
      'SELECT description, provider, model FROM screenshot_descriptions WHERE image_sha256 = ?',
    ).get(imageSha256) as DescriptionRow | undefined;
    return row?.description ? row : null;
  } catch {
    return null;
  }
}

export function putScreenshotDescription(
  imageSha256: string,
  description: string,
  provider = '',
  model = '',
): void {
  if (!imageSha256 || !description.trim()) return;
  try {
    const handle = db();
    if (!handle) return;
    handle.prepare(
      `INSERT INTO screenshot_descriptions (image_sha256, description, provider, model, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(image_sha256) DO UPDATE SET
         description = excluded.description,
         provider    = excluded.provider,
         model       = excluded.model,
         created_at  = excluded.created_at`,
    ).run(imageSha256, description, provider, model, Date.now());
    // Pruned on write rather than on a timer: the only moment the table can
    // grow is here, so this is the only moment it can need trimming.
    //
    // The cutoff form, NOT `WHERE image_sha256 NOT IN (SELECT … LIMIT n)`.
    // Measured with EXPLAIN QUERY PLAN, the NOT IN version is
    // "SCAN screenshot_descriptions" + "CREATE BLOOM FILTER" — a full table
    // scan on EVERY write, and this now runs after every screenshot turn on
    // three paths. This version is "SEARCH … USING COVERING INDEX".
    //
    // (created_at, rowid), not created_at alone: Date.now() is millisecond
    // resolution, so writes in a burst TIE, and `created_at < cutoff` keeps
    // every tied row. Measured, a cap of 500 left 514 rows after 601 rapid
    // writes — and in the limit, if every row shares one millisecond, nothing
    // is ever pruned and "bounded by construction" is false. rowid makes the
    // order total, so the cap is exact: the same 601 writes with ALL timestamps
    // identical leave exactly 500.
    //
    // With fewer than the cap rows the subquery is NULL and the comparison
    // matches nothing, which is the intended no-op.
    handle.prepare(
      `DELETE FROM screenshot_descriptions WHERE (created_at, rowid) < (
         SELECT created_at, rowid FROM screenshot_descriptions
         ORDER BY created_at DESC, rowid DESC LIMIT 1 OFFSET ?
       )`,
    ).run(MAX_SCREENSHOT_DESCRIPTIONS - 1);
  } catch {
    /* cache write is best-effort — never fail the turn that produced it */
  }
}

/** Convenience for the read side: hash the attachment set and look it up. */
export function getDescriptionForImageSet(imagePaths: readonly string[]): string | null {
  const sha = hashImageSet(imagePaths);
  return sha ? getScreenshotDescription(sha)?.description ?? null : null;
}
