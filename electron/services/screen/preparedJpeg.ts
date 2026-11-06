// The JPEG a screenshot is uploaded as, made once and ahead of time (2026-11-06).
//
// Every send used to re-read the PNG a capture wrote, decode it, resize it and
// encode it as JPEG before the upload could start. The bytes for a given file
// and size are always the same, so they are made here once: right after ⌘/Ctrl+H
// (prewarm, in the background while the user types) and reused by the send.
// Natively API and the built-in vision adapters each ask for their own size, so
// both are kept.
//
// Shared by macOS and Windows: sharp runs off the main thread on both.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { visionImageEdge } from '../../utils/phoneImage';

export interface JpegSpec {
  /** Longest edge in px; smaller images are never enlarged. */
  edge: number;
  quality: number;
}

/** What streamWithNatively / generateWithNatively upload (Natively API). */
export const NATIVELY_API_JPEG: JpegSpec = { edge: 1920, quality: 85 };
/** What processImage uploads for a screen capture when not shrinking (built-in adapters). */
export const SCREEN_CAPTURE_JPEG: JpegSpec = { edge: visionImageEdge({ phoneImage: false, shrink: false }), quality: 80 };

export type JpegEncoder = (filePath: string, spec: JpegSpec) => Promise<Buffer>;

const MAX_ENTRIES = 24;
const entries = new Map<string, Promise<Buffer>>();

const encodeWithSharp: JpegEncoder = (filePath, { edge, quality }) =>
  sharp(filePath)
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();

/** Size + mtime ride in the key, so a file rewritten under the same name is never served stale. */
function keyFor(filePath: string, spec: JpegSpec): string | null {
  try {
    const st = fs.statSync(filePath);
    return `${path.resolve(filePath)}|${st.size}|${st.mtimeMs}|${spec.edge}|${spec.quality}`;
  } catch {
    return null;
  }
}

/**
 * The JPEG for `filePath` at `spec`: the prewarmed one when there is one,
 * otherwise encoded now (and kept). Rejects exactly as an uncached encode
 * would, so callers keep their own fallbacks; a failure is never cached.
 */
export function preparedJpeg(filePath: string, spec: JpegSpec, encode: JpegEncoder = encodeWithSharp): Promise<Buffer> {
  const key = keyFor(filePath, spec);
  if (!key) return encode(filePath, spec);
  const hit = entries.get(key);
  if (hit) {
    entries.delete(key);
    entries.set(key, hit);
    return hit;
  }
  const job = encode(filePath, spec);
  entries.set(key, job);
  job.catch(() => {
    if (entries.get(key) === job) entries.delete(key);
  });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return job;
}

/** Start the upload JPEGs for a fresh capture. Fire-and-forget; errors surface at send time. */
export function prewarmPreparedJpeg(
  filePath: string,
  specs: JpegSpec[] = [NATIVELY_API_JPEG, SCREEN_CAPTURE_JPEG],
  encode: JpegEncoder = encodeWithSharp,
): void {
  for (const spec of specs) preparedJpeg(filePath, spec, encode).catch(() => {});
}

/** Tests only. */
export function __resetPreparedJpegForTests(): void {
  entries.clear();
}
