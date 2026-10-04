// evidenceTimes.ts
// The notes model reads each line as "[125s] Speaker: text" — seconds into the
// meeting — and cites times back in that scale. Everything downstream of the
// atoms (the timeline sort, the meeting page's "↳ 2:05" label and its
// jump-to-transcript) works in CLOCK time, the same epoch milliseconds the
// transcript rows carry. This is the one place the two are reconciled.
//
// A cited time is taken from the transcript, not from the model, whenever the
// quote can be found in a line of the chunk: the line's own timestamp is exact,
// while the model's number needs it to multiply by 1000 without slipping. The
// number is the fallback, and a number that fits no line of the chunk is
// dropped rather than shown as a time that never existed.

import type { ChunkMeetingAtoms, ModeSectionFinding, NormalizedTranscriptSegment, TranscriptChunk } from './types';
import type { EvidenceRef } from './MeetingSummaryV3';

/** Clock-time milliseconds are 13 digits; nothing a meeting lasts comes close. */
const CLOCK_TIME_FLOOR_MS = 1e11;
/** How far outside the chunk's own span a cited time may fall and still count. */
const RANGE_SLACK_MS = 5000;
/** A quote shorter than this (letters and digits only) matches too many lines. */
const MIN_QUOTE_CHARS = 8;

function comparable(text: string): string {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

interface StampedLine {
  segment: NormalizedTranscriptSegment;
  elapsedMs: number;
  text: string;
  speaker: string;
}

interface ChunkClock {
  lines: StampedLine[];
  meetingStartMs: number;
  firstElapsedMs: number;
  lastElapsedMs: number;
}

function readChunkClock(chunk: TranscriptChunk): ChunkClock | null {
  const lines: StampedLine[] = [];
  for (const segment of chunk.segments || []) {
    if (!(segment.timestamp > 0) || typeof segment.elapsedMs !== 'number') continue;
    lines.push({ segment, elapsedMs: segment.elapsedMs, text: comparable(segment.text), speaker: comparable(segment.speaker) });
  }
  if (lines.length === 0) return null;
  let firstElapsedMs = lines[0].elapsedMs;
  let lastElapsedMs = lines[0].elapsedMs;
  for (const line of lines) {
    if (line.elapsedMs < firstElapsedMs) firstElapsedMs = line.elapsedMs;
    if (line.elapsedMs > lastElapsedMs) lastElapsedMs = line.elapsedMs;
  }
  return { lines, meetingStartMs: lines[0].segment.timestamp - lines[0].elapsedMs, firstElapsedMs, lastElapsedMs };
}

/** A model-cited time as elapsed milliseconds, or undefined when it fits no reading. */
function citedElapsedMs(value: unknown, clock: ChunkClock): number | undefined {
  // 0 is the placeholder in the JSON shape the model is shown, and models copy
  // it; a real first-line citation is found by its quote instead.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  // Already clock time (notes written before 2026-10-05, or a model that kept
  // the old habit): bring it onto the meeting's own scale to range-check it.
  if (value >= CLOCK_TIME_FLOOR_MS) {
    const elapsed = value - clock.meetingStartMs;
    return elapsed >= clock.firstElapsedMs - RANGE_SLACK_MS && elapsed <= clock.lastElapsedMs + RANGE_SLACK_MS ? Math.max(0, elapsed) : undefined;
  }
  // The printed label is whole seconds. An exact hit on a line's label settles
  // whether the model answered in milliseconds (asked for) or left it in seconds.
  if (clock.lines.some(line => Math.floor(line.elapsedMs / 1000) * 1000 === value)) return value;
  if (clock.lines.some(line => Math.floor(line.elapsedMs / 1000) === value)) return value * 1000;
  const inRange = (ms: number) => ms >= clock.firstElapsedMs - RANGE_SLACK_MS && ms <= clock.lastElapsedMs + RANGE_SLACK_MS;
  if (inRange(value)) return value;
  if (inRange(value * 1000)) return value * 1000;
  return undefined;
}

/** The line a quote was taken from, when exactly one reading of it is best. */
function lineForQuote(evidence: EvidenceRef, cited: number | undefined, clock: ChunkClock): StampedLine | undefined {
  const quote = comparable(evidence.quote || '');
  if (quote.replace(/ /g, '').length < MIN_QUOTE_CHARS) return undefined;
  let matches = clock.lines.filter(line => line.text.includes(quote));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    const speaker = comparable(evidence.speakerName || '');
    const sameSpeaker = speaker ? matches.filter(line => line.speaker === speaker) : [];
    if (sameSpeaker.length > 0) matches = sameSpeaker;
  }
  if (matches.length > 1 && cited !== undefined) {
    return matches.reduce((best, line) => Math.abs(line.elapsedMs - cited) < Math.abs(best.elapsedMs - cited) ? line : best);
  }
  return matches[0];
}

