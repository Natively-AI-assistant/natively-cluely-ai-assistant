/**
 * A Natively key moves everything onto Natively API by itself: the AI, speech-
 * to-text, the reranker and embeddings (Evin, 2026-11-19). Web search follows
 * the key on its own (resolveCompanySearchProvider.ts).
 *
 * WHY. Packs first: a pack gives Pro only while both the AI and speech-to-text
 * run on Natively API (packProRule.ts), and buying one switched nothing. In the
 * week after 3.2.0, 13 of 15 pack buyers who used their own AI hit the Profile
 * Intelligence or Modes paywall while their pack was valid. Then every plan:
 * when a Natively key is entered, for packs and monthly or yearly plans alike,
 * speech-to-text, retrieval, embeddings, the AI and search all run on Natively
 * API (Evin), for everyone on update, not only new keys.
 *
 * WHAT.
 *   - A Natively key (a plan's or a pack's; never the trial) moves the AI model,
 *     speech-to-text, the reranker and pinned embeddings to Natively API, once
 *     per key. A user who moves something back afterwards is left alone, until
 *     they enter a key again (`entered`), which switches again.
 *   - A plan key is asked about first (/v1/usage): a key that is refused, a pack
 *     that is over, and any allowance already run out stay where they are. In
 *     the background it waits for a running meeting to end.
 *   - Fast Response Mode is turned off when it would answer on the user's own
 *     provider. Not pointed at Natively API: 'natively' is not a Background
 *     Model the picker offers, and on Natively API the mode measured no faster
 *     than the main model (1364 vs 1415 ms first token, 2026-08-25).
 *   - The reranker and embeddings send document text off this machine: they
 *     move only when the privacy settings let reference-file content leave it.
 *   - What was there before is remembered. A cleared or refused key puts it back
 *     (CredentialsManager.putBackPackSwitch); so does a pack running out, unless
 *     a plan carries on. A put-back pack key is marked ended: it is not
 *     switched again until a new pack lands on it.
 *   - Every setup moves, local and self-hosted ones too (Ollama, custom or curl
 *     providers, LiteLLM, 9Router, local Whisper, Apple Speech).
 *
 * PURE ON PURPOSE. No Electron, no filesystem, no process.platform: the same
 * on macOS and Windows by construction. Type-erasable TypeScript only, and no
 * imports, so the test loads this file with no build step.
 */

/** The stored embedding choice (SettingsManager 'embedding'). */
export interface EmbeddingChoice {
  mode?: string;
  provider?: string;
  model?: string;
  dimensions?: number;
}

/** The settings as they were before the switch: only the ones it changed. */
export interface PackSwitchPrev {
  defaultModel?: string;
  sttProvider?: string;
  /** true: Fast Response Mode was on and the switch turned it off. */
  fastMode?: boolean;
  rerankerProvider?: string;
  embedding?: EmbeddingChoice;
}

/** Stored with the credentials. keyId is a fingerprint of the key, never the key. */
export interface PackSwitchMemory {
  keyId: string;
  prev: PackSwitchPrev;
  /** Switched because of a pack licence: put back when the pack is over. */
  pack?: boolean;
  /** A pack that ran out and was put back: not switched again until a new pack lands on the key. */
  ended?: boolean;
}

/** Allowances a key has used up (nativelyPackFallback.ts usedUp). */
export type UsedUp = ReadonlySet<'ai' | 'voice' | 'knowledge' | 'research'>;

export interface PackSwitchFacts {
  /** The stored licence, raw (the pack rule not applied). */
  licencePremium: boolean;
  licenceProvider?: string | null;
  /** The licence is a pack's (packProRule.ts isPackLicence). */
  licenceIsPack: boolean;
  /**
   * Fingerprint of the key to switch for: the held pack key, else the saved
   * key; null for none or the trial. Not the key IN USE: that flips between a
   * held pack key and the plan key while the licence stays the pack's.
   */
  keyId: string | null;
  /** Fingerprint of the saved key alone. */
  mainKeyId: string | null;
  memory: PackSwitchMemory | null;
  /** The saved default model and the model answering now (the overlay picker changes only the second). */
  savedModel: string | null;
  liveModel: string | null;
  sttProvider: string | null;
  rerankerProvider: string | null;
  embedding: EmbeddingChoice | null;
  /** The privacy settings keep reference-file content on this device. */
  documentsStayLocal: boolean;
  /** The running AI helper exists (false early in launch): nothing moves without it. */
  aiReady: boolean;
  /** The user has just entered this key: switch again, even if done for it before. */
  entered?: boolean;
}

