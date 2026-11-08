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
import type { LegacyChunk } from './legacy-adapter';
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
  /** SessionTracker.getMeetingRecaps(): the meeting so far, block by block, oldest first. */
  recaps?: ReadonlyArray<{ lines: number; text: string }>;
}

export const LIVE_TRANSCRIPT_SOURCE_ID = 'transcript:live';
export const MEETING_RECAP_SOURCE_ID = 'transcript:recap';
/**
 * A request about the meeting as a whole (2026-10-15). Typed "Summarize the
 * key decisions from this meeting so far" was answered from the six best
 * windows, a few minutes of a three-hour meeting; for these the meeting recap
 * is served first. Not "what did we decide about X": served for one topic, the
 * recap's other decisions were blended into the answer ("the redesign decision
 * was about versioning" for a redesign never discussed, measured 2026-10-15).
 */
export const MEETING_OVERVIEW_RE = /\b(?:summari[sz]e|summary|recap|catch (?:me|us) up|overview|(?:key|main|big(?:gest)?) (?:decisions?|points?|takeaways?|topics?)|action items?|so far)\b/i;
/**
 * The recap must fit the turn's evidence budget, or the packer drops it whole:
 * past this many characters each block keeps only its first lines.
 */
export const MEETING_RECAP_MAX_CHARS = 4000;

/** The recap as one evidence text, each block cut to an equal share of the cap. */
export function renderMeetingRecap(recaps: ReadonlyArray<{ text: string }>, max = MEETING_RECAP_MAX_CHARS): string {
  if (!recaps.length) return '';
  const share = Math.floor(max / recaps.length);
  const parts = recaps.map((r, i) => {
    let body = '';
    for (const line of r.text.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (body && body.length + line.length + 1 > share) break;
      body += (body ? '\n' : '') + line;
    }
    return `Part ${i + 1} of ${recaps.length}:\n${body.slice(0, Math.max(share, 80))}`;
  });
  return `Recap of the meeting so far, oldest first (a summary of what was said, not a quotation; the latest minutes are in the transcript):\n${parts.join('\n')}`;
}
/** Target size of one retrievable window of speech. */
export const LIVE_TRANSCRIPT_CHUNK_CHARS = 600;
/** Windows below this share are noise for the question, not evidence. */
export const LIVE_TRANSCRIPT_MIN_NORMALIZED_SCORE = 0.2;
/**
 * The best-scoring window is served with the windows either side of it
 * (2026-10-15). Speech states a figure apart from the words that say what it
 * is: "let me do the budget thing … the number we landed on is four hundred and
 * twelve thousand dollars" fell into one window and "that's the budget, that's
 * approved" into the next, so "what budget did we approve?" found the second
 * and the answer said no figure was stated. Measured on a 2,399-line meeting:
 * 7 of 11 planted facts reached the top six windows, 9 of 11 with the best one
 * widened, for ~1,100 more characters a question. Widening more windows, or
 * overlapping them, found no more (overlap was worse: copies of one passage
 * took several of the six places).
 */
export const LIVE_TRANSCRIPT_WIDENED_HITS = 1;

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
 * The query-independent work on a window, cached by its text (2026-10-15).
 * Each question rebuilt the index from scratch: ~25 ms at 6,000 lines, two
 * thirds of it re-normalising every line (for restates()) and re-stemming
 * windows that had not changed since the last question. Two strings per
 * window (~2 KB): token arrays measured ~10 KB a window.
 */
interface PreparedWindow {
  stemmed: string;
  /** Lines normalised as restates() compares them, joined by '\n'. */
  norm: string;
}
const PREPARED = new Map<string, PreparedWindow>();
/** ~2x the windows of a ten-hour meeting (~1,600); past it the cache starts over. */
const PREPARED_MAX = 3_000;
const normLine = (line: string): string => normalizeSpeech(line.replace(/^[^:\n]{1,40}:\s*/, ''));
function prepareWindow(text: string): PreparedWindow {
  let p = PREPARED.get(text);
  if (p) return p;
  if (PREPARED.size >= PREPARED_MAX) PREPARED.clear();
  p = { stemmed: stemSpeech(text), norm: text.split('\n').map(normLine).join('\n') };
  PREPARED.set(text, p);
  return p;
}

/** Could any line of this window restate the query? A substring pre-check on the cached text. */
function mayRestate(p: PreparedWindow, q: { norm: string; words: Set<string> }): boolean {
  if (!q.norm) return false;
  if (q.words.size < 4) return p.norm.includes(q.norm);
  let present = 0;
  for (const w of q.words) if (p.norm.includes(w)) present++;
  return present / q.words.size >= 0.9;
}

