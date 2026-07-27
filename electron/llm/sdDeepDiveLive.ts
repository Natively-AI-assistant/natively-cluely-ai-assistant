// electron/llm/sdDeepDiveLive.ts
//
// Live-path helpers for post-gate SD deep-dive wiring (SPECs 05/06/07).
// Pure orchestration — IntelligenceEngine / WhatToAnswerLLM call these;
// Requirements gate path remains identity (no pack / no extract / soft-checks
// no-op when sdPhase=requirements).

import type {
  RecentSdAnswers,
  SdDesignSheet,
  SdRequirementsSessionArtifact,
} from './sdRequirementsGate';
import {
  createEmptyRecentSdAnswers,
  createEmptySdDesignSheet,
  ensureSdDeepDiveExtension,
} from './sdRequirementsGate';
import {
  mergeExtractedAnswer,
  startProvisional,
  type SdDesignSheetWorking,
} from './sdDesignSheetExtractor';
import type { DeepDiveCheckContext } from './sdDeepDiveSoftChecks';

export interface SdDeepDivePackSnapshot {
  designSheet: SdDesignSheet | null;
  recentSdAnswers: RecentSdAnswers | null;
  latestInterviewer: string | null;
}

/** Snapshot inputs for WTA post-gate pack assembly (never includes transcript). */
export function buildSdDeepDivePackSnapshot(
  artifact: SdRequirementsSessionArtifact | null | undefined,
  latestInterviewer: string | null | undefined,
): SdDeepDivePackSnapshot {
  if (!artifact) {
    return {
      designSheet: null,
      recentSdAnswers: null,
      latestInterviewer: latestInterviewer?.trim() ? latestInterviewer.trim() : null,
    };
  }
  const ext = ensureSdDeepDiveExtension(artifact);
  return {
    designSheet: ext.designSheet ?? null,
    recentSdAnswers: ext.recentSdAnswers ?? null,
    latestInterviewer: latestInterviewer?.trim() ? latestInterviewer.trim() : null,
  };
}

/** Build soft-check corpus from pack inputs + this-turn LESSON chunks. */
export function buildDeepDiveCheckContext(args: {
  sheet?: SdDesignSheet | null;
  recentSdAnswers?: RecentSdAnswers | null;
  lessonChunks?: Array<{ text: string }> | null;
  lessonInjected: boolean;
}): DeepDiveCheckContext {
  const sheet = args.sheet;
  const committed = (sheet?.committed || []).filter((c) => c.status === 'committed');
  const superseded = (sheet?.committed || []).filter((c) => c.status === 'superseded');
  const recentItems = args.recentSdAnswers?.items || [];
  const lessonTexts = (args.lessonChunks || [])
    .map((c) => String(c?.text || '').trim())
    .filter(Boolean);
  return {
    lessonInjected: args.lessonInjected,
    sheetCommittedTexts: committed.map((c) => c.text),
    lessonChunkTexts: lessonTexts,
    recentAnswerTexts: recentItems.map((it) => it.text),
    supersededCommittedTexts: superseded.map((c) => c.text).filter(Boolean),
  };
}

export interface ApplyCompletedSdAnswerArgs {
  artifact: SdRequirementsSessionArtifact;
  spokenText: string;
  meetingId: string;
  currentMeetingId: string;
  answerType?: string | null;
  sdPhase?: string | null;
  blockedFromSessionTracker?: boolean;
  doNotStore?: boolean;
  now?: number;
}

export interface ApplyCompletedSdAnswerResult {
  artifact: SdRequirementsSessionArtifact;
  applied: boolean;
  discarded: boolean;
}

/**
 * Post-answer extract+merge for completed post-gate system_design_answer turns.
 * Identity skip when Requirements-gated, blocked/do_not_store, or wrong answerType.
 * Race discard when meetingId/problemKey mismatch (mergeExtractedAnswer).
 */
export function applyCompletedSdAnswerToArtifact(
  args: ApplyCompletedSdAnswerArgs,
): ApplyCompletedSdAnswerResult {
  const {
    spokenText,
    meetingId,
    currentMeetingId,
    answerType,
    sdPhase,
    blockedFromSessionTracker,
    doNotStore,
    now = Date.now(),
  } = args;

  if (answerType !== 'system_design_answer') {
    return { artifact: args.artifact, applied: false, discarded: false };
  }
  if (sdPhase === 'requirements') {
    return { artifact: args.artifact, applied: false, discarded: false };
  }
  if (blockedFromSessionTracker || doNotStore) {
    return { artifact: args.artifact, applied: false, discarded: false };
  }

  const ext = ensureSdDeepDiveExtension(args.artifact);
  const problemKey = ext.problemKey ?? '';
  const answerId = `ans-${now}`;
  const sheetWithProv = startProvisional(
    (ext.designSheet || createEmptySdDesignSheet(problemKey)) as SdDesignSheetWorking,
    answerId,
    now,
  );
  const recent = ext.recentSdAnswers || createEmptyRecentSdAnswers(problemKey);

  const merged = mergeExtractedAnswer({
    sheet: sheetWithProv,
    recent,
    spokenText,
    meetingId,
    problemKey,
    currentMeetingId,
    currentProblemKey: problemKey,
    now,
  });

  if (merged.discarded) {
    return {
      artifact: { ...ext, designSheet: merged.sheet },
      applied: false,
      discarded: true,
    };
  }

  return {
    artifact: {
      ...ext,
      designSheet: merged.sheet,
      recentSdAnswers: merged.recent,
    },
    applied: true,
    discarded: false,
  };
}
