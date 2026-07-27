// electron/llm/sdDesignSheetExtractor.ts
//
// SPEC 05 — pure post-answer extract+merge API for design sheet / recent window.
// Heuristic / injectable-evidence Tier 0; no IntelligenceEngine wiring.

import type {
  CoverageGapId,
  DesignCommitment,
  FillSource,
  RecentSdAnswers,
  RecentSdAnswerItem,
  SdDesignSheet,
} from './sdRequirementsGate';
import { COVERAGE_GAP_CONTINUE_ORDER } from './sdRequirementsGate';

/** Max recent-window size enforced by this merge seam (SPEC 04 caps + ownership). */
export const RECENT_MAX_ITEMS = 3;
/** Soft total-char budget for recent window eviction in this module. */
export const RECENT_MAX_TOTAL_CHARS = 6000;
const COMMITMENT_TEXT_MAX = 200;
const SUPERSEDED_REASON_MAX = 80;
const COMMITTED_MAX = 40;
const RECENT_ITEM_TEXT_MAX = 600;

export interface ProvisionalExtract {
  answerId: string;
  startedAt: number;
}

/** Working sheet may carry in-flight provisional metadata (SPEC 05). */
export type SdDesignSheetWorking = SdDesignSheet & {
  provisional?: ProvisionalExtract | null;
};

export interface ExtractedCommitmentInput {
  id: string;
  section: CoverageGapId;
  text: string;
  fillSource?: FillSource;
  /** When true, supersede matching active commitment without replacement. */
  invalidate?: boolean;
  supersededReason?: string;
}

export interface ExtractedAnswerInput {
  answerId: string;
  commitments?: ExtractedCommitmentInput[];
  coveredSections?: CoverageGapId[];
}

export interface MergeExtractedAnswerArgs {
  sheet: SdDesignSheetWorking;
  recent: RecentSdAnswers;
  spokenText: string;
  meetingId: string;
  problemKey: string;
  currentMeetingId: string;
  currentProblemKey: string;
  extracted?: ExtractedAnswerInput;
  now?: number;
}

export interface MergeExtractedAnswerResult {
  sheet: SdDesignSheetWorking;
  recent: RecentSdAnswers;
  discarded: boolean;
}

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

/** Mark extract in-flight on the working sheet (does not mutate committed). */
export function startProvisional(
  sheet: SdDesignSheetWorking,
  answerId: string = 'pending',
  now: number = Date.now(),
): SdDesignSheetWorking {
  return {
    ...sheet,
    provisional: { answerId, startedAt: now },
  };
}

/** Drop provisional metadata; leave committed unchanged. */
export function clearProvisional(sheet: SdDesignSheetWorking): SdDesignSheetWorking {
  if (sheet.provisional == null) return sheet;
  const next: SdDesignSheetWorking = { ...sheet };
  delete next.provisional;
  return next;
}

/**
 * Evidence-only heuristic: pull structured commitments from optional `extracted`
 * or from explicit `id|section|text` lines in spoken text. Empty speech invents nothing.
 */
export function heuristicExtractFromSpoken(
  spokenText: string,
  extracted?: ExtractedAnswerInput,
): ExtractedAnswerInput | null {
  if (extracted?.commitments?.length || extracted?.coveredSections?.length) {
    return {
      answerId: extracted.answerId,
      commitments: extracted.commitments ?? [],
      coveredSections: extracted.coveredSections,
    };
  }
  const text = (spokenText || '').trim();
  if (!text) return extracted?.answerId ? { answerId: extracted.answerId, commitments: [] } : null;

  // Optional structured lines: COMMIT id=... section=... text=...
  const commitments: ExtractedCommitmentInput[] = [];
  const covered = new Set<CoverageGapId>();
  const lineRe =
    /^COMMIT\s+id=(\S+)\s+section=(entities|api|hld|deep_dive_topics)\s+text=(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(text)) !== null) {
    const section = m[2] as CoverageGapId;
    commitments.push({
      id: m[1],
      section,
      text: m[3].trim(),
      fillSource: 'speech',
    });
    covered.add(section);
  }

  // Invalidation lines: INVALIDATE id=... reason=...
  const invRe = /^INVALIDATE\s+id=(\S+)(?:\s+reason=(.+))?$/gim;
  while ((m = invRe.exec(text)) !== null) {
    commitments.push({
      id: m[1],
      section: 'entities',
      text: '',
      invalidate: true,
      supersededReason: (m[2] || 'interviewer invalidated').trim(),
    });
  }

  if (!commitments.length && !extracted) return null;
  return {
    answerId: extracted?.answerId ?? `ans-${Date.now()}`,
    commitments,
    coveredSections: covered.size ? [...covered] : undefined,
  };
}

function findActiveIndex(committed: DesignCommitment[], id: string): number {
  return committed.findIndex((c) => c.id === id && c.status === 'committed');
}

function recomputeCoverage(
  sheet: SdDesignSheetWorking,
  now: number,
  coveredSections?: CoverageGapId[],
): void {
  for (const section of COVERAGE_GAP_CONTINUE_ORDER) {
    const hasActive = sheet.committed.some(
      (c) => c.section === section && c.status === 'committed',
    );
    const explicit = coveredSections?.includes(section) ?? false;
    const uncovered = !(hasActive || explicit);
    sheet.coverageGaps[section] = {
      ...sheet.coverageGaps[section],
      uncovered,
      ...(hasActive || explicit ? { lastAttemptedAt: now } : {}),
    };
  }
}

