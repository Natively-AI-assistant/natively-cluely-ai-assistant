/**
 * Helpers for paste / drag-drop image attach into the overlay tray (issue #351).
 * Images join the same screenshot queue a capture would, via addExternalImage.
 */

import path from 'node:path';

export type OverlayImageExt = 'png' | 'jpg' | 'webp';

export const OVERLAY_PASTE_IMAGE_PREFIX = 'paste-';
export const OVERLAY_DROP_IMAGE_PREFIX = 'drop-';
/** Largest dropped file the overlay reads (the phone upload cap is 12 MB). */
export const OVERLAY_ATTACH_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

/** The names the overlay accepts; src/lib/overlayImageDrop.mjs filters drops by the same list. */
export const OVERLAY_IMAGE_SUFFIXES: Record<string, OverlayImageExt> = {
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'webp',
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Map a file path suffix to a supported image extension. */
export function imageExtFromPath(filePath: string | undefined | null): OverlayImageExt | null {
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  return OVERLAY_IMAGE_SUFFIXES[ext] ?? null;
}

/**
 * What the bytes really are. A name can say .png over a HEIC, a PDF or a
 * truncated download; the saved copy is named by this, never by the name.
 */
export function imageExtFromBytes(data: Buffer): OverlayImageExt | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
