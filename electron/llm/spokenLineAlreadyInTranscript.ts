// electron/llm/spokenLineAlreadyInTranscript.ts
//
// The Answer button sends what the user just said aloud. The mic's STT seam
// has already stored that sentence in the session transcript as speech
// (origin 'stt'); the chat handler then stored it a second time as typed chat.
// This decides whether the second write is a duplicate.
//
// Pure, deterministic, no I/O.

export interface TranscriptLineForDedupe {
  speaker?: string;
  text?: string;
  timestamp?: number;
  origin?: string;
}

/** How far back a spoken line still counts as "the one just sent". */
export const SPOKEN_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True when the WHOLE of `message` is already in the transcript as something
 * the user SAID within the window.
 *
 * The user's recent spoken segments are joined in order and the message must
 * appear in that text as a run of whole words. That covers a question the
 * renderer joined from several mic segments, and a question that is part of a
 * longer utterance. It does NOT count a short earlier utterance that merely
 * occurs inside the question: "okay" said a minute ago must not make
 * "okay so how would you design the retry policy" look recorded when its own
 * STT final never landed — the question would then be stored nowhere.
 */
export function spokenLineAlreadyInTranscript(
  transcript: readonly TranscriptLineForDedupe[] | null | undefined,
  message: string,
  nowMs: number,
): boolean {
  const wanted = normalize(message);
  if (!wanted || !Array.isArray(transcript)) return false;
  const said: string[] = [];
  for (let i = transcript.length - 1; i >= 0; i--) {
    const seg = transcript[i];
    if (!seg) continue;
    const ts = typeof seg.timestamp === 'number' ? seg.timestamp : 0;
    if (ts > 0 && nowMs - ts > SPOKEN_DUPLICATE_WINDOW_MS) break;
    if (seg.origin !== 'stt') continue;
    if (String(seg.speaker || '').trim().toLowerCase() !== 'user') continue;
    const words = normalize(seg.text || '');
    if (words) said.unshift(words);
  }
  if (said.length === 0) return false;
  // Padded with spaces so the match is on whole words: "so" is not in "personal".
  return ` ${said.join(' ')} `.includes(` ${wanted} `);
}
