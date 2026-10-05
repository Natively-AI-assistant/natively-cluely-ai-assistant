// electron/rag/summaryTextForSearch.ts
//
// The text of a meeting's notes that gets embedded for summary search.
//
// There were two builders and they disagreed: meeting-end indexing joined
// keyPoints and actionItems only, the reprocess path added the overview. And
// neither ran at a moment when the notes existed — indexing starts as soon as
// the meeting ends, while the notes are still being written — so no real
// meeting ever had a searchable summary (2026-10-04: two meetings in the
// database, one summary row, the seeded demo). One builder, called after the
// notes are saved.
//
// Pure, no I/O.

/** Longest summary text handed to an embedding provider. */
export const SUMMARY_TEXT_MAX_CHARS = 6000;

/** Strings MeetingPersistence writes into `summary` that are not notes. */
const PLACEHOLDER_SUMMARY_RE = /^(see detailed summary|generating summary(\.{3}|…)?|processing(\.{3}|…)?)$/i;

interface NotesForSearch {
  overview?: unknown;
  tldr?: unknown;
  keyPoints?: unknown;
  actionItems?: unknown;
  sections?: unknown;
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map(item => (typeof item === 'string' ? item : (item && typeof item === 'object' && typeof (item as any).text === 'string' ? (item as any).text : '')))
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Overview, then the takeaways (tldr when present, else keyPoints — V3 notes
 * mirror tldr into keyPoints, so reading both would repeat every line), then
 * section bullets, then action items. Returns '' when the notes carry nothing,
 * which callers treat as "do not create a summary row".
 */
export function buildSummaryTextForSearch(detailedSummary: NotesForSearch | null | undefined, legacySummary?: string | null): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    parts.push(text);
  };

  if (detailedSummary && typeof detailedSummary === 'object') {
    if (typeof detailedSummary.overview === 'string') push(detailedSummary.overview.replace(/\s+/g, ' ').trim());
    const tldr = strings(detailedSummary.tldr);
    for (const line of tldr.length > 0 ? tldr : strings(detailedSummary.keyPoints)) push(line);
    for (const section of Array.isArray(detailedSummary.sections) ? detailedSummary.sections : []) {
      for (const bullet of strings((section as any)?.bullets)) push(bullet);
    }
    for (const action of strings(detailedSummary.actionItems)) push(`Action: ${action}`);
  }

  // Meetings saved before structured notes existed carry only this string.
  // The two strings the save path writes itself are not summaries: "See
  // detailed summary" on a finished meeting, and "Generating summary..." on
  // the placeholder row that exists while the notes are being written — which
  // is exactly when meeting-end indexing reads the meeting.
  if (parts.length === 0 && typeof legacySummary === 'string') {
    const legacy = legacySummary.replace(/\s+/g, ' ').trim();
    if (legacy && !PLACEHOLDER_SUMMARY_RE.test(legacy)) push(legacy);
  }

  const joined = parts.map(part => (/[.!?]$/.test(part) ? part : `${part}.`)).join(' ');
  return joined.length > SUMMARY_TEXT_MAX_CHARS ? joined.slice(0, SUMMARY_TEXT_MAX_CHARS) : joined;
}
