/**
 * A Pro pack moves the AI and speech-to-text onto Natively API by itself
 * (2026-11-19, Evin).
 *
 * WHY. A pack gives Pro only while both run on Natively API (packProRule.ts),
 * and buying one switched nothing. Buyers who had their own AI kept it, so the
 * Pro they had just paid for was off from the first second: in the week after
 * 3.2.0, 13 of 15 pack buyers who used their own AI hit the Profile
 * Intelligence or Modes paywall while their pack was valid, most within the
 * hour and before one meeting minute. Five paid again.
 *
 * WHAT.
 *   - A pack licence is seen (bought, pasted, or already stored when this
 *     version starts): the AI model and speech-to-text move to Natively API.
 *     Once per pack key: a user who moves something back afterwards is left
 *     alone, and Pro goes off as the rule says.
 *   - Fast Response Mode is turned off when it would answer on the user's own
 *     provider (Auto picks their Groq or Gemini key; the rule counts it). Not
 *     pointed at Natively API: 'natively' is not a Background Model the picker
 *     offers (Settings would say "not supported"), and on Natively API the mode
 *     measured no faster than the main model (IntelligenceEngine, 2026-08-25:
 *     1364 vs 1415 ms first token), so off costs nothing there.
 *   - What was there before is remembered. When the pack is no longer the
 *     licence (it ran out, it was removed, its key was cleared or refused), the
 *     settings still on Natively API go back to it. A monthly or yearly Natively
 *     API plan replacing the pack keeps Natively API: the plan includes the AI.
 *   - Every setup moves, local and self-hosted ones too (Ollama, a custom or
 *     curl provider, LiteLLM, 9Router, local Whisper, Apple Speech): a pack
 *     gives Pro ONLY with both the AI and speech-to-text on Natively API
 *     (Evin, 2026-11-19), so leaving them would leave the buyer paywalled.
 *     setModel('natively') leaves Ollama and the custom provider; the put-back
 *     restores the model id, which selects them again.
 *
 * PURE ON PURPOSE. No Electron, no filesystem, no process.platform: the same
 * on macOS and Windows by construction. The settings come from
 * CredentialsManager, which hides the Keychain / DPAPI difference. Type-erasable
 * TypeScript only, and no imports, so the test loads this file with no build
 * step.
 */
/** The settings as they were before the switch: only the ones it changed. */
export interface PackSwitchPrev {
  defaultModel?: string;
  sttProvider?: string;
  /** true: Fast Response Mode was on and the switch turned it off. */
  fastMode?: boolean;
}

/** Stored with the credentials. keyId is a fingerprint of the key, never the key. */
export interface PackSwitchMemory {
  keyId: string;
  prev: PackSwitchPrev;
}

export interface PackSwitchFacts {
  /** The stored licence, raw (the pack rule not applied). */
  licencePremium: boolean;
  licenceProvider?: string | null;
  /** The licence is a pack's (packProRule.ts isPackLicence). */
  licenceIsPack: boolean;
  /**
   * Fingerprint of the pack's own key (the held pack key, else the saved key),
   * or null when there is none. Not the key IN USE: that flips between a held
   * pack key and the plan key while the licence stays the pack's.
   */
  keyId: string | null;
  memory: PackSwitchMemory | null;
  /** The saved default model and the model answering now (the overlay picker changes only the second). */
  savedModel: string | null;
  liveModel: string | null;
  sttProvider: string | null;
  /** The running AI helper exists (false early in launch): nothing moves without it. */
  aiReady: boolean;
}

export type PackSwitchPlan =
  | { kind: 'none' }
  /** Move to Natively API what is not there yet, and remember what it was. */
  | { kind: 'switch'; keyId: string; ai: boolean; stt: boolean; prev: PackSwitchPrev }
  /** The pack is gone: put back what is still on Natively API. */
  | { kind: 'restore'; prev: PackSwitchPrev }
  /** The pack is gone but a Natively API plan took over: keep it, forget the old settings. */
  | { kind: 'forget' };

const NATIVELY = 'natively';

export function planPackSwitch(f: PackSwitchFacts): PackSwitchPlan {
  const pack = f.licencePremium && f.licenceIsPack;
  if (pack) {
    if (!f.keyId) return { kind: 'none' };
    // Done for this pack already: whatever the user chose since stands.
    if (f.memory?.keyId === f.keyId) return { kind: 'none' };
    if (!f.aiReady) return { kind: 'none' };
    const ai = f.savedModel !== NATIVELY || f.liveModel !== NATIVELY;
    const stt = f.sttProvider !== NATIVELY;
    // A new pack while an older one's switch is still in place: what is still
    // on Natively API from that switch keeps the settings from before it.
    const carry = f.memory?.prev ?? {};
    const prev: PackSwitchPrev = {};
    if (f.savedModel !== NATIVELY) prev.defaultModel = f.savedModel ?? undefined;
    else if (carry.defaultModel !== undefined) prev.defaultModel = carry.defaultModel;
    if (stt) prev.sttProvider = f.sttProvider ?? undefined;
    else if (carry.sttProvider !== undefined) prev.sttProvider = carry.sttProvider;
    if (carry.fastMode) prev.fastMode = true;
    for (const k of Object.keys(prev) as Array<keyof PackSwitchPrev>) if (prev[k] === undefined) delete prev[k];
    return { kind: 'switch', keyId: f.keyId, ai, stt, prev };
  }
  if (!f.memory) return { kind: 'none' };
  if (f.licencePremium && f.licenceProvider === 'natively_api') return { kind: 'forget' };
  return { kind: 'restore', prev: f.memory.prev };
}

