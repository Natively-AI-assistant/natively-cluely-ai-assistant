/**
 * Paste and drop decisions for the overlay's image attach (issue #351).
 * Electron 32 removed `File.path`; preload's attachLocalImage turns each File
 * into its path with webUtils.getPathForFile.
 */

/** The names the overlay accepts; electron/utils/overlayImageAttach.ts reads the same list. */
export const OVERLAY_IMAGE_NAME = /\.(png|jpe?g|webp)$/i;

/**
 * The PNG, JPEG and WebP files among `files`, by name.
 *
 * @template {{ name?: unknown }} F
 * @param {ArrayLike<F> | null | undefined} files
 * @returns {F[]}
 */
export function imageFilesFromDrop(files) {
  if (!files || files.length === 0) return [];
  return Array.from(files).filter((file) => OVERLAY_IMAGE_NAME.test(typeof file?.name === 'string' ? file.name : ''));
}

/**
 * What a paste into the Ask box does. Any text pastes natively, even beside an
 * image: Excel, Word and PowerPoint copy a picture of the copied text too.
 * Without text, an image item is attached; `files` are the image files a
 * copied file brings (Windows Explorer puts a file there, not a picture).
 *
 * @template F
 * @param {{ getData(type: string): string, items?: ArrayLike<{ type: string }> | null, files?: ArrayLike<F> | null } | null | undefined} clipboardData
 * @returns {{ kind: 'native' } | { kind: 'image', files: F[] }}
 */
export function overlayPasteAction(clipboardData) {
  if (!clipboardData || clipboardData.getData('text/plain')) return { kind: 'native' };
  const hasImage = Array.from(clipboardData.items ?? []).some((item) => item.type.startsWith('image/'));
  return hasImage ? { kind: 'image', files: imageFilesFromDrop(clipboardData.files) } : { kind: 'native' };
}
