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
 *     version starts): the AI model, speech-to-text and, when it would answer on
 *     another provider, Fast Response move to Natively API. Once per pack key:
 *     a user who moves something back afterwards is left alone, and Pro goes off
 *     as the rule says.
 *   - What was there before is remembered. When the pack is no longer the
 *     licence (it ran out, it was removed, its key was cleared or refused), the
 *     settings still on Natively API go back to it. A monthly or yearly Natively
 *     API plan replacing the pack keeps Natively API: the plan includes the AI.
 *   - Nothing moves while the AI or speech-to-text runs on this computer or on
 *     the user's own endpoint (Ollama, a custom or self-hosted provider, local
 *     Whisper, Apple Speech). Switching those would send audio and prompts off
 *     a machine the user chose to keep them on. Pro stays off there, as before.
 *
 * PURE ON PURPOSE. No Electron, no filesystem, no process.platform: the same
 * on macOS and Windows by construction. The settings come from
 * CredentialsManager, which hides the Keychain / DPAPI difference. Type-erasable
 * TypeScript only, and no imports, so the test loads this file with no build
 * step.
 */
/** Speech-to-text that runs on this computer. */
export const ON_DEVICE_STT: ReadonlySet<string> = new Set(['local-whisper', 'apple-speech']);

/** The settings as they were before the switch: only the ones it changed. */
export interface PackSwitchPrev {
  defaultModel?: string;
  sttProvider?: string;
  /** null is Fast Response on Auto, a real value; absent means not changed. */
  fastModel?: string | null;
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
  /** Fingerprint of the Natively key in use, or null when there is none. */
  keyId: string | null;
  memory: PackSwitchMemory | null;
  /** The saved default model and the model answering now (the overlay picker changes only the second). */
  savedModel: string | null;
  liveModel: string | null;
  sttProvider: string | null;
  /** The AI runs on this computer or the user's own endpoint. */
  aiStaysWithUser: boolean;
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
    if (f.aiStaysWithUser || ON_DEVICE_STT.has(f.sttProvider ?? '')) return { kind: 'none' };
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
    if ('fastModel' in carry) prev.fastModel = carry.fastModel;
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
  now: { defaultModel: string | null; sttProvider: string | null; fastModel: string | null },
): PackSwitchPrev {
  const change: PackSwitchPrev = {};
  if (prev.defaultModel && now.defaultModel === NATIVELY) change.defaultModel = prev.defaultModel;
  if (prev.sttProvider && now.sttProvider === NATIVELY) change.sttProvider = prev.sttProvider;
  if ('fastModel' in prev && now.fastModel === NATIVELY) change.fastModel = prev.fastModel ?? null;
  return change;
}

export interface PackSwitchDeps {
  facts(): PackSwitchFacts;
  fastModel(): string | null;
  savedModel(): string | null;
  sttProvider(): string | null;
  /** Writes the settings and the memory together, in one save. False: nothing was saved. */
  write(change: PackSwitchPrev, memory: PackSwitchMemory | null): boolean;
  /** The pack clock bills the time up to now by the providers it ran on (PackMeetingClock countsChanged). */
  beforeChange(): void;
  /** The running AI follows the saved model, and the windows hear it. */
  applyModel(): void;
  /** The provider Fast Response would answer a text turn with now, or null. */
  fastFamilyNow(): string | null;
  /** The audio pipeline follows the saved speech-to-text provider. */
  applyStt(): Promise<void>;
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
    if (plan.kind === 'none') return null;

    if (plan.kind === 'forget') {
      if (!d.write({}, null)) return null;
      d.log('a Natively API plan replaced the pack: the AI stays on Natively API');
      return 'forgot';
    }

    if (plan.kind === 'restore') {
      const change = packRestoreChange(plan.prev, {
        defaultModel: d.savedModel(), sttProvider: d.sttProvider(), fastModel: d.fastModel(),
      });
      d.beforeChange();
      if (!d.write(change, null)) return null;
      if (change.defaultModel !== undefined || 'fastModel' in change) d.applyModel();
      if (change.sttProvider !== undefined) await d.applyStt();
      d.log(`the pack ended: put back ${describe(change) || 'nothing (all changed since)'}`);
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
    const family = d.fastFamilyNow();
    if (family && family !== NATIVELY) {
      const fast = { ...memory, prev: { ...memory.prev, fastModel: d.fastModel() } };
      if (d.write({ fastModel: NATIVELY }, fast)) {
        change.fastModel = NATIVELY;
        d.applyModel();
      }
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
  if ('fastModel' in c) parts.push(`Fast Response (${c.fastModel ?? 'Auto'})`);
  return parts.join(', ');
}
