// electron/llm/sdDeepDiveContextPack.ts
//
// Pure post-gate SD context-pack builder (SPEC 06).
// Floor vs adaptive under hard cap; locked eviction; never injects transcript.
// Callers own phase gating (unset/legacy sdPhase → treat as post-gate and call this).

import type {
  DesignCommitment,
  RecentSdAnswerItem,
  RecentSdAnswers,
  SdDesignSheet,
} from './sdRequirementsGate';

/** Upper bound of the locked ~8–12k SD-layer hard band (tokens ≈ chars/4). */
export const SD_CONTEXT_PACK_HARD_CAP_TOKENS = 12_000;

/** Locked recent-window caps for the pack floor (SPEC 06 grilling lock). */
export const SD_RECENT_MAX_ITEMS = 3;
export const SD_RECENT_MAX_TOTAL_CHARS = 6_000;

/** Effective LESSON k after score gate (SPEC 06). */
export const SD_LESSON_MAX_CHUNKS = 5;

export interface SdLessonChunk {
  text: string;
  /** Optional section hint; otherwise inferred from markdown headings in text. */
  section?: string;
  similarity?: number;
}

export interface SdDeepDiveContextPackBudgets {
  /** Hard total token cap for the assembled pack. Default: 12000. */
  maxTotalTokens?: number;
  recentMaxItems?: number;
  recentMaxTotalChars?: number;
  lessonMaxChunks?: number;
}

export interface SdDeepDiveContextPackInput {
  sheet?: SdDesignSheet | null;
  recentSdAnswers?: RecentSdAnswers | RecentSdAnswerItem[] | null;
  latestInterviewer?: string | null;
  lessonChunks?: SdLessonChunk[] | null;
  adaptiveSlice?: string | null;
  budgets?: SdDeepDiveContextPackBudgets;
  /**
   * Ignored if present — full meeting transcript must never enter the pack.
   * Accepted only so callers cannot accidentally wire it through other fields.
   */
  transcript?: string | null;
  /** Informational; builder always assembles post-gate pack shape when invoked. */
  sdPhase?: 'requirements' | 'post_requirements' | null;
}

export interface SdDeepDiveContextPackBlocks {
  designSheet: string | null;
  latestInterviewer: string | null;
  lesson: string | null;
  recentSdAnswers: string | null;
  adaptive: string | null;
}

