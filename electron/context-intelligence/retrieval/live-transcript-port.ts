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
import { looksLikeQuestion } from '../question/question-resolver';

export interface LiveTranscriptSegment {
  speaker: string;
  text: string;
  timestamp?: number;
  final?: boolean;
  /** SessionTracker's TranscriptOrigin. 'manual_chat' = typed into the overlay, not spoken. */
  origin?: string;
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
 * A user line that was TYPED into the overlay, not said. Typed chat is echoed
 * into the transcript as speaker 'user', and rendered as plain "ME:" it was
 * indistinguishable from speech — while the grounding rule differs: what the
 * user SAID about their own experience may evidence it (the other party heard
 * it), what they only TYPED may not (2026-09-24, owner decision).
 */
export const TYPED_USER_LABEL = 'ME (typed to the assistant)';

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
    const label = role === 'user' && s.origin === 'manual_chat' ? TYPED_USER_LABEL : LABEL[role];
    lines.push(`${label}: ${text}`);
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

const normalizeSpeech = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * True when a window holds nothing but the question being answered (2026-09-29).
 *
 * The first question of a meeting is also the whole transcript, so it came
 * back as its own evidence: `THEM: Why should we hire you?` packed as a
 * MEETING_TRANSCRIPT fact under "# Evidence". That one block switched on the
 * evidence-shaped sections ("the evidence below IS the subject at hand",
 * "the exact value could not be retrieved") and was measured to drive the
 * opener "I don't have the release scope in front of me" (DeepSeek, 3/3 → 0/3
 * without the block) on questions nothing had been said about. A question is
 * not evidence for its own answer. Any window with another line survives, and
 * a query that does not match the line exactly (a rewritten retrieval query)
 * keeps today's behaviour. A statement is not a question: "we've decided to
 * drop the CSV export" is the very thing a team-meet capture records, and
 * dropping it told DeepSeek nothing had been said (capture lines 5/5 → 0/5).
 * EXPORTED for tests.
 */
export function windowOnlyRestatesQuery(window: string, query: string): boolean {
  const q = normalizeSpeech(query);
  if (!q || !looksLikeQuestion(query)) return false;
  const lines = window.split('\n').map((l) => normalizeSpeech(l.replace(/^[^:\n]{1,40}:\s*/, ''))).filter(Boolean);
  return lines.length > 0 && lines.every((l) => l === q);
}

/**
 * A light stem for SPEECH matching only (2026-10-04, E12): "are we launching"
 * must meet "the launch target moved". Applied to both sides of the BM25
 * comparison in this port; the shared tokenizer (bm25.ts) is untouched, because
 * documents and profiles are matched on their exact terms. Deliberately
 * conservative: plural/3rd-person -s, -es, -ies, -ed, -ing; never on a short
 * word, an identifier, or a word ending in -ss.
 * EXPORTED for tests.
 */
export function stemSpeechToken(token: string): string {
  const w = String(token);
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ied')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ch|sh|x|z|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}
const stemSpeech = (text: string): string => normalizeSpeech(text).split(' ').map(stemSpeechToken).join(' ');

/**
 * Does this spoken line restate the question being answered? Exact once
 * normalised, or — because the retrieval query is the CLEANED question (fillers
 * and stutters stripped) while the transcript holds what was actually said —
 * a line that carries nearly all of the question's words and little else.
 */
function lineRestatesQuery(line: string, query: string): boolean {
  const q = normalizeSpeech(query);
  const l = normalizeSpeech(line.replace(/^[^:\n]{1,40}:\s*/, ''));
  if (!q || !l) return false;
  if (l === q) return true;
  const qt = new Set(q.split(' ').filter((w) => w.length > 2));
  const lt = l.split(' ').filter((w) => w.length > 2);
  if (qt.size < 4) return false;
  const shared = [...qt].filter((w) => lt.includes(w)).length;
  return shared / qt.size >= 0.9 && lt.length <= qt.size * 1.5 + 2;
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
  const provenance = process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION === '1' ? 'TEST_TRANSCRIPT' as const : 'LIVE_STT' as const;

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number }) => {
      // The question being answered is in the transcript too (that is how a
      // heard question arrives). Left in, its window scores 1.00 against itself
      // and every window holding what was actually said falls under the
      // relative floor (measured: 0.15–0.16 against a floor of 0.2, on every
      // meeting of 20+ lines). Its line is taken out BEFORE scoring, so the
      // floor is measured against real speech, and a question is never handed
      // back as evidence for its own answer (2026-10-04, E12).
      const asksSomething = looksLikeQuestion(query);
      const windows = chunks
        .map((text, chunkIndex) => ({
          chunkIndex,
          text: asksSomething ? text.split('\n').filter((line) => !lineRestatesQuery(line, query)).join('\n') : text,
        }))
        .filter((w) => w.text.trim().length > 0);
      if (!windows.length) return [];
      const index = new Bm25Index(windows.map((w, i) => ({ id: String(i), text: stemSpeech(w.text) })));
      return index.scoreNormalized(stemSpeech(query))
        .filter((s) => s.score >= LIVE_TRANSCRIPT_MIN_NORMALIZED_SCORE)
        .slice(0, Math.max(1, opts.topK))
        .map((s) => {
          const w = windows[Number(s.id)];
          return {
            sourceId,
            fileName: 'transcript:live',
            text: w.text,
            chunkIndex: w.chunkIndex,
            score: s.score,
            vectorScore: s.score,
            provenance,
          };
        });
    },
  });
}
