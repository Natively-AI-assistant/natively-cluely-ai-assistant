import type { NormalizedTranscript, NormalizedTranscriptSegment } from './types';

export interface RawTranscriptSegment {
  speaker?: string;
  speakerId?: string;
  text?: string;
  timestamp?: number;
  segmentId?: string;
  /** Provenance tag (SessionTracker.TranscriptOrigin). 'assistant' turns are AI output. */
  origin?: string;
}

const FILLER_WORDS = new Set(['uh', 'um', 'ah', 'hmm', 'er', 'erm']);
const UNKNOWN_SPEAKER_RE = /^(unknown|speaker|participant|audio|system|ai|assistant|model)$/i;
// AI-generated turns (Defect B, 2026-08-01). NOTE: 'system' is deliberately NOT here —
// in this codebase 'system' means the system-AUDIO channel (a real remote human;
// main.ts labels mic='user' and system audio='interviewer'), not the AI.
const AI_SPEAKER_RE = /^(assistant|ai|model)$/i;
export function isAssistantTurn(seg: Pick<RawTranscriptSegment, 'speaker' | 'origin'> | null | undefined): boolean {
  if (!seg) return false;
  if (seg.origin === 'assistant') return true;
  return AI_SPEAKER_RE.test(String(seg.speaker || '').trim());
}

