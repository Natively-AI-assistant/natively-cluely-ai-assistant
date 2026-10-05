// CrossMeetingRecall.ts (Phase 13)
// Light, local-first cross-meeting intelligence. Given a freshly-generated MeetingSummaryV3
// and a list of recent prior meeting summaries, surfaces:
//   - carriedOpenQuestions : open questions that also appeared in a recent meeting
//   - carriedActionItems   : action items that were already on a recent meeting's list
//   - earlierDecisions     : a recent meeting's decision on what this one discussed
//   - recurringRisks       : risks/blockers seen before
//   - stillOpen            : short "still open from last time" lines for the UI
// ("Capture key points" promises decisions AND open items carry forward; until
// 2026-09-25 only questions and risks did.)
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
  actionItems?: string[];
  decisions?: string[];
}

type Carried = Array<{ text: string; fromMeetingId: string; fromTitle: string }>;

export interface CrossMeetingResult {
  carriedOpenQuestions: Carried;
  carriedActionItems: Carried;
  earlierDecisions: Carried;
  recurringRisks: Carried;
  stillOpen: string[];
}

export class CrossMeetingRecall {
  compute(
    current: Pick<MeetingSummaryV3, 'openQuestions' | 'risks'> & Partial<Pick<MeetingSummaryV3, 'actionItems' | 'decisions'>>,
    priors: PriorMeetingLite[],
  ): CrossMeetingResult {
    const result: CrossMeetingResult = { carriedOpenQuestions: [], carriedActionItems: [], earlierDecisions: [], recurringRisks: [], stillOpen: [] };
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

    // An action item that was already on a recent meeting's list was not done
    // then — it is still open.
    const curActions = (current.actionItems || []).map(a => a.text).filter(Boolean);
    for (const a of curActions) {
      for (const prior of priors) {
        const match = (prior.actionItems || []).find(pa => similar(pa, a));
        if (match) {
          result.carriedActionItems.push({ text: a, fromMeetingId: prior.id, fromTitle: prior.title });
          result.stillOpen.push(`Still to do from "${prior.title}": ${a}`);
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

    // A recent meeting already DECIDED something this one discussed (as a
    // decision or an open question) — surface the earlier decision, verbatim.
    const curTopics = [...(current.decisions || []).map(d => d.text), ...curQuestions].filter(Boolean);
    for (const topic of curTopics) {
      for (const prior of priors) {
        const match = (prior.decisions || []).find(pd => similar(pd, topic));
        if (match) {
          result.earlierDecisions.push({ text: match, fromMeetingId: prior.id, fromTitle: prior.title });
          result.stillOpen.push(`Decided in "${prior.title}": ${match}`);
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
  const texts = (list: unknown): string[] =>
    Array.isArray(list) ? list.map((x: any) => (typeof x === 'string' ? x : x?.text)).filter(Boolean) : [];
  const openQuestions = texts(d.openQuestions);
  const risks = texts(d.risks);
  // V3 keeps the structured list under actionItemsV3; `actionItems` is its
  // string bridge (and the legacy shape).
  const actionItems = texts(d.actionItemsV3 ?? d.actionItems);
  const decisions = texts(d.decisions);
  if (openQuestions.length === 0 && risks.length === 0 && actionItems.length === 0 && decisions.length === 0) return null;
  return { id: meeting.id, title: meeting.title || 'Untitled', date: meeting.date, openQuestions, risks, actionItems, decisions };
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