function evictCommitments(committed: DesignCommitment[]): DesignCommitment[] {
  if (committed.length <= COMMITTED_MAX) return committed;
  const superseded = committed
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.status === 'superseded')
    .sort((a, b) => a.c.updatedAt - b.c.updatedAt);
  const drop = new Set<number>();
  let over = committed.length - COMMITTED_MAX;
  for (const entry of superseded) {
    if (over <= 0) break;
    drop.add(entry.i);
    over -= 1;
  }
  if (over > 0) {
    const oldest = committed
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => !drop.has(i))
      .sort((a, b) => a.c.updatedAt - b.c.updatedAt);
    for (const entry of oldest) {
      if (over <= 0) break;
      drop.add(entry.i);
      over -= 1;
    }
  }
  return committed.filter((_, i) => !drop.has(i));
}

function upsertRecent(
  recent: RecentSdAnswers,
  item: RecentSdAnswerItem,
  now: number,
): RecentSdAnswers {
  const maxItems = RECENT_MAX_ITEMS;
  const maxTotal = RECENT_MAX_TOTAL_CHARS;
  const cappedItem: RecentSdAnswerItem = {
    ...item,
    text: clampText(item.text, RECENT_ITEM_TEXT_MAX),
  };

  const withoutDup = recent.items.filter((x) => x.answerId !== cappedItem.answerId);
  let items = [cappedItem, ...withoutDup];

  while (items.length > maxItems) {
    items = items.slice(0, -1);
  }
  let total = items.reduce((n, x) => n + x.text.length, 0);
  while (items.length > 1 && total > maxTotal) {
    items = items.slice(0, -1);
    total = items.reduce((n, x) => n + x.text.length, 0);
  }
  if (items.length === 1 && items[0].text.length > maxTotal) {
    items = [{ ...items[0], text: clampText(items[0].text, maxTotal) }];
  }

  return {
    ...recent,
    items,
    updatedAt: now,
    schemaVersion: 1,
  };
}

function applyCommitments(
  sheet: SdDesignSheetWorking,
  inputs: ExtractedCommitmentInput[],
  answerId: string,
  now: number,
): void {
  for (const input of inputs) {
    if (!input.id) continue;

    if (input.invalidate) {
      const idx = findActiveIndex(sheet.committed, input.id);
      if (idx < 0) continue;
      const prior = sheet.committed[idx];
      sheet.committed[idx] = {
        ...prior,
        status: 'superseded',
        supersededById: answerId,
        supersededReason: clampText(
          input.supersededReason || 'interviewer invalidated',
          SUPERSEDED_REASON_MAX,
        ),
        updatedAt: now,
      };
      continue;
    }

    const text = clampText((input.text || '').trim(), COMMITMENT_TEXT_MAX);
    if (!text) continue;

    const next: DesignCommitment = {
      id: input.id,
      section: input.section,
      text,
      fillSource: input.fillSource ?? 'speech',
      status: 'committed',
      updatedAt: now,
    };

    const idx = findActiveIndex(sheet.committed, input.id);
    if (idx >= 0) {
      const prior = sheet.committed[idx];
      // Same id revision: mark prior superseded, keep both (prior + new) under same id
      // with only one active — supersede prior in place then push replacement.
      sheet.committed[idx] = {
        ...prior,
        status: 'superseded',
        supersededById: input.id,
        supersededReason: clampText('revised by newer evidence', SUPERSEDED_REASON_MAX),
        updatedAt: now,
      };
      sheet.committed.push(next);
    } else {
      sheet.committed.push(next);
    }
  }
  sheet.committed = evictCommitments(sheet.committed);
}

/**
 * Merge evidence-only extract into sheet + recent window.
 * Race guard: meetingId/problemKey mismatch → discard (prior state unchanged).
 */
export function mergeExtractedAnswer(
  args: MergeExtractedAnswerArgs,
): MergeExtractedAnswerResult {
  const {
    sheet,
    recent,
    spokenText,
    meetingId,
    problemKey,
    currentMeetingId,
    currentProblemKey,
    extracted,
    now = Date.now(),
  } = args;

  if (meetingId !== currentMeetingId || problemKey !== currentProblemKey) {
    // Drop in-flight provisional; leave committed sheet + recent unchanged.
    return { sheet: clearProvisional(sheet), recent, discarded: true };
  }

  const payload = heuristicExtractFromSpoken(spokenText, extracted);
  const answerId = payload?.answerId ?? extracted?.answerId ?? `ans-${now}`;

  const nextSheet: SdDesignSheetWorking = {
    ...sheet,
    coverageGaps: { ...sheet.coverageGaps },
    committed: [...sheet.committed],
    problemKey,
    updatedAt: now,
    schemaVersion: 1,
  };
  // Deep-clone gap entries
  for (const id of COVERAGE_GAP_CONTINUE_ORDER) {
    nextSheet.coverageGaps[id] = { ...sheet.coverageGaps[id] };
  }

  if (payload?.commitments?.length) {
    applyCommitments(nextSheet, payload.commitments, answerId, now);
  }
  recomputeCoverage(nextSheet, now, payload?.coveredSections);

  // Successful promotion clears provisional.
  delete nextSheet.provisional;

  const nextRecent = upsertRecent(
    {
      ...recent,
      problemKey,
      items: [...recent.items],
    },
    {
      answerId,
      capturedAt: now,
      text: spokenText || '',
      extractedCoverage: payload?.coveredSections
        ? Object.fromEntries(payload.coveredSections.map((s) => [s, true as const]))
        : undefined,
    },
    now,
  );

  return { sheet: nextSheet, recent: nextRecent, discarded: false };
}