export function cleanTranscriptLine(text: string): string {
  return (text || '')
    .replace(/\b(\w+)(\s+\1\b){2,}/gi, '$1')
    .replace(/\b(uh|um|ah|hmm|er|erm)\b[,.]?\s*/gi, '')
    .replace(/\b(you know|i mean)\b[,.]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

// Map a raw transcript speaker string to a stable canonical speaker id + display name.
// Canonical ids are the contract used by SpeakerLabelService and evidence refs.
export function canonicalSpeaker(speaker?: string): { speaker: string; speakerId: string; uncertainSpeaker: boolean } {
  const raw = (speaker || '').trim();
  // Defect B (2026-08-01): AI turns are labeled AS the assistant — never presented as
  // a human remote speaker ("Speaker 1"), which let assistant answers masquerade as
  // meeting participants in the V3 notes path. (normalize() additionally EXCLUDES
  // these turns from evidence-bearing extraction input entirely — see below.)
  if (AI_SPEAKER_RE.test(raw)) return { speaker: 'Assistant', speakerId: 'assistant', uncertainSpeaker: false };
  if (!raw || UNKNOWN_SPEAKER_RE.test(raw)) {
    // 'system'/'audio' (system-AUDIO channel = real remote human) default to the
    // first remote speaker bucket.
    if (/^(system|audio)$/i.test(raw)) return { speaker: 'Speaker 1', speakerId: 'speaker_1', uncertainSpeaker: true };
    return { speaker: raw || 'Unknown', speakerId: 'unknown', uncertainSpeaker: true };
  }
  if (/^(user|me)$/i.test(raw)) return { speaker: 'Me', speakerId: 'me', uncertainSpeaker: false };
  if (/^(interviewer|them|other)$/i.test(raw)) return { speaker: 'Speaker 1', speakerId: 'speaker_1', uncertainSpeaker: false };
  // A named speaker — derive a stable id from the name.
  const id = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'speaker';
  return { speaker: raw, speakerId: id, uncertainSpeaker: raw.length <= 2 };
}

// Default display name for a canonical speaker id (e.g. "speaker_2" → "Speaker 2"). Falls
// back to the channel-derived name for ids that aren't the speaker_N shape.
function displayNameForId(speakerId: string, fallback: string): string {
  if (speakerId === 'me') return 'Me';
  const m = /^speaker_(\d+)$/.exec(speakerId);
  if (m) return `Speaker ${m[1]}`;
  return fallback;
}

function isInterimNoise(text: string): boolean {
  const stripped = text.toLowerCase().replace(/[\s.,!?;:]/g, '');
  if (!stripped) return true;
  if (FILLER_WORDS.has(stripped)) return true;
  return stripped.length <= 1;
}

export class TranscriptNormalizer {
  normalize(segments: RawTranscriptSegment[]): NormalizedTranscript {
    const normalized: NormalizedTranscriptSegment[] = [];
    const warnings: string[] = [];
    let previousKey = '';
    let dropped = 0;
    let uncertainSpeakers = 0;
    let longGaps = 0;
    let lastTimestamp: number | undefined;

    let assistantExcluded = 0;

    for (let i = 0; i < (Array.isArray(segments) ? segments.length : 0); i++) {
      const raw = segments[i];
      // Defect B (2026-08-01): AI-generated turns are NOT meeting evidence. The
      // normalizer is the single entry point for the V3 notes path
      // (MeetingContextAssembler.assembleSummary → chunker → LLM), so excluding
      // them here keeps assistant answers out of every downstream evidence
      // surface (atoms, owners, quotes) in one place.
      if (isAssistantTurn(raw)) {
        assistantExcluded++;
        continue;
      }
      const text = cleanTranscriptLine(raw?.text || '');
      if (!text || isInterimNoise(text)) {
        dropped++;
        continue;
      }

      const base = canonicalSpeaker(raw?.speaker);
      const uncertainSpeaker = base.uncertainSpeaker;
      // Provider diarization id (e.g. "speaker_2") wins over the channel-derived id, and its
      // display name follows from it ("Speaker 2") rather than the channel default.
      const resolvedSpeakerId = raw?.speakerId || base.speakerId;
      const speakerId = resolvedSpeakerId;
      const speaker = raw?.speakerId ? displayNameForId(resolvedSpeakerId, base.speaker) : base.speaker;
      const timestamp = typeof raw?.timestamp === 'number' && Number.isFinite(raw.timestamp) ? raw.timestamp : 0;
      const key = `${speaker.toLowerCase()}::${text.toLowerCase()}`;
      if (key === previousKey) {
        dropped++;
        continue;
      }
      previousKey = key;

      if (uncertainSpeaker) uncertainSpeakers++;
      if (lastTimestamp !== undefined && timestamp > 0 && timestamp - lastTimestamp > 7 * 60 * 1000) longGaps++;
      if (timestamp > 0) lastTimestamp = timestamp;

      normalized.push({
        segmentId: raw?.segmentId || `seg_${i}`,
        speaker,
        speakerId,
        text,
        timestamp,
        uncertainSpeaker,
        originalIndex: i,
      });
    }

    const text = normalized.map(segment => formatNormalizedSegment(segment)).join('\n');
    const uniqueSpeakers = new Set(normalized.map(s => s.speakerId)).size;
    const uncertainRatio = normalized.length ? uncertainSpeakers / normalized.length : 1;

    let speakerQuality: NormalizedTranscript['speakerQuality'] = 'good';
    if (normalized.length === 0 || uncertainRatio > 0.5) speakerQuality = 'poor';
    else if (uncertainRatio > 0.15 || uniqueSpeakers <= 1) speakerQuality = 'mixed';

    if (dropped > 0) warnings.push(`Removed ${dropped} empty, duplicate, or interim transcript segment${dropped === 1 ? '' : 's'}.`);
    if (assistantExcluded > 0) warnings.push(`Excluded ${assistantExcluded} AI-assistant turn${assistantExcluded === 1 ? '' : 's'} from meeting-notes evidence.`);
    if (speakerQuality === 'mixed') warnings.push('Speaker labels are incomplete or mixed; evidence may be less precise.');
    if (speakerQuality === 'poor') warnings.push('Speaker labels are low quality; verify owners and quotes before sharing.');
    if (longGaps > 0) warnings.push(`Detected ${longGaps} long transcript gap${longGaps === 1 ? '' : 's'}; note coverage may be incomplete.`);

    return {
      segments: normalized,
      text,
      totalChars: text.length,
      totalTokensEstimate: Math.ceil(text.length / 4),
      qualityWarnings: warnings,
      speakerQuality,
    };
  }
}

export function formatNormalizedSegment(segment: NormalizedTranscriptSegment): string {
  const timestamp = segment.timestamp > 0 ? `[${Math.floor(segment.timestamp / 1000)}s] ` : '';
  return `${timestamp}${segment.speaker}: ${segment.text}`;
}
