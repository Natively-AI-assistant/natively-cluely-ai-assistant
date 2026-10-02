// electron/llm/diagramPromptSignals.ts
//
// THE single place a prompt surface asks "is this a diagram turn, and what does
// the prompt need for it?". The sibling of codingPromptSignals.ts, for the same
// reason that module exists: every surface (What to Answer, typed chat on V3
// and legacy, the engine's manual answer, LLMHelper's self-composed fallbacks,
// follow-ups, brainstorm, Direct Assist, the phone) used to be free to decide
// this on its own, and independent decisions drift.
//
// Detection of the question's ROUTE stays with AnswerPlanner; the semantic
// diagram decision lives in src/lib/diagram/diagramRequest.mjs (pure, shared
// with the renderer). This module only gathers what that resolver needs from
// the main process — the feature switch, the user's standing instructions, the
// design on the table — and returns:
//
//   signals    BOUNDED enums + example ids, safe for the registered/cached
//              system prompt (promptSystemV2 keys a Map by prompt text);
//   turnBlock  the DYNAMIC part (the current design's Mermaid source), for the
//              turn's user content — never the system prompt.
//
// A diagram turn is never a coding turn: nothing here touches codingTask, the
// code-verification spec, or isCodingAnswerType.

// TYPE-ONLY imports of the shared modules, on purpose. This file is statically
// imported by AnswerLLM / WhatToAnswerLLM / BrainstormLLM, and four test suites
// compile that import graph file by file with tsc (tsconfig.emit.json). In such
// a tree a `.mjs` module that has a `.d.mts` sibling is resolved as types and
// never emitted, so a static import here would make every one of those suites
// fail to load. The modules are required at the point of use instead (shared());
// esbuild bundles those requires like any other, so the shipped app is unaffected.
import type { DiagramRequest } from '../../src/lib/diagram/diagramRequest.mjs';
import type { DiagramPromptSignals } from '../../src/lib/diagram/diagramContract.mjs';
import type { ActiveDesign } from '../../src/lib/diagram/activeDesign.mjs';
import { getRegisteredUserInstructions } from './userInstructionContract';
import { SYSTEM_DESIGN_ACTION_INSTRUCTION, isVisualActionInstruction } from './systemDesignAction';

function shared() {
  return {
    ...(require('../../src/lib/diagram/diagramRequest.mjs') as typeof import('../../src/lib/diagram/diagramRequest.mjs')),
    ...(require('../../src/lib/diagram/diagramContract.mjs') as typeof import('../../src/lib/diagram/diagramContract.mjs')),
  };
}

// Every entry point here is "never throws": a diagram decision must not break
// an answer. But a decision that ALWAYS fails looks exactly like "no turn ever
// wants a diagram" — the feature off for everyone, with nothing to say why. So
// the first failure of each kind is logged, once.
const warned = new Set<string>();
function warnOnce(where: string, err: unknown): void {
  if (warned.has(where)) return;
  warned.add(where);
  try {
    console.warn(`[diagrams] ${where} failed; this turn is answered without a visual:`, err instanceof Error ? err.message : String(err));
  } catch { /* logging is best effort */ }
}

export type { DiagramPromptSignals, DiagramRequest };

export interface DiagramTurn {
  request: DiagramRequest;
  /** Null when no diagram contract applies to the turn. */
  signals: DiagramPromptSignals | null;
  /** '' when the turn does not need the current design as context. */
  turnBlock: string;
}

const NO_DIAGRAM_TURN: DiagramTurn = Object.freeze({
  request: Object.freeze({
    enabled: false,
    view: 'architecture',
    operation: 'none',
    output: 'text-only',
    basis: 'proposed-design',
    withCode: false,
    explicit: false,
    attachActiveDesign: false,
    reason: 'unresolved',
  }) as DiagramRequest,
  signals: null,
  turnBlock: '',
});

/**
 * Master switch (env NATIVELY_SYSTEM_DESIGN_DIAGRAMS > setting > default ON).
 * Lazy-required so this module stays importable from tests without
 * SettingsManager. Never throws; an unreadable registry means ON, the default.
 */
