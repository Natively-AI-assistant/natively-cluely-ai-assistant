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
import { SYSTEM_DESIGN_ACTION_INSTRUCTION } from './systemDesignAction';

function shared() {
  return {
    ...(require('../../src/lib/diagram/diagramRequest.mjs') as typeof import('../../src/lib/diagram/diagramRequest.mjs')),
    ...(require('../../src/lib/diagram/diagramContract.mjs') as typeof import('../../src/lib/diagram/diagramContract.mjs')),
  };
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
    return request.enabled
      && Boolean(request.parentArtifactId)
      && !request.withCode
      && (request.operation === 'update' || request.operation === 'create' || request.operation === 'explain');
  } catch {
    return false;
  }
}

/** How many reference examples ride a fresh design turn (0–2). Env override for evaluation. */
export function diagramExampleCount(): number {
  const raw = Number.parseInt(String(process.env.NATIVELY_DIAGRAM_EXAMPLES ?? ''), 10);
  return Number.isFinite(raw) ? Math.max(0, Math.min(2, raw)) : 1;
}

export { SYSTEM_DESIGN_ACTION_INSTRUCTION };

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
  activeDesign?: ActiveDesign | { artifactId?: string; view?: string; source?: string; version?: number; question?: string; foreground?: boolean } | null;
  /**
   * The user's standing instructions. `undefined` asks the registered provider
   * (ModesManager); a string is used as given; `null` means none.
   */
  userInstructions?: string | null;
  pinnedModeId?: string;
  /** The turn was started by accepting the system-design action. */
  forceDesign?: boolean;
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
    const request = resolveDiagramRequest({
      question: input.question,
      answerType: input.answerType,
      questionTypes: input.questionTypes,
      activeDesign: input.activeDesign ?? null,
      featureEnabled,
      userInstructions: instructions,
      forceDesign: input.forceDesign,
      hasVisualContext: input.hasVisualContext,
    });
    const signals = diagramPromptSignals(request, { question: input.question, maxExamples: diagramExampleCount() });
    const turnBlock = renderDiagramTurnBlock(request, input.activeDesign ?? null);
    return { request, signals, turnBlock };
  } catch {
    return NO_DIAGRAM_TURN;
  }
}

/**
 * The brainstorm action over an active design: alternatives to it, with the
 * one the model would pick drawn as a diagram. Null when there is no design on
 * the table, the feature is off, or the design may not leave the device —
 * brainstorm then behaves exactly as it always has.
 */
export function alternativeDesignTurn(
  activeDesign: ResolveDiagramTurnInput['activeDesign'],
  options: { featureEnabled?: boolean } = {},
): DiagramTurn | null {
  try {
    if (!(options.featureEnabled ?? isSystemDesignDiagramsEnabled())) return null;
    if (!activeDesign || !activeDesign.source || !activeDesignShareable()) return null;
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
  const base = String(userContent ?? '');
  if (!turn || !turn.turnBlock || base.includes('<active_design')) return base;
  return base ? `${base}\n\n${turn.turnBlock}` : turn.turnBlock;
}