export type PackSwitchPlan =
  | { kind: 'none' }
  /**
   * Move to Natively API what is not there yet, and remember what it was.
   * `liveCheck`: ask the server about the key first (every key but a pack
   * licence's, which the server already vouched for).
   */
  | { kind: 'switch'; keyId: string; pack: boolean; liveCheck: boolean; ai: boolean; stt: boolean; reranker: boolean; embedding: boolean; prev: PackSwitchPrev }
  /** The pack is over: put back what is still on Natively API. */
  | { kind: 'restore'; keyId: string; prev: PackSwitchPrev }
  /** The pack is over but a plan carries on: keep Natively API, drop the pack's memory. */
  | { kind: 'forget' };

const NATIVELY = 'natively';

/** An embedding choice that pins something other than Natively API (auto already prefers it). */
export function embeddingPinnedElsewhere(e: EmbeddingChoice | null | undefined): boolean {
  return !!e && e.mode === 'manual' && !!e.provider && e.provider !== NATIVELY;
}

export function planPackSwitch(f: PackSwitchFacts): PackSwitchPlan {
  const pack = f.licencePremium && f.licenceIsPack;
  const m = f.memory;

  // A pack's switch, and the pack is over.
  if (m?.pack && !m.ended && !pack) {
    // A plan carries on: its saved key, or a plan licence. It includes the AI.
    if (f.mainKeyId && f.mainKeyId !== m.keyId) return { kind: 'forget' };
    if (f.licencePremium && f.licenceProvider === 'natively_api') return { kind: 'forget' };
    return { kind: 'restore', keyId: m.keyId, prev: m.prev };
  }

  if (!f.keyId || !f.aiReady) return { kind: 'none' };
  // Done for this key already: whatever the user chose since stands. A new
  // pack on a key whose pack ran out, or the key entered again, switches again.
  if (m?.keyId === f.keyId && !f.entered && !(m.ended && pack)) return { kind: 'none' };

  const ai = f.savedModel !== NATIVELY || f.liveModel !== NATIVELY;
  const stt = f.sttProvider !== NATIVELY;
  const reranker = !f.documentsStayLocal && f.rerankerProvider !== NATIVELY;
  const embedding = !f.documentsStayLocal && embeddingPinnedElsewhere(f.embedding);

  // Settings still on Natively API from an earlier switch keep the values from
  // before it.
  const carry: PackSwitchPrev = m && !m.ended ? m.prev : {};
  const prev: PackSwitchPrev = {};
  if (f.savedModel && f.savedModel !== NATIVELY) prev.defaultModel = f.savedModel;
  else if (carry.defaultModel !== undefined) prev.defaultModel = carry.defaultModel;
  if (stt && f.sttProvider) prev.sttProvider = f.sttProvider;
  else if (carry.sttProvider !== undefined) prev.sttProvider = carry.sttProvider;
  if (carry.fastMode) prev.fastMode = true;
  if (reranker) prev.rerankerProvider = f.rerankerProvider ?? 'local';
  else if (carry.rerankerProvider !== undefined) prev.rerankerProvider = carry.rerankerProvider;
  if (embedding && f.embedding) prev.embedding = { ...f.embedding };
  else if (carry.embedding !== undefined) prev.embedding = carry.embedding;

  return { kind: 'switch', keyId: f.keyId, pack, liveCheck: !pack, ai, stt, reranker, embedding, prev };
}

