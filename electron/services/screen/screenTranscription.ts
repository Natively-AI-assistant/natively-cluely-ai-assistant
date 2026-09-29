import { composeScreenDescription } from './screenDescription';
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
export async function transcribeScreenForMemory(
  imagePaths: readonly string[],
  /** The turn's question, passed only as disambiguation context. */
  transcriptHint?: string,
): Promise<string> {
  if (!imagePaths.length) return '';
  try {
    const sha = hashImageSet(imagePaths);
    if (!sha) return '';
    const cached = getScreenshotDescription(sha);
    if (cached?.description) return cached.description;

    const { getScreenUnderstandingService } = require('./ScreenUnderstandingService');
    const { SettingsManager } = require('../SettingsManager');
    const { CredentialsManager } = require('../CredentialsManager');
    const settings = SettingsManager.getInstance();
    const credentials = CredentialsManager.getInstance();
    const providerScopes = settings.get('providerDataScopes') || {};

    const result = await getScreenUnderstandingService().understand({
      modeId: 'screen-memory',
      transcript: transcriptHint,
      // The whole point: this reaches STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
      // which every existing call site missed.
      userAction: 'transcribe',
      qualityMode: 'balanced',
      imagePaths: [...imagePaths],
      // ONE policy, read the same way as the other call sites — a transcription
      // is still a screenshot leaving the device, and `private_vision` and a
      // denied `screenshots` scope bind it exactly as they bind the answer.
      screenUnderstandingMode: settings.getScreenUnderstandingMode(),
      technicalInterviewVisionFirst: settings.getTechnicalInterviewVisionFirst(),
      providerPolicy: {
        localOnly: settings.getScreenUnderstandingMode() === 'private_vision',
        allowScreenshots: providerScopes.screenshots !== false,
        visionAvailable: credentials.anyVisionProviderConfigured?.() ?? true,
        localVisionAvailable: credentials.anyLocalVisionProviderConfigured?.() ?? false,
      },
    });

    const text = composeScreenDescription(result);
    if (text) {
      putScreenshotDescription(sha, text, result?.providerUsed ?? '', result?.modelUsed ?? '');
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
