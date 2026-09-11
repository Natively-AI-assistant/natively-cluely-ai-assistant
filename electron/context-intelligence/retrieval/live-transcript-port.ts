// The LIVE transcript as evidence (2026-09-11).
//
// The meeting retrieval port serves persisted, embedded meeting chunks and needs
// a meeting id. A session that is merely LISTENING — the overlay started without
// meeting metadata, or a harness-injected transcript — has neither, so a
// question about something said ten minutes ago had exactly one source: the
// composer's "Conversation so far" window, which is the last 90 seconds capped
// at 2,400 characters. Measured in team-meet with a 37-turn stand-up injected:
// "did anyone mention the elasticsearch window" → "I don't have anything on the
// Elasticsearch window in the notes I've got" while Jonas had said "we moved
// the elasticsearch relocation window to two to four utc" three minutes
// earlier. "when is the secrets rotation" → the handbook's "every 90 days"
// while the meeting had said "the twentieth… yes september twentieth".
//
// This port is the in-memory counterpart of the meeting port: the session's
// FINAL segments, grouped into speaker-labelled windows, scored lexically
// (BM25) for the turn, declared MEETING_TRANSCRIPT and scoped to the session.
// Type and scope filtering stay in createLegacyRetrievalPort — a mode that does
// not authorize MEETING_TRANSCRIPT admits nothing from here.

import type { EvidenceScope, SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import { createLegacyRetrievalPort } from './legacy-retrieval-port';
import { Bm25Index } from './bm25';

export interface LiveTranscriptSegment {
  speaker: string;
  text: string;
  timestamp?: number;
  final?: boolean;
}

export interface LiveTranscriptPortInput {
  segments: readonly LiveTranscriptSegment[];
  userId: string;
  /** Scopes the evidence to this session, so it cannot leak across sessions. */
  sessionId: string;
  /** Speaker → role, as the session tracker labels them. */
  roleOf?: (speaker: string) => 'interviewer' | 'user' | 'assistant';
}

export const LIVE_TRANSCRIPT_SOURCE_ID = 'transcript:live';
/** Target size of one retrievable window of speech. */
export const LIVE_TRANSCRIPT_CHUNK_CHARS = 600;
/** Windows below this share are noise for the question, not evidence. */
export const LIVE_TRANSCRIPT_MIN_NORMALIZED_SCORE = 0.2;

const defaultRoleOf = (speaker: string): 'interviewer' | 'user' | 'assistant' =>
  speaker === 'user' ? 'user' : speaker === 'assistant' ? 'assistant' : 'interviewer';

const LABEL: Record<'interviewer' | 'user', string> = { interviewer: 'THEM', user: 'ME' };

/**
 * Group consecutive FINAL spoken segments into windows of roughly
 * LIVE_TRANSCRIPT_CHUNK_CHARS. Assistant turns are not speech and are left out
 * (they are served as history, never as evidence). Consecutive windows share
 * their boundary utterance so a fact split across two turns survives the cut.
 * EXPORTED so the grouping is testable without a decision.
 */
export function chunkLiveTranscript(
  segments: readonly LiveTranscriptSegment[],
  roleOf: (speaker: string) => 'interviewer' | 'user' | 'assistant' = defaultRoleOf,
  max = LIVE_TRANSCRIPT_CHUNK_CHARS,
): string[] {
  const lines: string[] = [];
  for (const s of segments) {
    if (s.final === false) continue;
    const text = String(s.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const role = roleOf(String(s.speaker ?? ''));
    if (role === 'assistant') continue;
    lines.push(`${LABEL[role]}: ${text}`);
  }
  const chunks: string[] = [];
  let current: string[] = [];
  let len = 0;
  for (const line of lines) {
    if (current.length && len + line.length + 1 > max) {
      chunks.push(current.join('\n'));
      const carry = current[current.length - 1];
      current = [carry];
      len = carry.length;
    }
    current.push(line);
    len += line.length + 1;
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

export function createLiveTranscriptRetrievalPort(input: LiveTranscriptPortInput): RetrievalPort | null {
  const chunks = chunkLiveTranscript(input.segments, input.roleOf ?? defaultRoleOf);
  if (!chunks.length) return null;

  const sourceId = LIVE_TRANSCRIPT_SOURCE_ID;
  const scope: EvidenceScope = { userId: input.userId, sessionId: input.sessionId };
  const sourceTypes = new Map<string, SourceType>([[sourceId, 'MEETING_TRANSCRIPT']]);
  const activeVersions = new Map<string, string>([[sourceId, 'live']]);
  const chunkVersions = new Map<string, string>([[sourceId, 'live']]);
  const sourceScopes = new Map<string, EvidenceScope>([[sourceId, scope]]);
  const index = new Bm25Index(chunks.map((text, i) => ({ id: String(i), text })));
  const provenance = process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION === '1' ? 'TEST_TRANSCRIPT' as const : 'LIVE_STT' as const;

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number }) =>
      index.scoreNormalized(query)
        .filter((s) => s.score >= LIVE_TRANSCRIPT_MIN_NORMALIZED_SCORE)
        .slice(0, Math.max(1, opts.topK))
        .map((s) => {
          const chunkIndex = Number(s.id);
          return {
            sourceId,
            fileName: 'transcript:live',
            text: chunks[chunkIndex],
            chunkIndex,
            score: s.score,
            vectorScore: s.score,
            provenance,
          };
        }),
  });
}