/** The values to put back: only settings still on Natively API, so a choice made since stands. */
export function packRestoreChange(
  prev: PackSwitchPrev,
  now: { defaultModel: string | null; sttProvider: string | null; fastMode: boolean; rerankerProvider?: string | null; embedding?: EmbeddingChoice | null },
): PackSwitchPrev {
  const change: PackSwitchPrev = {};
  if (prev.defaultModel && now.defaultModel === NATIVELY) change.defaultModel = prev.defaultModel;
  if (prev.sttProvider && now.sttProvider === NATIVELY) change.sttProvider = prev.sttProvider;
  if (prev.fastMode && !now.fastMode) change.fastMode = true;
  if (prev.rerankerProvider && now.rerankerProvider === NATIVELY) change.rerankerProvider = prev.rerankerProvider;
  // The switch left embeddings on auto; a pin made since stands.
  if (prev.embedding && !embeddingPinnedElsewhere(now.embedding) && (now.embedding?.mode ?? 'auto') === 'auto') change.embedding = prev.embedding;
  return change;
}

export interface PackSwitchDeps {
  facts(): PackSwitchFacts;
  savedModel(): string | null;
  sttProvider(): string | null;
  rerankerProvider(): string | null;
  embedding(): EmbeddingChoice | null;
  /** Writes the AI model / speech-to-text and the memory together, in one save. False: nothing was saved. */
  write(change: { defaultModel?: string; sttProvider?: string }, memory: PackSwitchMemory | null): boolean;
  /** Fast Response Mode, the saved setting. */
  fastModeOn(): boolean;
  /** Turn Fast Response Mode on or off, saved and live. False: not saved. */
  setFastMode(on: boolean): boolean;
  /** Saves the reranker provider. False: not saved. */
  setReranker(provider: string): boolean;
  /** Saves the embedding choice and re-indexes what needs it. False: not saved. */
  setEmbedding(choice: EmbeddingChoice): Promise<boolean>;
  /** The pack clock bills the time up to now by the providers it ran on (PackMeetingClock countsChanged). */
  beforeChange(): void;
  /** The running AI follows the saved model, and the windows hear it. */
  applyModel(): void;
  /** The provider Fast Response would answer a text turn with now, or null. */
  fastFamilyNow(): string | null;
  /** The audio pipeline follows the saved speech-to-text provider. */
  applyStt(): Promise<void>;
  /**
   * The server on the key to switch for: live with what it has used up, not
   * live (refused, or a pack that is over), or null (no answer now; asked
   * again later).
   */
  keyState(keyId: string): Promise<{ live: true; usedUp: UsedUp } | { live: false } | null>;
  /** A meeting is running: a background switch of a plan key waits for it to end. */
  meetingActive(): boolean;
  /**
   * Called on every run with whether the pack looks over. True only once it
   * has looked over on two runs some time apart.
   */
  goneConfirmed(gone: boolean): boolean;
  log(message: string): void;
  /** Tells the funnel what this run decided. Optional; must never throw into the switch. */
  report?(r: PackSwitchReport): void;
}

export type PackSwitchResult = 'switched' | 'restored' | 'forgot' | null;

/**
 * What a run decided, for the funnel's natively_switch event (2026-11-20).
 * Flags only: never a setting's value, a key or a provider's name. keyId is
 * for the caller to avoid repeating itself and is never sent.
 */
export interface PackSwitchReport {
  keyId: string;
  outcome: 'switched' | 'restored' | 'forgot' | 'held';
  key: 'pack' | 'plan';
  trigger: 'entered' | 'background';
  /** Only with outcome 'held': a meeting is running, the server refused the key (or its pack is over), or it did not answer. */
  heldWhy?: 'meeting' | 'refused' | 'no_answer';
  /** Which settings moved to Natively API (switched) or were put back (restored). */
  moved?: { ai: boolean; stt: boolean; reranker: boolean; embedding: boolean; fast: boolean };
  /** Categories left alone because the plan's allowance for them was already used up. */
  leftUsedUp?: number;
}

/** The funnel event's properties for a report (enums, booleans and one count; see natively_switch in the funnel catalogue). */
export function switchFunnelProps(r: PackSwitchReport): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = { outcome: r.outcome, key: r.key, trigger: r.trigger };
  if (r.heldWhy) props.held_why = r.heldWhy;
  if (r.moved) Object.assign(props, { ai: r.moved.ai, stt: r.moved.stt, reranker: r.moved.reranker, embedding: r.moved.embedding, fast: r.moved.fast });
  if (r.leftUsedUp !== undefined) props.left_used_up = r.leftUsedUp;
  return props;
}

