/**
 * A Pro pack unlocks Natively Pro only while the meeting runs on Natively API
 * for BOTH the AI and speech-to-text.
 *
 * WHY (2026-11-16, Evin). A pack is sold as meeting hours of Natively API with
 * Pro on top. A pack holder who moves the AI or the speech-to-text to their own
 * provider could stretch the pack's days into a cheap Pro licence. So:
 *   - both on Natively API      → Pro on, the pack's meeting hours count down
 *   - either on another provider → Pro off; the pack keeps working for the
 *     part still on Natively API, and only that part's allowance is used
 *     (AI tokens for the AI, voice minutes for speech-to-text). The meeting
 *     hours do not count down, since no Pro is being given.
 * Switching back turns Pro on again. The licence stays stored throughout; the
 * rule is applied when Pro is read.
 *
 * Only a licence that came from a pack is affected. A Pro, Max or Ultra plan,
 * a lifetime licence and the trial are not.
 *
 * PURE ON PURPOSE. No Electron, no filesystem, no process.platform: the same
 * on macOS and Windows by construction. Type-erasable TypeScript only, so the
 * test imports this file with no build step.
 */

/** Mirrors natively-api lib/plans.js PACK_PLANS. */
export const PACK_LICENCE_PLANS: ReadonlySet<string> = new Set(['pack_light', 'pack_heavy']);

/** Which provider(s) moved off Natively API. null: nothing blocks Pro. */
export type PackProBlock = null | 'ai' | 'stt' | 'both';

export interface PackProFacts {
  /** The stored licence: its provider ('natively_api' for an API key) and plan. */
  licenceProvider?: string | null;
  licencePlan?: string | null;
  /** The AI model answering (live id; 'natively' is Natively API). */
  defaultModel?: string | null;
  /**
   * The provider family Fast Response answers text turns with right now, or
   * null when it is off or the main model answers. Fast Response can run on the
   * user's own provider while the main model is Natively API, so it counts.
   */
  fastFamily?: string | null;
  /** CredentialsManager.getSttProvider(): 'natively' is Natively API. */
  sttProvider?: string | null;
}

export function isPackLicence(provider: string | null | undefined, plan: string | null | undefined): boolean {
  return provider === 'natively_api' && typeof plan === 'string' && PACK_LICENCE_PLANS.has(plan);
}

/**
 * Is a pack licence's Pro switched off by the providers? Not a pack licence →
 * null. An unknown provider value reads as not Natively API.
 */
export function packProBlock(f: PackProFacts): PackProBlock {
  if (!isPackLicence(f.licenceProvider, f.licencePlan)) return null;
  const aiOff = !aiOnNatively(f.defaultModel, f.fastFamily);
  const sttOff = f.sttProvider !== 'natively';
  if (aiOff && sttOff) return 'both';
  if (aiOff) return 'ai';
  if (sttOff) return 'stt';
  return null;
}

/**
 * Should the pack meeting clock count this minute? Only while both the AI and
 * speech-to-text are on Natively API. The clock runs only for a pack key (the
 * server answers { metered: false } to any other), so no licence check here.
 */
export function packHoursCount(
  defaultModel: string | null | undefined,
  sttProvider: string | null | undefined,
  fastFamily: string | null | undefined = null,
): boolean {
  return aiOnNatively(defaultModel, fastFamily) && sttProvider === 'natively';
}

/** The AI is on Natively API: the main model, and Fast Response if it answers. */
function aiOnNatively(model: string | null | undefined, fastFamily: string | null | undefined): boolean {
  return model === 'natively' && (fastFamily == null || fastFamily === 'natively');
}

/**
 * Pro is back: put back what the stand-down switched off (2026-11-16), so a
 * Pro pack owner who moved a provider off Natively API and back finds things
 * as they left them.
 *   - Profile Intelligence: a stand-down clears only the live switch, never the
 *     saved setting; launch restores it from the setting when Pro is there, and
 *     this does the same without a relaunch. Saved false (the user's own
 *     choice) stays off.
 *   - The Pro mode the pack rule cleared: put back once, unless a mode was
 *     picked since or the mode was deleted. The saved id is used up either way.
 * Never throws; returns what it put back.
 */
export interface PackRestoreDeps {
  proActive(): boolean;
  /** The licence Pro came back on is a pack. The saved mode is for a pack only. */
  packLicence(): boolean;
  knowledgeSetting(): unknown;
  knowledgeSwitchedOn(): boolean;
  setKnowledge(on: boolean): void;
  savedModeId(): string | null | undefined;
  clearSavedModeId(): void;
  activeModeId(): string | null | undefined;
  modeExists(id: string): boolean;
  /** The mode picker's own flow (modes:set-active). */
  applyMode(id: string): Promise<{ success?: boolean } | undefined>;
}

export async function restoreAfterPackStandDown(d: PackRestoreDeps): Promise<{ knowledge: boolean; modeId: string | null }> {
  const done = { knowledge: false, modeId: null as string | null };
  try {
    if (!d.proActive()) return done;
    if (d.knowledgeSetting() === true && !d.knowledgeSwitchedOn()) {
      d.setKnowledge(true);
      done.knowledge = d.knowledgeSwitchedOn();
    }
    const id = d.savedModeId();
    if (!id) return done;
    d.clearSavedModeId();
    // Pro back from something else (a plan, a lifetime licence, a trial) long
    // after a pack ended: the old mode is not put back over the user's choice.
    if (!d.packLicence()) return done;
    if (d.activeModeId()) return done;   // a mode was picked since: theirs wins
    if (!d.modeExists(id)) return done;  // deleted since
    const res = await d.applyMode(id);
    if (res?.success) done.modeId = id;
  } catch { /* the user turns them on again */ }
  return done;
}
