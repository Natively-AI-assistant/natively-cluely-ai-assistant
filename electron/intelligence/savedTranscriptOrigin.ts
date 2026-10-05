// electron/intelligence/savedTranscriptOrigin.ts
//
// What a SAVED transcript line is: speech, typed chat, or assistant output.
//
// The live session tags every line with an origin (SessionTracker.
// TranscriptOrigin), but until 2026-10-04 the `transcripts` table had no column
// for it. Everything that re-read a saved meeting — search indexing, regenerate
// notes, reindex — therefore treated a typed question and the assistant's
// answer as things said in the meeting. A three-line session was indexed as
// four segments, three of them the assistant's own replies.
//
// Pure, no I/O, no Electron: required by the database layer, the indexer and
// the notes pipeline alike.

/** The origins the session writes. Anything else is stored as NULL. */
const KNOWN_ORIGINS = new Set(['stt', 'manual_chat', 'assistant', 'system_instruction', 'test']);

/**
 * The stored form of "an assistant line that answers typed chat". In memory
 * that is `origin: 'assistant'` plus `chatReply: true`, so every existing
 * `origin === 'assistant'` reader keeps working; one column holds both facts.
 */
const SAVED_CHAT_REPLY = 'assistant_chat';

const ASSISTANT_SPEAKER_RE = /^(assistant|ai|model|natively)$/i;

export interface SavedTranscriptLine {
  speaker?: string;
  origin?: string | null;
  chatReply?: boolean;
}

/** Column value for a line about to be saved, or null when its origin is unknown. */
export function encodeSavedOrigin(seg: SavedTranscriptLine | null | undefined): string | null {
  const origin = typeof seg?.origin === 'string' ? seg.origin : '';
  if (!KNOWN_ORIGINS.has(origin)) return null;
  if (origin === 'assistant' && seg?.chatReply === true) return SAVED_CHAT_REPLY;
  return origin;
}

/** Fields to spread onto a line read back from the database. */
export function decodeSavedOrigin(stored: unknown): { origin?: string; chatReply?: boolean } {
  if (stored === SAVED_CHAT_REPLY) return { origin: 'assistant', chatReply: true };
  if (typeof stored === 'string' && KNOWN_ORIGINS.has(stored)) return { origin: stored };
  return {};
}

/**
 * True when a saved line is something a person SAID in the meeting — the only
 * lines that may be indexed for search as meeting content.
 *
 * With an origin: speech only ('stt'; 'test' under the same explicit env
 * opt-in that allows test transcripts at all). Without one — a meeting saved
 * before the column existed — the speaker is all there is: assistant lines are
 * left out, and a typed question cannot be told from a spoken one, so it stays.
 * That is the old behaviour minus the assistant's answers.
 *
 * Deliberately NOT isMemoryEligibleSegment: its legacy fallback reads the STT
 * confidence, which is never saved, so it would call every line of every older
 * meeting ineligible and empty their search index on the next reindex.
 */
export function isSpokenSavedLine(seg: SavedTranscriptLine | null | undefined): boolean {
  if (!seg || typeof seg !== 'object') return false;
  const origin = typeof seg.origin === 'string' ? seg.origin : '';
  if (origin) {
    if (origin === 'stt') return true;
    return origin === 'test' && process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION === '1';
  }
  return !ASSISTANT_SPEAKER_RE.test(String(seg.speaker || '').trim());
}
