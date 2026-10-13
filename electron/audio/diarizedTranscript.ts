/**
 * Helpers for grouping word-level diarization tags into speaker segments.
 */

export interface DiarizedWordInput {
  word?: string;
  punctuated_word?: string;
  speaker?: number;
  speakerTag?: number;
}

export interface DiarizedSegment {
  text: string;
  speaker: number;
}

function wordText(w: DiarizedWordInput): string {
  return (w.punctuated_word ?? w.word ?? '').trim();
}

function wordSpeaker(w: DiarizedWordInput, field: 'speaker' | 'speakerTag'): number {
  const raw = field === 'speaker' ? w.speaker : w.speakerTag;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/**
 * Collapse a word array into contiguous runs per speaker tag.
 * Returns one segment per speaker turn (speaker change splits the text).
 */
export function groupWordsBySpeaker(
  words: DiarizedWordInput[],
  speakerField: 'speaker' | 'speakerTag' = 'speaker',
): DiarizedSegment[] {
  if (!words.length) return [];

  const segments: DiarizedSegment[] = [];
  let currentSpeaker = wordSpeaker(words[0], speakerField);
  let parts: string[] = [];

  const flush = () => {
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      segments.push({ text, speaker: currentSpeaker });
    }
    parts = [];
  };

  for (const w of words) {
    const text = wordText(w);
    if (!text) continue;

    const sp = wordSpeaker(w, speakerField);
    if (sp !== currentSpeaker && parts.length > 0) {
      flush();
      currentSpeaker = sp;
    } else if (parts.length === 0) {
      currentSpeaker = sp;
    }
    parts.push(text);
  }

  flush();
  return segments;
}
