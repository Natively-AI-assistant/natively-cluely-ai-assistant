// CrossMeetingRecall.ts (Phase 13)
// Light, local-first cross-meeting intelligence. Given a freshly-generated MeetingSummaryV3
// and a list of recent prior meeting summaries, surfaces:
//   - carriedOpenQuestions : open questions that also appeared in a recent meeting
//   - recurringRisks       : risks/blockers seen before
//   - stillOpen            : short "still open from last time" lines for the UI
//
// Pure + deterministic (word-overlap matching). No LLM, no network. Degrades to empty when
// there is no prior history. Hindsight is NOT required.

import type { MeetingSummaryV3 } from './MeetingSummaryV3';

export interface PriorMeetingLite {
  id: string;
  title: string;
  date: string;
  openQuestions: string[];
  risks: string[];
}

export interface CrossMeetingResult {
  carriedOpenQuestions: Array<{ text: string; fromMeetingId: string; fromTitle: string }>;
  recurringRisks: Array<{ text: string; fromMeetingId: string; fromTitle: string }>;
  stillOpen: string[];
}

export class CrossMeetingRecall {
  compute(current: Pick<MeetingSummaryV3, 'openQuestions' | 'risks'>, priors: PriorMeetingLite[]): CrossMeetingResult {
    const result: CrossMeetingResult = { carriedOpenQuestions: [], recurringRisks: [], stillOpen: [] };
    if (!Array.isArray(priors)) return result;
    priors = priors.filter((p): p is PriorMeetingLite => Boolean(p && Array.isArray(p.openQuestions) && Array.isArray(p.risks)));
    if (priors.length === 0) return result;

    const curQuestions = (current.openQuestions || []).map(q => q.text).filter(Boolean);
    const curRisks = (current.risks || []).map(r => r.text).filter(Boolean);

    for (const q of curQuestions) {
      for (const prior of priors) {
        const match = prior.openQuestions.find(pq => similar(pq, q));
        if (match) {
          result.carriedOpenQuestions.push({ text: q, fromMeetingId: prior.id, fromTitle: prior.title });
          result.stillOpen.push(`Still open from "${prior.title}": ${q}`);
          break;
        }
      }
    }

    for (const r of curRisks) {
      for (const prior of priors) {
        const match = prior.risks.find(pr => similar(pr, r));
        if (match) {
          result.recurringRisks.push({ text: r, fromMeetingId: prior.id, fromTitle: prior.title });
          result.stillOpen.push(`Recurring risk (also in "${prior.title}"): ${r}`);
          break;
        }
      }
    }

    result.stillOpen = dedupe(result.stillOpen).slice(0, 8);
    return result;
  }
}

// Extract the comparable lite shape from a stored detailedSummary blob (V3 or legacy).
export function priorFromDetailedSummary(meeting: { id: string; title: string; date: string; detailedSummary?: any }): PriorMeetingLite | null {
  const d = meeting.detailedSummary;
  if (!d) return null;
  const openQuestions = Array.isArray(d.openQuestions) ? d.openQuestions.map((q: any) => (typeof q === 'string' ? q : q?.text)).filter(Boolean) : [];
  const risks = Array.isArray(d.risks) ? d.risks.map((r: any) => (typeof r === 'string' ? r : r?.text)).filter(Boolean) : [];
  if (openQuestions.length === 0 && risks.length === 0) return null;
  return { id: meeting.id, title: meeting.title || 'Untitled', date: meeting.date, openQuestions, risks };
}

function normalize(value: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\b(the|a|an|to|for|and|or|of|in|on|by|with|from|is|are|we|will)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function similar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aw = new Set(na.split(' '));
  const bw = new Set(nb.split(' '));
  const shared = [...aw].filter(w => bw.has(w)).length;
  const smaller = Math.min(aw.size, bw.size) || 1;
  return shared / smaller >= 0.6;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
