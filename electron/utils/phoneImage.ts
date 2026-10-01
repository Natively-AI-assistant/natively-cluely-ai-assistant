import path from 'node:path';

// Photos and screenshots sent from the Phone Mirror page are saved with this
// name prefix (ScreenshotHelper.addExternalImage, via AppState.receivePhoneImage)
// so the vision path can tell them apart from captures of this machine's screen.
export const PHONE_IMAGE_PREFIX = 'phone-';

export function isPhoneImagePath(imagePath: string): boolean {
  return path.basename(imagePath).startsWith(PHONE_IMAGE_PREFIX);
}

/**
 * Long edge, in pixels, an image is sent to a vision model at
 * (LLMHelper.processImage, the path every built-in vision adapter uses).
 *
 * Phone images get 2048: text in a phone PHOTO is small in pixel terms, and a
 * 2026-09-27 comparison on the default models showed 2048 reading lines that
 * 1536 could not (Gemini 3.8 Flash and GPT-5.4; Claude Sonnet 4.6 downsizes both
 * to ~1.15 MP itself). Screen captures keep 1536: their text is already large
 * in pixels, and 2048 would cost GPT ~42% more image tokens for no gain.
 * "Shrink when the provider is slow" still wins, for every image.
 */
export function visionImageEdge(opts: { phoneImage: boolean; shrink: boolean }): number {
  if (opts.shrink) return 1024;
  return opts.phoneImage ? 2048 : 1536;
}