function prepareQuery(query: string): { norm: string; words: Set<string> } {
  const norm = normalizeSpeech(query);
  return { norm, words: new Set(norm.split(' ').filter((w) => w.length > 2)) };
}

/**
 * Does this spoken line restate the question being answered? Exact once
 * normalised, or — because the retrieval query is the CLEANED question (fillers
 * and stutters stripped) while the transcript holds what was actually said —
 * a line that carries nearly all of the question's words and little else.
 */
function restates(lineNorm: string, q: { norm: string; words: Set<string> }): boolean {
  if (!q.norm || !lineNorm) return false;
  if (lineNorm === q.norm) return true;
  const words = lineNorm.split(' ').filter((w) => w.length > 2);
  if (q.words.size < 4 || words.length > q.words.size * 1.5 + 2) return false;
  let shared = 0;
  for (const w of q.words) if (words.includes(w)) shared++;
  return shared / q.words.size >= 0.9;
}

export function createLiveTranscriptRetrievalPort(input: LiveTranscriptPortInput): RetrievalPort | null {
  const chunks = chunkLiveTranscript(input.segments, input.roleOf ?? defaultRoleOf);
  if (!chunks.length) return null;

  const sourceId = LIVE_TRANSCRIPT_SOURCE_ID;
  const scope: EvidenceScope = { userId: input.userId, sessionId: input.sessionId };
  const sources = [sourceId, MEETING_RECAP_SOURCE_ID];
  const sourceTypes = new Map<string, SourceType>(sources.map((id) => [id, 'MEETING_TRANSCRIPT']));
  const activeVersions = new Map<string, string>(sources.map((id) => [id, 'live']));
  const chunkVersions = new Map<string, string>(sources.map((id) => [id, 'live']));
  const sourceScopes = new Map<string, EvidenceScope>(sources.map((id) => [id, scope]));
  const recapText = renderMeetingRecap(input.recaps ?? []);
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
      const q = asksSomething ? prepareQuery(query) : null;
      const windows = chunks
        .map((text, chunkIndex) => {
          const prepared = prepareWindow(text);
          if (!q || !mayRestate(prepared, q)) return { chunkIndex, text, prepared };
          const lines = text.split('\n');
          const norms = prepared.norm.split('\n');
          const kept = lines.filter((_, k) => !restates(norms[k] ?? '', q)).join('\n');
          return kept === text ? { chunkIndex, text, prepared } : { chunkIndex, text: kept, prepared: prepareWindow(kept) };
        })
        .filter((w) => w.text.trim().length > 0);
      if (!windows.length) return [];
      const index = new Bm25Index(windows.map((w, i) => ({ id: String(i), text: w.prepared.stemmed })));
      const textOf = new Map(windows.map((w) => [w.chunkIndex, w.text]));
      // A hit already served inside a widened one is not served twice.
      const served = new Set<number>();
      const out: LegacyChunk[] = [];
      if (recapText && MEETING_OVERVIEW_RE.test(query)) {
        out.push({
          sourceId: MEETING_RECAP_SOURCE_ID,
          fileName: 'transcript:recap',
          text: recapText,
          chunkIndex: 0,
          score: 1,
          vectorScore: 1,
          provenance: 'MEETING_NOTE',
        });
      }
      for (const s of index.scoreNormalized(stemSpeech(query))
        .filter((x) => x.score >= LIVE_TRANSCRIPT_MIN_NORMALIZED_SCORE)
        .slice(0, Math.max(1, opts.topK))) {
        const w = windows[Number(s.id)];
        if (served.has(w.chunkIndex)) continue;
        let text = w.text;
        if (out.filter((c) => c.sourceId === sourceId).length < LIVE_TRANSCRIPT_WIDENED_HITS) {
          const around = [w.chunkIndex - 1, w.chunkIndex, w.chunkIndex + 1];
          // Neighbouring windows share their boundary utterance: keep one copy.
          text = around.flatMap((i) => (textOf.get(i) ?? '').split('\n'))
            .filter((line, i, all) => line.trim() && line !== all[i - 1])
            .join('\n');
          for (const i of around) served.add(i);
        }
        served.add(w.chunkIndex);
        out.push({
          sourceId,
          fileName: 'transcript:live',
          text,
          chunkIndex: w.chunkIndex,
          score: s.score,
          vectorScore: s.score,
          provenance,
        });
      }
      return out;
    },
  });
}