function anchorEvidence(evidence: EvidenceRef, clock: ChunkClock): EvidenceRef {
  const cited = citedElapsedMs(evidence.timestampMs, clock);
  const line = lineForQuote(evidence, cited, clock);
  const { timestampMs: _cited, ...rest } = evidence;
  if (line) return { ...rest, timestampMs: line.segment.timestamp };
  if (cited !== undefined) return { ...rest, timestampMs: clock.meetingStartMs + cited };
  return rest;
}

function anchorEvidenceList(list: EvidenceRef[] | undefined, clock: ChunkClock): EvidenceRef[] | undefined {
  return Array.isArray(list) ? list.map(e => anchorEvidence(e, clock)) : list;
}

/** Rewrite an item's own time field: its first anchored quote wins, then its number. */
function anchorItem<T extends { evidence?: EvidenceRef[] }>(item: T, field: 'timestampMs' | 'sourceTimestampMs', clock: ChunkClock): T {
  const evidence = anchorEvidenceList(item.evidence, clock);
  const fromEvidence = evidence?.find(e => typeof e.timestampMs === 'number')?.timestampMs;
  const cited = citedElapsedMs((item as any)[field], clock);
  const resolved = fromEvidence ?? (cited !== undefined ? clock.meetingStartMs + cited : undefined);
  const { [field]: _old, ...rest } = item as any;
  return {
    ...rest,
    ...(evidence ? { evidence } : {}),
    ...(resolved !== undefined ? { [field]: resolved } : {}),
  } as T;
}

function anchorEvidenceOnly<T extends { evidence?: EvidenceRef[] }>(item: T, clock: ChunkClock): T {
  const evidence = anchorEvidenceList(item.evidence, clock);
  return evidence ? { ...item, evidence } : item;
}

/**
 * Put every time the model cited for this chunk onto clock time. Returns the
 * atoms unchanged when the chunk has no stamped lines to anchor to.
 */
export function anchorAtomTimes(atoms: ChunkMeetingAtoms, chunk: TranscriptChunk): ChunkMeetingAtoms {
  const clock = readChunkClock(chunk);
  if (!clock) return atoms;
  const findings: Record<string, ModeSectionFinding[]> = {};
  for (const [title, list] of Object.entries(atoms.modeSpecificFindings || {})) {
    findings[title] = (list || []).map(finding => anchorEvidenceOnly(finding, clock));
  }
  return {
    ...atoms,
    decisions: (atoms.decisions || []).map(item => anchorItem(item, 'timestampMs', clock)),
    actionItems: (atoms.actionItems || []).map(item => anchorItem(item, 'sourceTimestampMs', clock)),
    ...(atoms.deadlines ? { deadlines: atoms.deadlines.map(item => anchorItem(item, 'sourceTimestampMs', clock)) } : {}),
    openQuestions: (atoms.openQuestions || []).map(item => anchorEvidenceOnly(item, clock)),
    risks: (atoms.risks || []).map(item => anchorEvidenceOnly(item, clock)),
    importantQuotes: anchorEvidenceList(atoms.importantQuotes, clock) || [],
    modeSpecificFindings: findings,
  };
}

/** The chunk's span as time into the meeting, for the extraction prompt. */
export function chunkElapsedRange(chunk: TranscriptChunk): { startMs: number; endMs: number } | null {
  const clock = readChunkClock(chunk);
  return clock ? { startMs: clock.firstElapsedMs, endMs: clock.lastElapsedMs } : null;
}