export function isSystemDesignDiagramsEnabled(): boolean {
  try {
    const { isIntelligenceFlagEnabled } = require('../intelligence/intelligenceFlags');
    return isIntelligenceFlagEnabled('systemDesignDiagrams') === true;
  } catch {
    return true;
  }
}

// ── the design on the table, for callers that hold no session ───────────────
//
// AnswerPlanner is pure and is called from a dozen places, several of them
// inline; threading the session through each is how one of them gets missed.
// The engine registers a reader instead (the same pattern, and the same
// globalThis slot discipline, as userInstructionContract's provider): esbuild
// inlines this module into every entry bundle, so module-level state would not
// be shared between them.
const ACTIVE_DESIGN_PROVIDER_SLOT = '__nativelyActiveDesignProvider';
type ActiveDesignProvider = () => ActiveDesign | null | undefined;

/** Register (or, with null, clear) the reader for the session's active design. */
export function registerActiveDesignProvider(provider: ActiveDesignProvider | null): void {
  (globalThis as any)[ACTIVE_DESIGN_PROVIDER_SLOT] = provider ?? undefined;
}

// The session is told when a turn follows up on the artifact, so it stays in
// focus through the answer (see activeDesign.touch). Same slot discipline.
const ACTIVE_DESIGN_TOUCH_SLOT = '__nativelyActiveDesignTouch';

/** Register (or, with null, clear) the function that marks the current turn as a follow-up on the active design. */
export function registerActiveDesignToucher(touch: ((followsUp: boolean) => void) | null): void {
  (globalThis as any)[ACTIVE_DESIGN_TOUCH_SLOT] = touch ?? undefined;
}

function touchRegisteredActiveDesign(followsUp: boolean): void {
  const touch = (globalThis as any)[ACTIVE_DESIGN_TOUCH_SLOT] as ((followsUp: boolean) => void) | undefined;
  if (typeof touch !== 'function') return;
  try {
    touch(followsUp);
  } catch { /* focus is a hint */ }
}

/** The design on the table, or null. Never throws; no provider (unit tests) ⇒ null. */
export function getRegisteredActiveDesign(): ActiveDesign | null {
  const provider = (globalThis as any)[ACTIVE_DESIGN_PROVIDER_SLOT] as ActiveDesignProvider | undefined;
  if (typeof provider !== 'function') return null;
  try {
    return provider() ?? null;
  } catch {
    return null;
  }
}

/**
 * Is this turn a follow-up on the design on the table — an update, another
 * view, or a question about it — with no code asked for? AnswerPlanner uses
 * this to route such a turn as a system-design answer: its own keyword
 * patterns read "add a dead-letter queue" and "why do we need the queue?" as
 * coding questions, and every downstream stage (stream gate, validators,
 * verification) would then treat a design answer as code.
 */
export function isDesignFollowUpTurn(question: string | null | undefined, answerType: string | null | undefined): boolean {
  try {
    if (!isSystemDesignDiagramsEnabled()) return false;
    const activeDesign = getRegisteredActiveDesign();
    if (!activeDesign || !activeDesign.source || !activeDesignShareable()) return false;
    const request = shared().resolveDiagramRequest({ question, answerType, activeDesign, featureEnabled: true });
    // Only a system design: a follow-up on a chart or a schema is not one (see visualTurnRoute).
    if (((activeDesign as { artifact?: string }).artifact ?? 'mermaid') !== 'mermaid') return false;
    if (!['architecture', 'sequence', 'flowchart', 'state'].includes(request.view)) return false;
    if (!request.enabled || !request.parentArtifactId || request.withCode) return false;
    if (request.operation !== 'update' && request.operation !== 'create' && request.operation !== 'explain') return false;
    // A question that only says "this" or "it" might be about the design, and
    // might not ("is this a remote role?"): the contract tells the model how
    // to tell, but the turn is not pulled onto the system-design route for it.
    const weak = (request as { followUp?: string }).followUp === 'weak';
    return !(weak && request.operation === 'explain');
  } catch (err) {
    warnOnce('isDesignFollowUpTurn', err);
    return false;
  }
}

