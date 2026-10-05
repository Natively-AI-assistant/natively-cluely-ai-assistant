// electron/services/meeting/shortSessionNotes.ts
//
// Notes for a session with almost nothing in it.
//
// A three-line session (2026-10-04: "hi", "what model are you ?", "Name.") was
// put through the full notes pipeline: one extraction call that turned 82
// characters of transcript into 2.8 KB of JSON, two polish calls and a title
// call. The result was 6.5 KB of notes about a greeting. Every guard on that
// path counted transcript LINES (`> 2`), and none looked at how much was said.
//
// Below the minimum this module writes the notes with ONE small call and no
// polish; the title is derived from the result without a model call.
//
// Pure apart from the one injected call. No Electron, no database.

import type { NormalizedTranscript } from './types';
import { TYPED_SPEAKER, ASSISTANT_REPLY_SPEAKER } from './TranscriptNormalizer';

/** Fewer human lines than this is a short session… */
export const SHORT_SESSION_MIN_LINES = 3;
/** …and so is fewer words than this across them, however many lines. */
export const SHORT_SESSION_MIN_WORDS = 40;

/** Words in the lines a PERSON produced: spoken or typed. The assistant's
 *  replies are in the notes input but must not make a session look bigger. */
export function countHumanContent(normalized: NormalizedTranscript | null | undefined): { lines: number; words: number } {
  const human = (normalized?.segments || []).filter(segment => segment.chat !== 'assistant_reply');
  const words = human.reduce((sum, segment) => sum + countWords(String(segment.text || '')), 0);
  return { lines: human.length, words };
}

// Chinese, Japanese and Thai are written without spaces, so splitting on
// whitespace counts a whole sentence as one word and a fifteen-minute meeting
// in those languages measured as "short". Intl.Segmenter knows where the words
// are; the whitespace split is only the fallback for a runtime without it.
let wordSegmenter: Intl.Segmenter | null | undefined;
export function countWords(text: string): number {
  if (!text) return 0;
  if (wordSegmenter === undefined) {
    try {
      wordSegmenter = typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null;
    } catch {
      wordSegmenter = null;
    }
  }
  if (!wordSegmenter) return text.split(/\s+/).filter(Boolean).length;
  let count = 0;
  for (const part of wordSegmenter.segment(text)) if (part.isWordLike) count++;
  return count;
}

export function isShortSession(normalized: NormalizedTranscript | null | undefined): boolean {
  const { lines, words } = countHumanContent(normalized);
  return lines < SHORT_SESSION_MIN_LINES || words < SHORT_SESSION_MIN_WORDS;
}

export const SHORT_SESSION_PROMPT = `You are a silent note-taker. This was a very short session, so the notes must be short too: never longer than what was actually said.

RULES:
- Use ONLY the lines in the user message. Do not invent, explain or pad.
- Lines from "${TYPED_SPEAKER}" were typed by the user to their AI assistant, not said aloud. "${ASSISTANT_REPLY_SPEAKER}" lines are the assistant's replies. Describe that exchange as what the user asked the assistant and what it answered; never as something said in the meeting, and never as unanswered when a reply follows.
- If nothing of substance happened, say so in one plain sentence.
- No action items unless someone clearly committed to something aloud.

Return ONLY valid JSON, no markdown fences:
{
  "overview": "one or two plain sentences",
  "keyPoints": ["zero to three short bullets, only for real content"],
  "actionItems": []
}`;

export interface ShortSessionNotes {
  overview: string;
  keyPoints: string[];
  actionItems: string[];
}

/** Parse the one call's reply. Returns null when it carries no usable notes. */
export function parseShortSessionNotes(raw: string | null | undefined): ShortSessionNotes | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] || text).trim();
  let parsed: any = null;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try { parsed = JSON.parse(candidate.slice(first, last + 1)); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const strings = (value: unknown, max: number): string[] =>
    (Array.isArray(value) ? value : [])
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, max);
  const overview = typeof parsed.overview === 'string' ? parsed.overview.trim().slice(0, 600) : '';
  const keyPoints = strings(parsed.keyPoints, 3);
  const actionItems = strings(parsed.actionItems, 3);
  if (!overview && keyPoints.length === 0) return null;
  return { overview, keyPoints, actionItems };
}
