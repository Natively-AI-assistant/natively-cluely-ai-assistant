// electron/services/skills/SkillUploader.ts
//
// Step 2 of the Skill Upload feature — thin façade combining
// `validateSkillPayload` (from SkillValidator) and `installUploadedSkill`
// (from SkillInstaller). Owns NO state; just dispatches.
//
// The IPC handler in step 3 will call this. Two flows:
//   - Preview-then-confirm: `autoInstall: false` → returns a 'validated'
//     stage with the preview, the renderer shows a card, user clicks
//     "Install", renderer calls again with `autoInstall: true`.
//   - One-shot: `autoInstall: true` → validate + install in a single call.
//     Used when the renderer decides skipping the preview is OK (e.g. for
//     trusted internal flows).
//
// Why a façade instead of calling the two functions directly from the IPC
// handler? So the IPC handler is a one-liner that never has to remember
// which fields to forward on each outcome. The renderer-visible shape
// (UploadSkillOutcome) is uniform regardless of which stage succeeded.

import type { SkillUploadPayload } from './SkillValidator';
import type {
  SkillUploadPreview,
  SkillValidationError,
} from './SkillValidator';
import type { SkillSummary } from '../SkillsManager';
import type { InstallSkillOptions } from './SkillInstaller';
import { installUploadedSkill } from './SkillInstaller';
import { validateSkillPayload } from './SkillValidator';

export interface UploadSkillOutcome {
  /**
   * - 'validated': payload passed validation but was NOT installed
   *   (because `autoInstall: false`). `preview` is populated.
   * - 'installed': payload was validated AND installed. `preview`,
   *   `skill`, and `installedPath` are populated.
   * - 'failed': validation or install failed. `errors` is populated.
   */
  stage: 'validated' | 'installed' | 'failed';
  preview?: SkillUploadPreview;
  skill?: SkillSummary;
  installedPath?: string;
  errors?: SkillValidationError[];
}

export interface UploadSkillOptions extends InstallSkillOptions {
  /**
   * If true (default), validate then install in one shot. If false, validate
   * only and return a preview for the renderer's confirm step.
   */
  autoInstall?: boolean;
}

/**
 * Validate (and optionally install) an uploaded skill payload.
 *
 * Errors are NEVER thrown — they are surfaced as `stage: 'failed'` with a
 * populated `errors` array. This keeps the IPC contract flat and means the
 * preload bridge doesn't need a try/catch.
 */
export async function uploadSkill(
  payload: SkillUploadPayload,
  opts: UploadSkillOptions = {}
): Promise<UploadSkillOutcome> {
  const autoInstall = opts.autoInstall ?? true;

  // ---- Stage 1: validate --------------------------------------------------
  const validation = validateSkillPayload(payload, {
    existingIds: opts.existingIds,
    builtinIds: opts.builtinIds,
  });

  if (validation.ok === false) {
    return {
      stage: 'failed',
      errors: validation.errors,
    };
  }
  const preview = validation.preview;

  if (!autoInstall) {
    // Preview-only flow. The renderer's "Install" button will call this
    // again with autoInstall:true and the same payload.
    return {
      stage: 'validated',
      preview,
    };
  }

  // ---- Stage 2: install ---------------------------------------------------
  const installResult = await installUploadedSkill(payload, opts);

  if (installResult.success === false) {
    return {
      stage: 'failed',
      // Preserve the preview so the renderer can keep showing the preview
      // card alongside the install-time error message — this lets the user
      // see "what they tried to install" and "why it failed" side by side.
      preview,
      errors: installResult.errors,
    };
  }

  return {
    stage: 'installed',
    preview,
    skill: installResult.skill,
    installedPath: installResult.installedPath,
  };
}