/** The values to put back: only settings still on Natively API, so a choice made since stands. */
export function packRestoreChange(
  prev: PackSwitchPrev,
  now: { defaultModel: string | null; sttProvider: string | null; fastMode: boolean },
): PackSwitchPrev {
  const change: PackSwitchPrev = {};
  if (prev.defaultModel && now.defaultModel === NATIVELY) change.defaultModel = prev.defaultModel;
  if (prev.sttProvider && now.sttProvider === NATIVELY) change.sttProvider = prev.sttProvider;
  if (prev.fastMode && !now.fastMode) change.fastMode = true;
  return change;
}

export interface PackSwitchDeps {
  facts(): PackSwitchFacts;
  savedModel(): string | null;
  sttProvider(): string | null;
  /** Writes the AI model / speech-to-text and the memory together, in one save. False: nothing was saved. */
  write(change: { defaultModel?: string; sttProvider?: string }, memory: PackSwitchMemory | null): boolean;
  /** Fast Response Mode, the saved setting. */
  fastModeOn(): boolean;
  /** Turn Fast Response Mode on or off, saved and live. False: not saved. */
  setFastMode(on: boolean): boolean;
  /** The pack clock bills the time up to now by the providers it ran on (PackMeetingClock countsChanged). */
  beforeChange(): void;
  /** The running AI follows the saved model, and the windows hear it. */
  applyModel(): void;
  /** The provider Fast Response would answer a text turn with now, or null. */
  fastFamilyNow(): string | null;
  /** The audio pipeline follows the saved speech-to-text provider. */
  applyStt(): Promise<void>;
  /**
   * Called on every run with whether the pack looks gone. True only once it has
   * looked gone on two runs some time apart: a licence store that cannot be read
   * for a moment (a locked Keychain, DPAPI unavailable) reads as no licence, and
   * one such read must not move a meeting onto other providers.
   */
  goneConfirmed(gone: boolean): boolean;
  log(message: string): void;
}

export type PackSwitchResult = 'switched' | 'restored' | 'forgot' | null;

/**
 * Plan and apply. Never throws; null when nothing changed (or a save was
 * refused, which is tried again on the next call).
 */
export async function reconcilePackSwitch(d: PackSwitchDeps): Promise<PackSwitchResult> {
  try {
    const plan = planPackSwitch(d.facts());
    const confirmed = d.goneConfirmed(plan.kind === 'restore');
    if (plan.kind === 'none') return null;

    if (plan.kind === 'forget') {
      if (!d.write({}, null)) return null;
      d.log('a Natively API plan replaced the pack: the AI stays on Natively API');
      return 'forgot';
    }

    if (plan.kind === 'restore') {
      if (!confirmed) return null;
      const change = packRestoreChange(plan.prev, {
        defaultModel: d.savedModel(), sttProvider: d.sttProvider(), fastMode: d.fastModeOn(),
      });
      // Nothing still on Natively API: the user moved it all. The pack is over
      // (confirmed twice, and the caller does not run while the credential
      // store cannot be read), so the memory goes: a new pack on the same key
      // switches again.
      if (Object.keys(change).length === 0) {
        if (!d.write({}, null)) return null;
        d.log('the pack ended: nothing left on Natively API to put back');
        return 'forgot';
      }
      d.beforeChange();
      if (!d.write({ defaultModel: change.defaultModel, sttProvider: change.sttProvider }, null)) return null;
      if (change.defaultModel !== undefined) d.applyModel();
      if (change.fastMode && !d.setFastMode(true)) delete change.fastMode;
      if (change.sttProvider !== undefined) await d.applyStt();
      d.log(`the pack ended: put back ${describe(change)}`);
      return 'restored';
    }

    const change: PackSwitchPrev = {};
    if (plan.ai) change.defaultModel = NATIVELY;
    if (plan.stt) change.sttProvider = NATIVELY;
    d.beforeChange();
    const memory: PackSwitchMemory = { keyId: plan.keyId, prev: plan.prev };
    if (!d.write(change, memory)) return null;
    if (plan.ai) d.applyModel();
    // Fast Response is read from the running AI, so only after it moved: on
    // Auto it can pick the user's own Groq or Gemini, which the rule counts.
    // Remembered first, so a mode turned off is always turned back on later.
    const family = d.fastFamilyNow();
    if (family && family !== NATIVELY && d.fastModeOn()) {
      const fast: PackSwitchMemory = { ...memory, prev: { ...memory.prev, fastMode: true } };
      if (d.write({}, fast) && d.setFastMode(false)) change.fastMode = false;
    }
    if (plan.stt) await d.applyStt();
    d.log(`a pack is in use: moved ${describe(change) || 'nothing (already on Natively API)'} to Natively API`);
    return 'switched';
  } catch (e: any) {
    d.log(`pack switch failed: ${e?.message ?? e}`);
    return null;
  }
}

function describe(c: PackSwitchPrev): string {
  const parts: string[] = [];
  if (c.defaultModel !== undefined) parts.push(`AI model (${c.defaultModel})`);
  if (c.sttProvider !== undefined) parts.push(`speech-to-text (${c.sttProvider})`);
  if (c.fastMode !== undefined) parts.push(`Fast Response Mode (${c.fastMode ? 'on' : 'off'})`);
  return parts.join(', ');
}