export interface SdDeepDiveContextPackResult {
  pack: string;
  blocks: SdDeepDiveContextPackBlocks;
  meta: {
    tokenEstimate: number;
    recentItemCount: number;
    lessonChunkCount: number;
    droppedAdaptive: boolean;
    truncatedRecent: boolean;
    truncatedLesson: boolean;
  };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function wrap(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}

function serializeSheet(sheet: SdDesignSheet): string {
  const committed = (sheet.committed || []).filter(
    (c: DesignCommitment) => c.status === 'committed',
  );
  const gaps = Object.entries(sheet.coverageGaps || {})
    .map(([id, g]) => `${id}:${g.uncovered ? 'uncovered' : 'covered'}`)
    .join(', ');
  const lines = [
    `problemKey: ${sheet.problemKey ?? ''}`,
    `coverage: ${gaps}`,
    'committed:',
    ...committed.map(
      (c) =>
        `- [${c.section}/${c.fillSource}] ${c.id}: ${c.text}`,
    ),
  ];
  return wrap('design_sheet', lines.join('\n'));
}

function serializeInterviewer(text: string): string {
  return wrap('latest_interviewer', text.trim());
}

function serializeLesson(chunks: SdLessonChunk[]): string {
  const body = chunks.map((c) => c.text.trim()).filter(Boolean).join('\n\n');
  // Keep the named hellointerview reference_file shape so prompt consumers /
  // prior WTA grounding tests recognize the LESSON inject seam.
  return `<reference_file name="hellointerview-system-design.md">\n${body}\n</reference_file>`;
}

function serializeRecent(items: RecentSdAnswerItem[]): string {
  const body = items
    .map((it) => `[${it.answerId}@${it.capturedAt}] ${it.text}`)
    .join('\n\n');
  return wrap('recent_sd_answers', body);
}

function serializeAdaptive(text: string): string {
  return wrap('adaptive_probe_slice', text.trim());
}

function normalizeRecentItems(
  recent: RecentSdAnswers | RecentSdAnswerItem[] | null | undefined,
): RecentSdAnswerItem[] {
  if (!recent) return [];
  if (Array.isArray(recent)) return [...recent];
  return [...(recent.items || [])];
}

/** Cap recent window: newest survive; oldest dropped first; char cap. */
export function capRecentSdAnswers(
  items: RecentSdAnswerItem[],
  maxItems: number = SD_RECENT_MAX_ITEMS,
  maxTotalChars: number = SD_RECENT_MAX_TOTAL_CHARS,
): RecentSdAnswerItem[] {
  const sorted = [...items].sort((a, b) => a.capturedAt - b.capturedAt);
  let kept = sorted.slice(-Math.max(0, maxItems));
  while (kept.length > 0) {
    const total = kept.reduce((s, it) => s + (it.text?.length || 0), 0);
    if (total <= maxTotalChars) break;
    kept = kept.slice(1); // drop oldest
  }
  return kept;
}

function isUnderstandingChunk(chunk: SdLessonChunk): boolean {
  const hay = `${chunk.section || ''}\n${chunk.text || ''}`;
  return /Understanding\s+the\s+Problem/i.test(hay)
    || /Functional\s+Requirements/i.test(hay);
}

function assemble(
  blocks: SdDeepDiveContextPackBlocks,
): string {
  return [
    blocks.designSheet,
    blocks.latestInterviewer,
    blocks.lesson,
    blocks.recentSdAnswers,
    blocks.adaptive,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Build the bounded post-gate SD context pack.
 * Eviction under overflow: adaptive → truncate recent → truncate LESSON
 * (Understanding first) → never drop sheet + latest interviewer.
 * Full transcript and out-of-window SD history are never present.
 */
export function buildSdDeepDiveContextPack(
  input: SdDeepDiveContextPackInput,
): SdDeepDiveContextPackResult {
  const budgets = input.budgets || {};
  const maxTotalTokens = budgets.maxTotalTokens ?? SD_CONTEXT_PACK_HARD_CAP_TOKENS;
  const recentMaxItems = budgets.recentMaxItems ?? SD_RECENT_MAX_ITEMS;
  const recentMaxTotalChars = budgets.recentMaxTotalChars ?? SD_RECENT_MAX_TOTAL_CHARS;
  const lessonMaxChunks = budgets.lessonMaxChunks ?? SD_LESSON_MAX_CHUNKS;

  const designSheet =
    input.sheet != null ? serializeSheet(input.sheet) : null;
  const latestInterviewer =
    input.latestInterviewer != null && String(input.latestInterviewer).trim()
      ? serializeInterviewer(String(input.latestInterviewer))
      : null;

  let recentItems = capRecentSdAnswers(
    normalizeRecentItems(input.recentSdAnswers),
    recentMaxItems,
    recentMaxTotalChars,
  );
  const initialRecentCount = recentItems.length;

  let lessonChunks = (input.lessonChunks || [])
    .filter((c) => c && String(c.text || '').trim())
    .slice(0, lessonMaxChunks);
  const initialLessonCount = lessonChunks.length;

  let adaptiveText =
    input.adaptiveSlice != null && String(input.adaptiveSlice).trim()
      ? String(input.adaptiveSlice).trim()
      : null;

  // Explicitly ignore transcript — never serialize into the pack.
  void input.transcript;
  void input.sdPhase;

  let droppedAdaptive = false;
  let truncatedRecent = false;
  let truncatedLesson = false;

  const rebuild = (): SdDeepDiveContextPackBlocks => ({
    designSheet,
    latestInterviewer,
    lesson: lessonChunks.length > 0 ? serializeLesson(lessonChunks) : null,
    recentSdAnswers:
      recentItems.length > 0 ? serializeRecent(recentItems) : null,
    adaptive: adaptiveText ? serializeAdaptive(adaptiveText) : null,
  });

  let blocks = rebuild();
  let pack = assemble(blocks);

  const overBudget = () => estimateTokens(pack) > maxTotalTokens;

  while (overBudget()) {
    if (adaptiveText) {
      adaptiveText = null;
      droppedAdaptive = true;
      blocks = rebuild();
      pack = assemble(blocks);
      continue;
    }

    if (recentItems.length > 0) {
      // Prefer keeping newest; drop oldest. Keep at least one when possible
      // only if still over after drop — continue until under or empty.
      if (recentItems.length >= 1) {
        recentItems = recentItems.slice(1);
        truncatedRecent = true;
        blocks = rebuild();
        pack = assemble(blocks);
        continue;
      }
    }

    if (lessonChunks.length > 0) {
      const understandingIdx = lessonChunks.findIndex(isUnderstandingChunk);
      if (understandingIdx >= 0) {
        lessonChunks = lessonChunks.filter((_, i) => i !== understandingIdx);
      } else {
        lessonChunks = lessonChunks.slice(0, -1);
      }
      truncatedLesson = true;
      blocks = rebuild();
      pack = assemble(blocks);
      continue;
    }

    // Only non-droppable floor remains (sheet + utterance) — stop.
    break;
  }

  if (recentItems.length < initialRecentCount) truncatedRecent = true;
  if (lessonChunks.length < initialLessonCount) truncatedLesson = true;

  return {
    pack,
    blocks,
    meta: {
      tokenEstimate: estimateTokens(pack),
      recentItemCount: recentItems.length,
      lessonChunkCount: lessonChunks.length,
      droppedAdaptive,
      truncatedRecent,
      truncatedLesson,
    },
  };
}
