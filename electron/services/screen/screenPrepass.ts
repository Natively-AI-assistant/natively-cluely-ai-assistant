// electron/services/screen/screenPrepass.ts
//
// Whether a screenshot turn waits for a separate "describe the screen" call
// before its answer starts (2026-11-06).
//
// WHY THIS EXISTS
// Typed chat and What to answer (⌘/Ctrl+Enter) both ran
// ScreenUnderstandingService.understand() BEFORE the answer, and the answer
// then sent the same image again. Measured on a dev profile: the describe call
// took 3.5 s (Natively API), and when it timed out it used its whole 6 s
// budget and still produced nothing, while the answer itself only starts after
// it. A screenshot answer reached its first word ~7 s after the press, against
// ~1 s for a text question. A user report (1★, 2026-11-05) named it.
//
// When the answering model receives the image itself, that call adds latency
// and nothing the answer needs: the conversation record it also fed is written
// AFTER the answer by transcribeScreenForMemory on both paths (the same split
// Direct Assist has always used). So the call is skipped there, and the turn's
// screen evidence becomes SCREEN_IN_ATTACHED_IMAGE, which points the model at
// the image instead of leaving SCREEN_CONTEXT planned with nothing behind it
// (that empty case made the prompt say "no supporting evidence was retrieved"
// while the image sat in the same request; see screen-retrieval-port.ts).
//
// The describe call is KEPT whenever the image may not reach a cloud model:
// "Keep screenshots on this device" (private_vision), the screenshots privacy
// scope switched off, or no vision provider configured. Those turns go through
// the same local / policy handling as before, unchanged.
//
// NATIVELY_SCREEN_PREPASS=on restores the old order everywhere (diagnostics,
// and the before/after timing comparison).

import type { ScreenUnderstandingMode } from '../../llm/visionPolicy';

/**
 * The turn's screen evidence when the answer reads the screenshot directly.
 * Never stored in the conversation record: later turns get the dedicated
 * transcription (or SCREEN_BEING_READ until it arrives).
 */
export const SCREEN_IN_ATTACHED_IMAGE =
  "The user's screen for this turn is the screenshot attached to this message as an image. "
  + 'Read what is on it directly from that image: it is this turn\'s screen evidence.';

export interface ScreenPrepassInputs {
  mode: ScreenUnderstandingMode;
  /** providerDataScopes.screenshots !== false */
  allowScreenshots: boolean;
  /** CredentialsManager.anyVisionProviderConfigured() */
  visionAvailable: boolean;
  env?: Record<string, string | undefined>;
}

/** True when the answering call gets the image itself, so no describe call runs first. */
export function answerReadsScreenshotItself(input: ScreenPrepassInputs): boolean {
  const env = input.env ?? process.env;
  if (String(env.NATIVELY_SCREEN_PREPASS ?? '').toLowerCase() === 'on') return false;
  return input.mode !== 'private_vision' && input.allowScreenshots && input.visionAvailable;
}