/**
 * Whether a report should be sent, given the last tag sent for the same key
 * (`outcome:heldWhy`). A hold repeats on every 30 s watch, so the same hold is
 * sent once. A key the server refused is not asked again for 6 h and keyState
 * answers null meanwhile, which reads as "no answer": that is not a new fact,
 * so it is not sent as one.
 */
export function shouldSendSwitchReport(last: string | undefined, r: PackSwitchReport): boolean {
  if (r.outcome !== 'held') return true;
  const tag = switchReportTag(r);
  if (last === tag) return false;
  if (r.heldWhy === 'no_answer' && last === 'held:refused') return false;
  return true;
}

/** The tag a sent report is remembered by. */
export function switchReportTag(r: PackSwitchReport): string {
  return `${r.outcome}:${r.heldWhy ?? ''}`;
}

function say(d: PackSwitchDeps, r: PackSwitchReport): void {
  try { d.report?.(r); } catch { /* telemetry never reaches the switch */ }
}

/**
 * Plan and apply. Never throws; null when nothing changed (or a save was
 * refused, which is tried again on the next call).
 */
export async function reconcilePackSwitch(d: PackSwitchDeps): Promise<PackSwitchResult> {
  try {
    const first = d.facts();
    const trigger: PackSwitchReport['trigger'] = first.entered ? 'entered' : 'background';
    let plan = planPackSwitch(first);
    const confirmed = d.goneConfirmed(plan.kind === 'restore');
    if (plan.kind === 'none') return null;

    if (plan.kind === 'forget') {
      if (!d.write({}, null)) return null;
      d.log('a Natively API plan carries on after the pack: everything stays on Natively API');
      say(d, { keyId: first.keyId ?? '', outcome: 'forgot', key: 'pack', trigger });
      return 'forgot';
    }

    if (plan.kind === 'restore') {
      if (!confirmed) return null;
      const change = packRestoreChange(plan.prev, {
        defaultModel: d.savedModel(), sttProvider: d.sttProvider(), fastMode: d.fastModeOn(),
        rerankerProvider: d.rerankerProvider(), embedding: d.embedding(),
      });
      // Marked ended either way: the key is not switched again until a new
      // pack lands on it.
      const ended: PackSwitchMemory = { keyId: plan.keyId, prev: {}, pack: true, ended: true };
      if (Object.keys(change).length === 0) {
        if (!d.write({}, ended)) return null;
        d.log('the pack ended: nothing left on Natively API to put back');
        say(d, { keyId: plan.keyId, outcome: 'forgot', key: 'pack', trigger });
        return 'forgot';
      }
      d.beforeChange();
      if (!d.write({ defaultModel: change.defaultModel, sttProvider: change.sttProvider }, ended)) return null;
      if (change.defaultModel !== undefined) d.applyModel();
      if (change.fastMode && !d.setFastMode(true)) delete change.fastMode;
      if (change.rerankerProvider !== undefined && !d.setReranker(change.rerankerProvider)) delete change.rerankerProvider;
      if (change.embedding !== undefined && !(await d.setEmbedding(change.embedding))) delete change.embedding;
      if (change.sttProvider !== undefined) await d.applyStt();
      d.log(`the pack ended: put back ${describe(change)}`);
      say(d, {
        keyId: plan.keyId, outcome: 'restored', key: 'pack', trigger,
        moved: { ai: change.defaultModel !== undefined, stt: change.sttProvider !== undefined, reranker: change.rerankerProvider !== undefined, embedding: change.embedding !== undefined, fast: change.fastMode === true },
      });
      return 'restored';
    }

    let ai = plan.ai;
    let stt = plan.stt;
    let reranker = plan.reranker;
    let embedding = plan.embedding;
    let leftUsedUp = 0;
    if (plan.liveCheck) {
      // A plan key in the background waits for the meeting to end: a switch
      // rebuilds speech-to-text and can re-index. Entered by the user: now.
      if (!first.entered && d.meetingActive()) {
        say(d, { keyId: plan.keyId, outcome: 'held', key: 'plan', trigger, heldWhy: 'meeting' });
        return null;
      }
      const keyId = plan.keyId;
      const state = await d.keyState(keyId);
      if (!state || !state.live) {
        say(d, { keyId, outcome: 'held', key: 'plan', trigger, heldWhy: state ? 'refused' : 'no_answer' });
        return null;
      }
      // The settings may have moved while the server was asked.
      const again = planPackSwitch({ ...d.facts(), entered: first.entered });
      if (again.kind !== 'switch' || again.keyId !== keyId) return null;
      plan = again;
      // An allowance already run out stays where it is.
      ai = again.ai && !state.usedUp.has('ai');
      stt = again.stt && !state.usedUp.has('voice');
      reranker = again.reranker && !state.usedUp.has('knowledge');
      embedding = again.embedding && !state.usedUp.has('knowledge');
      leftUsedUp = [again.ai && !ai, again.stt && !stt, again.reranker && !reranker, again.embedding && !embedding].filter(Boolean).length;
    }

    // Remember only what moves now or still sits on Natively API from before,
    // so a put-back touches nothing else.
    const prev: PackSwitchPrev = { ...plan.prev };
    if (!ai && d.savedModel() !== NATIVELY) delete prev.defaultModel;
    if (!stt && d.sttProvider() !== NATIVELY) delete prev.sttProvider;
    if (!reranker && d.rerankerProvider() !== NATIVELY) delete prev.rerankerProvider;
    if (!embedding && embeddingPinnedElsewhere(d.embedding())) delete prev.embedding;

    const change: PackSwitchPrev = {};
    if (ai) change.defaultModel = NATIVELY;
    if (stt) change.sttProvider = NATIVELY;
    d.beforeChange();
    const memory: PackSwitchMemory = { keyId: plan.keyId, prev, ...(plan.pack ? { pack: true } : {}) };
    if (!d.write({ defaultModel: change.defaultModel, sttProvider: change.sttProvider }, memory)) return null;
    if (ai) d.applyModel();
    // Fast Response is read from the running AI, so only after it moved: on
    // Auto it can pick the user's own Groq or Gemini. Remembered first, so a
    // mode turned off is always turned back on later.
    const family = d.fastFamilyNow();
    if (family && family !== NATIVELY && d.fastModeOn()) {
      const fast: PackSwitchMemory = { ...memory, prev: { ...memory.prev, fastMode: true } };
      if (d.write({}, fast) && d.setFastMode(false)) change.fastMode = false;
    }
    if (reranker && d.setReranker(NATIVELY)) change.rerankerProvider = NATIVELY;
    // Auto puts Natively API first whenever a key exists; a pin would drop the
    // fallback chain (CredentialsManager.setNativelyApiKey).
    if (embedding && (await d.setEmbedding({ mode: 'auto' }))) change.embedding = { mode: 'auto' };
    if (stt) await d.applyStt();
    d.log(`a Natively key is in use${plan.pack ? ' (pack)' : ''}: moved ${describe(change) || 'nothing (already on Natively API)'} to Natively API`);
    say(d, {
      keyId: plan.keyId, outcome: 'switched', key: plan.pack ? 'pack' : 'plan', trigger, leftUsedUp,
      moved: { ai, stt, reranker: change.rerankerProvider !== undefined, embedding: change.embedding !== undefined, fast: change.fastMode === false },
    });
    return 'switched';
  } catch (e: any) {
    d.log(`Natively switch failed: ${e?.message ?? e}`);
    return null;
  }
}

function describe(c: PackSwitchPrev): string {
  const parts: string[] = [];
  if (c.defaultModel !== undefined) parts.push(`AI model (${c.defaultModel})`);
  if (c.sttProvider !== undefined) parts.push(`speech-to-text (${c.sttProvider})`);
  if (c.fastMode !== undefined) parts.push(`Fast Response Mode (${c.fastMode ? 'on' : 'off'})`);
  if (c.rerankerProvider !== undefined) parts.push(`reranker (${c.rerankerProvider})`);
  if (c.embedding !== undefined) parts.push(`embeddings (${c.embedding.mode === 'auto' ? 'auto' : c.embedding.provider})`);
  return parts.join(', ');
}
