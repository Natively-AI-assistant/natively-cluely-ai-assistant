// SpeakerLabelService.ts (Phase 9, MVP)
// Editable speaker labels. Natively's STT pipeline emits two logical speakers today
// (`user` → mic, `interviewer`/system → remote); true diarization is not available yet
// (see docs/speaker-diarization-plan.md). This service:
//   - derives canonical speaker ids from raw transcript speaker strings,
//   - resolves a display name for an id, honoring a per-meeting user rename map,
//   - relabels transcript segments + evidence refs for summary regeneration.
//
// Storage: the rename map lives in summary_json.speakerLabels (a SpeakerLabelMap). No DB
// migration — old meetings simply lack the key. User renames are never overwritten by
// auto-derivation.

import type { TranscriptSegment } from '../../SessionTracker';
import type { SpeakerLabelMap } from './MeetingSummaryV3';
import { canonicalSpeaker } from './TranscriptNormalizer';

export interface SpeakerInfo {
  speakerId: string;
  defaultName: string; // auto-derived (e.g. "Me", "Speaker 1")
  displayName: string; // user rename if present, else defaultName
  isRenamed: boolean;
  segmentCount: number;
}

export class SpeakerLabelService {
  // Default display name for a canonical id (independent of any transcript).
  defaultDisplayName(speakerId: string): string {
    if (speakerId === 'me') return 'Me';
    const m = /^speaker_(\d+)$/.exec(speakerId);
    if (m) return `Speaker ${m[1]}`;
    if (speakerId === 'unknown') return 'Unknown';
    // Named id derived from a name string: title-case the slug.
    return speakerId.split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
  }

  // Resolve display name for an id given a rename map.
  resolve(speakerId: string | undefined, labels?: SpeakerLabelMap): string {
    if (!speakerId) return 'Unknown';
    const renamed = labels?.[speakerId];
    if (renamed && renamed.trim()) return renamed.trim();
    return this.defaultDisplayName(speakerId);
  }

  // Enumerate the distinct speakers present in a transcript, with counts + display names.
  listSpeakers(transcript: TranscriptSegment[], labels?: SpeakerLabelMap): SpeakerInfo[] {
    const counts = new Map<string, number>();
    for (const seg of (Array.isArray(transcript) ? transcript : [])) {
      const { speakerId } = canonicalSpeaker(seg.speaker);
      counts.set(speakerId, (counts.get(speakerId) || 0) + 1);
    }
    // Stable order: me first, then speaker_N ascending, then named, then unknown last.
    const order = (id: string): number => {
      if (id === 'me') return 0;
      const m = /^speaker_(\d+)$/.exec(id);
      if (m) return 100 + Number(m[1]);
      if (id === 'unknown') return 100000;
      return 1000;
    };
    return [...counts.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
      .map(([speakerId, segmentCount]) => {
        const defaultName = this.defaultDisplayName(speakerId);
        const renamed = labels?.[speakerId];
        const isRenamed = Boolean(renamed && renamed.trim() && renamed.trim() !== defaultName);
        return { speakerId, defaultName, displayName: isRenamed ? renamed!.trim() : defaultName, isRenamed, segmentCount };
      });
  }

  // Apply rename labels onto raw transcript segments, producing segments whose `speaker`
  // field carries the resolved display name (used as input to summary regeneration so
  // evidence and action-item owners use the user's names).
  applyLabels(transcript: TranscriptSegment[], labels?: SpeakerLabelMap): TranscriptSegment[] {
    if (!labels || Object.keys(labels).length === 0) return transcript;
    return (Array.isArray(transcript) ? transcript : []).map(seg => {
      const { speakerId } = canonicalSpeaker(seg.speaker);
      const renamed = labels[speakerId];
      if (renamed && renamed.trim()) return { ...seg, speaker: renamed.trim() };
      return seg;
    });
  }

  // Validate + sanitize a user-supplied rename map before persisting.
  sanitizeLabelMap(input: unknown): SpeakerLabelMap {
    const out: SpeakerLabelMap = {};
    if (!input || typeof input !== 'object') return out;
    for (const [id, name] of Object.entries(input as Record<string, unknown>)) {
      const cleanId = String(id).slice(0, 80).trim();
      const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (cleanId && cleanName) out[cleanId] = cleanName;
    }
    return out;
  }

  // Merge a new rename into an existing map (new entries win; empty name clears).
  mergeLabels(existing: SpeakerLabelMap | undefined, updates: SpeakerLabelMap): SpeakerLabelMap {
    const out: SpeakerLabelMap = { ...(existing || {}) };
    for (const [id, name] of Object.entries(updates)) {
      if (name && name.trim()) out[id] = name.trim();
      else delete out[id];
    }
    return out;
  }

  /**
   * Carry a rename into notes that already exist.
   *
   * "Speaker labels" promises the names reach the notes and action items, but
   * notes are written once, at meeting end, with the default names ("Me",
   * "Speaker 1") — so a rename used to show only in the transcript until the
   * user found and pressed Regenerate (a full LLM call). This rewrites the saved
   * text in place, deterministically:
   *   • each speaker's CURRENT display name (previous rename, else its default)
   *     becomes the NEW one, whole-word and case-sensitive, so "Speaker 1" never
   *     matches inside "Speaker 10" and a name never matches inside a longer word;
   *   • all renames go through ONE pass, so swapping two names cannot cascade;
   *   • "Me" is an ordinary English word, so it is only replaced where an
   *     `owner` field is exactly "Me" — never inside a sentence;
   *   • verbatim or other-meeting text is left alone: evidence quotes, the
   *     cross-meeting recall block, the structured memory record, and metadata.
   * Returns the same object shape; the input is not mutated.
   */
  applyRenamesToSummary<T>(detailed: T, previous: SpeakerLabelMap | undefined, next: SpeakerLabelMap | undefined): T {
    const renames = new Map<string, { to: string; ownerOnly: boolean }>();
    const ids = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    for (const id of ids) {
      const from = (previous?.[id] || '').trim() || this.defaultDisplayName(id);
      const to = (next?.[id] || '').trim() || this.defaultDisplayName(id);
      if (!from || !to || from === to) continue;
      // Only ids whose default is a distinctive label are rewritten by default
      // name. 'unknown' → "Unknown" is too common a word to find-and-replace.
      if (!previous?.[id] && id !== 'me' && !/^speaker_\d+$/.test(id)) continue;
      renames.set(from, { to, ownerOnly: from === 'Me' });
    }
    if (renames.size === 0 || !detailed || typeof detailed !== 'object') return detailed;

    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const froms = [...renames.keys()].filter((f) => !renames.get(f)!.ownerOnly).sort((a, b) => b.length - a.length);
    const pattern = froms.length
      ? new RegExp(`(?<![\\p{L}\\p{N}_])(${froms.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'gu')
      : null;
    const SKIP = new Set(['speakerLabels', 'crossMeeting', 'meetingMemory', 'evidence', 'mode', 'generation', 'sourceQuality']);

    const walk = (value: unknown, key: string | null): unknown => {
      if (typeof value === 'string') {
        if (key === 'owner') {
          const exact = renames.get(value.trim());
          if (exact) return exact.to;
        }
        return pattern ? value.replace(pattern, (m) => renames.get(m)?.to ?? m) : value;
      }
      if (Array.isArray(value)) return value.map((v) => walk(v, key));
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = SKIP.has(k) ? v : walk(v, k);
        }
        return out;
      }
      return value;
    };
    return walk(detailed, null) as T;
  }
}
