import fs from 'node:fs';

/*
 * Previews of the screenshots an answer used, for the Meeting Notes Usage tab.
 *
 * The screenshots themselves do not outlive the meeting: ScreenshotHelper keeps
 * at most five per queue (older files are unlinked as new ones arrive) and
 * clearQueues() deletes the rest. So the preview is made when the usage entry is
 * logged, while the files are still there, and it travels with the entry into
 * ai_interactions.metadata_json (DatabaseManager.saveMeeting). Deleting the
 * meeting deletes its previews with the row; there are no files to clean up.
 *
 * sharp is the image library ScreenshotHelper already ships on macOS and Windows.
 * It runs on the libuv pool, so this never blocks the main thread.
 */

/** Longest edge of a preview, in pixels: readable when opened, small in the DB. */
export const USAGE_PREVIEW_MAX_EDGE = 1280;
/** At most this many previews per usage entry. */
export const USAGE_PREVIEW_MAX_IMAGES = 4;
export const USAGE_PREVIEW_JPEG_QUALITY = 70;

/**
 * JPEG data URLs for the given screenshot files, in order, de-duplicated and
 * capped. A file that is already gone or cannot be decoded is skipped.
 */
export async function makeUsagePreviews(imagePaths: readonly string[] | null | undefined): Promise<string[]> {
    const paths = [...new Set((imagePaths ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0))]
        .slice(0, USAGE_PREVIEW_MAX_IMAGES);
    if (paths.length === 0) return [];
    const { default: sharp } = await import('sharp');
    const previews: string[] = [];
    for (const imagePath of paths) {
        try {
            // Read the whole file first so its handle closes at once: on Windows an
            // open handle would make ScreenshotHelper's queue cleanup fail to unlink it.
            const input = await fs.promises.readFile(imagePath);
            const jpeg = await sharp(input)
                .rotate()
                .resize({ width: USAGE_PREVIEW_MAX_EDGE, height: USAGE_PREVIEW_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
                // A stitched multi-display capture has transparent gaps; JPEG has no alpha.
                .flatten({ background: '#000000' })
                .jpeg({ quality: USAGE_PREVIEW_JPEG_QUALITY })
                .toBuffer();
            previews.push(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
        } catch {
            // Gone (queue cleanup) or unreadable: this one simply has no preview.
        }
    }
    return previews;
}