// ── the mode the turn runs in ───────────────────────────────────────────────
//
// A mode makes some visuals relevant without being asked for ("where are deals
// dropping out?" in Sales). The identity that decides this is the mode's
// TEMPLATE — the key of the mode policy registry — never its display name: a
// user mode called "Sales" built on the General template is a custom mode, not
// the Sales mode. ModesManager (the owner) registers the reader once, the same
// way it registers the user-instruction provider.
const VISUAL_MODE_PROVIDER_SLOT = '__nativelyVisualModeProvider';
type VisualModeProvider = (pinnedModeId?: string) => string | null | undefined;

// What was said in the conversation so far, for one deterministic question: was
// a calculation's input (a starting value, a rate) stated ANYWHERE? The session
// owner registers the reader; with none (unit tests, a transport with no
// session) the conversation is unknown and nothing changes.
const CONVERSATION_TEXT_PROVIDER_SLOT = '__nativelyDiagramConversationTextProvider';
type ConversationTextProvider = () => string | null | undefined;

/** Register (or, with null, clear) the reader for the conversation so far. */
export function registerConversationTextProvider(provider: ConversationTextProvider | null): void {
  (globalThis as any)[CONVERSATION_TEXT_PROVIDER_SLOT] = provider ?? undefined;
}

/** The conversation so far, or undefined when nobody can say. Never throws. */
export function getRegisteredConversationText(): string | undefined {
  const provider = (globalThis as any)[CONVERSATION_TEXT_PROVIDER_SLOT] as ConversationTextProvider | undefined;
  if (typeof provider !== 'function') return undefined;
  try {
    const text = provider();
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Register (or, with null, clear) the reader for the active mode's visual identity. */
export function registerVisualModeProvider(provider: VisualModeProvider | null): void {
  (globalThis as any)[VISUAL_MODE_PROVIDER_SLOT] = provider ?? undefined;
}

/**
 * A built-in template id ('sales', 'call-center', …), 'custom', or 'unknown'.
 * Never throws; no provider (unit tests, a transport with no modes) ⇒ 'unknown',
 * which keeps the pre-catalog behaviour: only an explicit request draws.
 */
export function getRegisteredVisualMode(pinnedModeId?: string): string {
  const provider = (globalThis as any)[VISUAL_MODE_PROVIDER_SLOT] as VisualModeProvider | undefined;
  if (typeof provider !== 'function') return 'unknown';
  try {
    const mode = provider(pinnedModeId);
    return typeof mode === 'string' && mode ? mode : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The visual identity of a mode row: its validated template, or 'custom' for a
 * user mode on the General template. Pure; exported for ModesManager and tests.
 */
export function visualModeOf(mode: { templateType?: string | null; name?: string | null } | null | undefined): string {
  if (!mode || typeof mode.templateType !== 'string') return 'unknown';
  try {
    const { isModeId } = require('../context-intelligence/policies/mode-policy-registry') as typeof import('../context-intelligence/policies/mode-policy-registry');
    if (!isModeId(mode.templateType)) return 'unknown';
  } catch {
    return 'unknown';
  }
  // The same test ModesManager.isCustomMode applies.
  if (mode.templateType === 'general' && mode.name !== 'General') return 'custom';
  return mode.templateType;
}

/**
 * Where AnswerPlanner should route a turn the visual resolver has claimed, or
 * null to leave the keyword verdict alone.
 *
 *   'system_design_answer'    a follow-up on a system design on the table (the
 *                             original behaviour: see isDesignFollowUpTurn);
 *   'general_meeting_answer'  any other visual turn that the keyword patterns
 *                             read as CODING ("model users, orders and
 *                             payments", "add a status column"). Left on a
 *                             coding route it would be streamed, validated and
 *                             verified as code. It is not sent to the
 *                             system-design route: an ER diagram or a forecast
 *                             is not a system design, in any mode.
 */
export function visualTurnRoute(question: string | null | undefined, answerType: string | null | undefined): 'system_design_answer' | 'general_meeting_answer' | null {
  try {
    if (!isSystemDesignDiagramsEnabled()) return null;
    const shareable = activeDesignShareable();
    const registered = getRegisteredActiveDesign();
    const activeDesign = registered && registered.source && shareable ? registered : null;
    const { resolveDiagramRequest } = shared();
    // The user's standing instructions count here too: a turn must not be
    // moved off its route for a visual that "no diagrams" then switches off.
    let instructions: string | null = null;
    try {
      instructions = getRegisteredUserInstructions();
    } catch {
      instructions = null;
    }
    const request = resolveDiagramRequest({ question, answerType, activeDesign, featureEnabled: true, mode: getRegisteredVisualMode(), userInstructions: instructions });
    if (!request.enabled || request.withCode || request.output === 'text-only') return null;
    const legacyView = request.view === 'architecture' || request.view === 'sequence' || request.view === 'flowchart' || request.view === 'state';
    const onDesign = Boolean(request.parentArtifactId) && (activeDesign?.artifact ?? 'mermaid') === 'mermaid' && legacyView;
    if (onDesign && (request.operation === 'update' || request.operation === 'create' || request.operation === 'explain')) return 'system_design_answer';
    if (request.operation === 'refine') return null;
    // A catalog visual: only pulled off a CODING route. Every other route keeps
    // its own voice and sources, and the contract in the system prompt adds the visual.
    // So is a drawing asked for by name with no code wanted ("draw a flowchart
    // of binary search"): streamed and checked as code, it came back as a code
    // answer with a diagram bolted on. A design ASK the keyword planner read
    // as coding ("Design Twitter") keeps its route — it carries code.
    if (answerType === 'coding_question_answer' || answerType === 'dsa_question_answer') {
      return legacyView && !request.parentArtifactId && !request.explicit ? null : 'general_meeting_answer';
    }
    return null;
  } catch (err) {
    warnOnce('visualTurnRoute', err);
    return null;
  }
}

/** How many reference examples ride a fresh design turn (0–2). Env override for evaluation. */
export function diagramExampleCount(): number {
  const raw = Number.parseInt(String(process.env.NATIVELY_DIAGRAM_EXAMPLES ?? ''), 10);
  return Number.isFinite(raw) ? Math.max(0, Math.min(2, raw)) : 1;
}

export { SYSTEM_DESIGN_ACTION_INSTRUCTION, isVisualActionInstruction };

export interface ResolveDiagramTurnInput {
  question?: string | null;
  /** AnswerPlanner's route for the turn. */
  answerType?: string | null;
  /** V3 classifier types (mixed code + design). */
  questionTypes?: readonly string[] | null;
  /**
   * The design on the table. Pass `session.getActiveDesign()` where the caller
   * holds the session; `undefined` reads the registered provider; `null` means
   * "this surface has none" (a transport with no session).
   */
  activeDesign?: ActiveDesign | { artifactId?: string; artifact?: string; view?: string; source?: string; version?: number; question?: string; foreground?: boolean } | null;
  /**
   * The user's standing instructions. `undefined` asks the registered provider
   * (ModesManager); a string is used as given; `null` means none.
   */
  userInstructions?: string | null;
  pinnedModeId?: string;
  /** A prefetch that may be discarded: it must not change what the session remembers. */
  speculative?: boolean;
  /**
   * What was said in the conversation so far (see getRegisteredConversationText).
   * `undefined` asks the registered reader; a string, even '', is used as given.
   */
  material?: string | null;
  /**
   * The mode's visual identity (see getRegisteredVisualMode). `undefined` asks
   * the registered provider for the pinned / active mode; `null` means "this
   * surface has no mode" (Direct Assist).
   */
  mode?: string | null;
  /** The turn was started by accepting the system-design action. */
  forceDesign?: boolean;
  /**
   * The instruction of the action card the user accepted, if any. A visual
   * action card ("Map the workflow") IS the request for that turn: the heard
   * line that triggered the offer usually does not ask for anything.
   */
  actionInstruction?: string | null;
  /** A screenshot, captured page or screen context is attached to the turn. */
  hasVisualContext?: boolean;
  /** Test seam; production reads the flag registry. */
  featureEnabled?: boolean;
}

/**
 * May the design on the table be sent to the provider? It is prior assistant
 * output about the conversation — CONVERSATION_STATE data, the transcript
 * scope (Settings > AI Providers > Privacy). When that scope is withheld the
 * design is treated as absent: nothing derived from it leaves the device, and
 * a follow-up like "add Redis" is simply an ordinary turn.
 */
export function activeDesignShareable(): boolean {
  try {
    const { readProviderScopePolicy, isScopeDenied } = require('../context-intelligence/policies/provider-scope-policy');
    return !isScopeDenied('transcript', readProviderScopePolicy());
  } catch {
    return true;
  }
}

/** Resolve everything a prompt surface needs for a turn. Never throws. */
export function resolveDiagramTurn(input: ResolveDiagramTurnInput): DiagramTurn {
  try {
    const featureEnabled = input.featureEnabled ?? isSystemDesignDiagramsEnabled();
    if (!featureEnabled) return NO_DIAGRAM_TURN;
    if (input.activeDesign === undefined) input = { ...input, activeDesign: getRegisteredActiveDesign() };
    if (input.activeDesign && !activeDesignShareable()) input = { ...input, activeDesign: null };
    let instructions: string | null = null;
    try {
      instructions = input.userInstructions === undefined ? getRegisteredUserInstructions(input.pinnedModeId) : input.userInstructions;
    } catch {
      instructions = null;
    }
    const { resolveDiagramRequest, diagramPromptSignals, renderDiagramTurnBlock } = shared();
    // An accepted action card ("Map the workflow from this conversation") is a
    // request of its own: its "this" is the conversation, never the diagram
    // that happens to be on the table.
    if (isVisualActionInstruction(input.actionInstruction)) input = { ...input, question: String(input.actionInstruction).trim(), activeDesign: null };
    const request = resolveDiagramRequest({
      question: input.question,
      answerType: input.answerType,
      questionTypes: input.questionTypes,
      activeDesign: input.activeDesign ?? null,
      featureEnabled,
      userInstructions: instructions,
      forceDesign: input.forceDesign,
      hasVisualContext: input.hasVisualContext,
      mode: input.mode === undefined ? getRegisteredVisualMode(input.pinnedModeId) : input.mode,
      material: input.material === undefined ? getRegisteredConversationText() : input.material,
    });
    const signals = diagramPromptSignals(request, { question: input.question, maxExamples: diagramExampleCount() });
    const turnBlock = renderDiagramTurnBlock(request, input.activeDesign ?? null);
    // A real turn about the artifact keeps it in focus through its answer. A
    // speculative prefetch may be thrown away, so it changes nothing.
    // Every real turn says which it is: a turn that is NOT about it clears a
    // mark left by a follow-up that was resolved and never answered.
    if (input.speculative !== true) touchRegisteredActiveDesign(Boolean(request.enabled && request.attachActiveDesign && request.parentArtifactId));
    return { request, signals, turnBlock };
  } catch (err) {
    warnOnce('resolveDiagramTurn', err);
    return NO_DIAGRAM_TURN;
  }
}

/**
 * The brainstorm action over an active design: alternatives to it, with the
 * one the model would pick drawn as a diagram. Null when there is no design on
 * the table, the feature is off, or the design may not leave the device —
 * brainstorm then behaves exactly as it always has.
 */
const SUBJECT_STOP_WORDS = new Set(['design', 'system', 'service', 'build', 'with', 'that', 'this', 'would', 'should', 'could', 'have', 'from', 'what', 'your', 'need', 'make', 'into', 'about']);
const subjectWords = (text: unknown): Set<string> =>
  new Set(String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !SUBJECT_STOP_WORDS.has(w)));

/**
 * Is this problem statement the task the design on the table was drawn for
 * (or a question about that design)? "Design a notification service with
 * retries" over the notification design is; "Merge two sorted arrays" is not.
 */
function problemIsTheDesign(problem: string, activeDesign: NonNullable<ResolveDiagramTurnInput['activeDesign']>): boolean {
  const asked = subjectWords((activeDesign as { question?: string }).question);
  if (asked.size > 0) {
    let sharedWords = 0;
    for (const word of subjectWords(problem)) if (asked.has(word)) sharedWords += 1;
    if (sharedWords >= Math.min(2, asked.size)) return true;
  }
  try {
    const request = shared().resolveDiagramRequest({ question: problem, activeDesign, featureEnabled: true });
    return Boolean(request.enabled && request.parentArtifactId);
  } catch {
    return false;
  }
}

export function alternativeDesignTurn(
  activeDesign: ResolveDiagramTurnInput['activeDesign'],
  options: {
    featureEnabled?: boolean;
    /** The problem statement or detected question the press came with, if any. */
    problem?: string | null;
    /** The press is about something else (a screenshot, or a caller that already knows). */
    otherSubject?: boolean;
  } = {},
): DiagramTurn | null {
  try {
    if (!(options.featureEnabled ?? isSystemDesignDiagramsEnabled())) return null;
    if (!activeDesign || !activeDesign.source || !activeDesignShareable()) return null;
    // Only while the design is what the conversation is on. Brainstorm pressed
    // over a coding problem twenty minutes after a design was drawn is about
    // the coding problem.
    if ((activeDesign as { foreground?: boolean }).foreground === false) return null;
    if (options.otherSubject === true) return null;
    // A problem on screen that is not this design is what the press is about.
    if (options.problem && options.problem.trim() && !problemIsTheDesign(options.problem, activeDesign)) return null;
    // Alternatives are a system-design exercise. A chart, a schema or a
    // timeline on the table leaves brainstorm exactly as it always was.
    if (((activeDesign as { artifact?: string }).artifact ?? 'mermaid') !== 'mermaid') return null;
    if (activeDesign.view && !['architecture', 'sequence', 'state', 'flowchart'].includes(activeDesign.view)) return null;
    const view = (activeDesign.view === 'sequence' || activeDesign.view === 'state' || activeDesign.view === 'flowchart' ? activeDesign.view : 'architecture') as DiagramRequest['view'];
    const request: DiagramRequest = {
      enabled: true,
      view,
      operation: 'create',
      output: 'text-and-diagram',
      basis: 'proposed-design',
      parentArtifactId: activeDesign.artifactId,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      reason: 'brainstorm_alternative',
    };
    const signals: DiagramPromptSignals = {
      view,
      operation: 'alternative',
      output: 'text-and-diagram',
      basis: 'proposed-design',
      withCode: false,
      hasParent: true,
      depth: 'brief',
      exampleIds: [],
    };
    return { request, signals, turnBlock: shared().renderDiagramTurnBlock(request, activeDesign) };
  } catch {
    return null;
  }
}

/**
 * The V3 composer's view of a diagram turn (ComposeInput.diagramTurn), or
 * undefined when the turn carries nothing for it.
 */
export function v3DiagramTurn(turn: DiagramTurn | null | undefined): { note: string; activeDesignBlock?: string } | undefined {
  if (!turn) return undefined;
  let note = '';
  try {
    note = turn.signals ? shared().renderDiagramTurnNote(turn.signals) : '';
  } catch {
    note = '';
  }
  if (!note && !turn.turnBlock) return undefined;
  return { note, ...(turn.turnBlock ? { activeDesignBlock: turn.turnBlock } : {}) };
}

/** True when the accepted dynamic action is the system-design one. */
export function isSystemDesignActionInstruction(promptInstruction: string | null | undefined): boolean {
  return typeof promptInstruction === 'string' && promptInstruction.trim() === SYSTEM_DESIGN_ACTION_INSTRUCTION;
}

/**
 * The diagram decision for a prompt LLMHelper composes for itself (a caller
 * that passed no system prompt). That caller is often a repair or a
 * regeneration with no remembered answer call, whose "message" is a whole
 * prompt: instructions, a `## QUESTION` section and a `## CONVERSATION`
 * section. The decision is made from the QUESTION alone — "can you draw the
 * auth flow for me", said twenty minutes ago and sitting in the conversation
 * section, is not this turn asking for a drawing. This transport has no
 * session: nothing is on the table, and nothing is marked.
 */
export function selfComposedDiagramSignals(message: string | null | undefined, answerType: string | null | undefined, hasImages: boolean): DiagramPromptSignals | null {
  try {
    const text = String(message ?? '');
    const composed = /<answer_instructions\b|^##\s+(?:CONVERSATION|EVIDENCE|QUESTION)\b/m.test(text);
    let question = text;
    if (composed) {
      const section = /^##\s+QUESTION\s*\n([\s\S]*?)(?=\n##\s|$)/m.exec(text);
      question = section ? section[1].trim() : '';
    }
    if (!question) return null;
    return resolveDiagramTurn({ question, answerType, activeDesign: null, hasVisualContext: hasImages, speculative: true }).signals;
  } catch {
    return null;
  }
}

/** What a drawing of this basis is drawn FROM: what was said in the meeting. */
const BASES_DRAWN_FROM_THE_CONVERSATION: ReadonlySet<string> = new Set(['meeting-reconstruction', 'evidence', 'observed-data']);
/** How much speech a reconstruction is handed: about ten minutes of talk. */
export const DIAGRAM_SPEECH_WINDOW_SECONDS = 600;
export const DIAGRAM_SPEECH_WINDOW_CHARS = 6000;
const SPEECH_BLOCK_OPEN = '<conversation_so_far>';

/**
 * The meeting's recent speech, for a turn that asks for a drawing OF it.
 *
 * The overlay's spoken question (the Answer button) composes its own prompt,
 * and that prompt holds the question and nothing of the meeting. "Draw what we
 * discussed" said aloud therefore got the contract ("draw only what someone
 * described") and nothing that anyone described: the honest answer was "the
 * conversation does not describe it", every time.
 *
 * Added only when the drawing can come from nowhere else (see the bases above)
 * and only when the transcript may be sent to the provider at all — the same
 * provider-scope policy every other route asks. Returns the user content
 * unchanged otherwise, so no other prompt differs by a byte.
 *
 * `formattedContext` is read lazily: most turns never need it.
 */
/**
 * Should the overlay's spoken question leave the meeting search for the chat
 * path? When it asks for a drawing to be made or changed, or asks about the
 * design in words that name it or one of its parts ("why do we need the
 * queue?") — and only when that path will carry the contract (the
 * self-composed prompt exists only in prompt system v2). What stays with the
 * meeting's evidence: a question that only might be about the design ("how
 * does that work?"), a question about what was SAID (the resolver does not
 * call that a follow-up at all), a refinement of wording, and a visual nobody
 * asked for.
 */
export function liveQuestionWantsADrawing(turn: DiagramTurn | null | undefined): boolean {
  try {
    const request = turn?.request as { enabled?: boolean; operation?: string; output?: string; contextual?: boolean } | undefined;
    if (!request || request.enabled !== true || request.contextual === true) return false;
    const drawing = (request.operation === 'create' || request.operation === 'update') && request.output !== 'text-only';
    const aboutTheDesign = request.operation === 'explain' && (request as { followUp?: string }).followUp === 'strong';
    if (!drawing && !aboutTheDesign) return false;
    return spokenRouteCarriesContract();
  } catch {
    return false;
  }
}

/**
 * The spoken question's prompt is composed by the transport, and the transport
 * puts the diagram contract on it only in prompt system v2. With that turned
 * off the route gets nothing of a diagram turn — no design block and no speech
 * block with no contract to say what they are for — and the meeting search
 * keeps the question.
 */
export function spokenRouteCarriesContract(): boolean {
  try {
    const { isPromptSystemV2Enabled } = require('./promptSystemV2') as typeof import('./promptSystemV2');
    return isPromptSystemV2Enabled();
  } catch {
    return false;
  }
}

export function withMeetingSpeechForDiagramTurn(
  userContent: string | null | undefined,
  turn: DiagramTurn | null | undefined,
  formattedContext: () => string | null | undefined,
  question?: string | null,
): string {
  const base = String(userContent ?? '');
  try {
    const request = turn?.request as { enabled?: boolean; operation?: string; basis?: string; output?: string } | undefined;
    if (!request || request.enabled !== true || request.operation !== 'create') return base;
    if (!BASES_DRAWN_FROM_THE_CONVERSATION.has(String(request.basis ?? ''))) return base;
    // (Its own opening tag at the start of a line; the same text inside a
    // quoted design or a transcript is neutralised where that is quoted.)
    if (new RegExp(`(?:^|\\n)${SPEECH_BLOCK_OPEN}\\n`).test(base)) return base;
    if (!activeDesignShareable()) return base;
    const { speechWindowForPrompt } = require('./conversationHistoryPolicy') as typeof import('./conversationHistoryPolicy');
    // The question itself was added to the transcript before this is read:
    // it is the request, not something that was described.
    const asked = String(question ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const lines = String(formattedContext() ?? '').split('\n');
    while (asked && lines.length > 0) {
      const last = lines[lines.length - 1].replace(/^\[[^\]]*\]:\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (last && last !== asked) break;
      lines.pop();
    }
    const speech = speechWindowForPrompt(lines.join('\n'), DIAGRAM_SPEECH_WINDOW_CHARS).trim();
    if (!speech) return base;
    // Nothing said in the meeting may close the wrapper it is quoted in, or
    // pass for the contract or the design block.
    const quoted = speech.replace(/<(\/?)(conversation_so_far|active_design|diagram_contract)/gi, '<\u200b$1$2');
    const block = `${SPEECH_BLOCK_OPEN}\nWhat was said in this meeting, most recent last. The drawing asked for in this turn is drawn from this, and from nothing that is not in it.\n${quoted}\n</conversation_so_far>`;
    return base ? `${base}\n\n${block}` : block;
  } catch (err) {
    warnOnce('withMeetingSpeechForDiagramTurn', err);
    return base;
  }
}

/**
 * Put the diagram contract on a system prompt that the v2 composer did not
 * build (a legacy fallback constant, a V3 system with no persona, the engine's
 * manual answer). A prompt that already carries the contract is returned
 * unchanged, so calling this on every path keeps "exactly once" true.
 */
export function withDiagramContract(
  systemPrompt: string | null | undefined,
  turn: DiagramTurn | null | undefined,
  options: { tier?: 'cloud' | 'local'; surface?: 'live' | 'chat' } = {},
): string {
  const base = String(systemPrompt ?? '');
  if (!turn || !turn.signals) return base;
  try {
    return shared().appendDiagramContract(base, turn.signals, options);
  } catch {
    return base;
  }
}

/**
 * Add the current design to a turn's user content (legacy, non-V3 paths —
 * the V3 composer renders it as its own section).
 */
export function withDiagramTurnBlock(userContent: string | null | undefined, turn: DiagramTurn | null | undefined): string {
  let base = String(userContent ?? '');
  if (!turn) return base;
  // An input nobody stated is said again where the model reads last. (The V3
  // composer carries the whole turn note; these paths carry only this case.)
  if (turn.signals && (turn.signals as { missingInput?: string }).missingInput) {
    let note = '';
    try {
      note = shared().renderDiagramTurnNote(turn.signals);
    } catch {
      note = '';
    }
    if (note && !base.includes(note)) base = base ? `${base}\n\n${note}` : note;
  }
  if (!turn.turnBlock || base.includes('<active_design')) return base;
  return base ? `${base}\n\n${turn.turnBlock}` : turn.turnBlock;
}
