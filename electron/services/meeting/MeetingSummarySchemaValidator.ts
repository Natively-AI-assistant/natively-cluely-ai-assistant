// MeetingSummarySchemaValidator.ts
// JSON extraction + chunk-atom validation. Full MeetingSummaryV3 validation now lives in
// MeetingSummaryV3.validateMeetingSummaryV3 — this class delegates to it for back-compat
// so existing callers keep working.

import type { ChunkMeetingAtoms } from './types';
import {
  cleanString,
  cleanNoteText,
  sanitizeStringArray,
  sanitizeDecisions,
  sanitizeActions,
  sanitizeQuestions,
  sanitizeRisks,
  sanitizeEvidenceArray,
  validateMeetingSummaryV3,
  type MeetingSummaryV3,
} from './MeetingSummaryV3';

export class MeetingSummarySchemaValidator {
  parseJsonObject<T = any>(raw: string): T | null {
    const text = String(raw || '').trim();
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = (fenced?.[1] || text).trim();
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const first = candidate.indexOf('{');
      const last = candidate.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try { return JSON.parse(candidate.slice(first, last + 1)) as T; } catch { /* fall through */ }
      }
      return null;
    }
  }

  validateAndRepairAtoms(value: unknown, fallbackChunkIndex: number, opts?: { allowedSectionTitles?: string[]; chunkText?: string }): ChunkMeetingAtoms | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as any;
    // Accept both new (timeRange.startMs/endMs) and legacy (start/end) keys.
    const startMs = num(raw.timeRange?.startMs) ?? num(raw.timeRange?.start);
    const endMs = num(raw.timeRange?.endMs) ?? num(raw.timeRange?.end);
    const atoms: ChunkMeetingAtoms = {
      chunkIndex: Number.isFinite(Number(raw.chunkIndex)) ? Number(raw.chunkIndex) : fallbackChunkIndex,
      timeRange: {
        ...(startMs !== undefined ? { startMs } : {}),
        ...(endMs !== undefined ? { endMs } : {}),
      },
      brief: cleanNoteText(raw.brief, 500),
      topics: sanitizeStringArray(raw.topics, 20),
      decisions: sanitizeDecisions(raw.decisions, 20),
      actionItems: sanitizeActions(raw.actionItems, 20),
      openQuestions: sanitizeQuestions(raw.openQuestions, 20),
      risks: sanitizeRisks(raw.risks, 20),
      deadlines: sanitizeActions(raw.deadlines, 20),
      people: Array.isArray(raw.people)
        ? raw.people.map((p: any) => ({
            name: cleanString(p?.name),
            ...(p?.role ? { role: cleanString(p.role) } : {}),
            ...(p?.organization ? { organization: cleanString(p.organization) } : {}),
            ...(Number.isFinite(Number(p?.mentions)) ? { mentions: Number(p.mentions) } : {}),
          })).filter((p: any) => p.name).slice(0, 20)
        : [],
      importantQuotes: sanitizeEvidenceArray(raw.importantQuotes, 12),
      modeSpecificFindings: sanitizeFindings(raw.modeSpecificFindings, opts?.allowedSectionTitles),
      sourceQualityWarnings: sanitizeStringArray(raw.sourceQualityWarnings, 12),
    };
    return atoms;
  }

  validateAndRepairSummary(value: unknown): MeetingSummaryV3 | null {
    const res = validateMeetingSummaryV3(value);
    return res.ok && res.data ? res.data : null;
  }
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Coerce modeSpecificFindings into Record<title, ModeSectionFinding[]>. Accepts the new
// object-finding shape AND a bare string (legacy/loose) coerced to { text }. When an
// allowed-title set is provided, keys not matching a real mode section are DROPPED — the
// model cannot invent new sections (matched case/space-insensitively to the canonical title).
function sanitizeFindings(value: unknown, allowedTitles?: string[]): Record<string, import('./types').ModeSectionFinding[]> {
  if (!value || typeof value !== 'object') return {};
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const allowed = allowedTitles && allowedTitles.length
    ? new Map(allowedTitles.map(t => [norm(t), t]))
    : null;
  const out: Record<string, import('./types').ModeSectionFinding[]> = {};
  for (const [key, items] of Object.entries(value as Record<string, unknown>)) {
    const rawTitle = cleanString(key).slice(0, 80);
    if (!rawTitle) continue;
    // Drop invented keys; canonicalize to the exact mode section title when allowed.
    let title = rawTitle;
    if (allowed) {
      const canonical = allowed.get(norm(rawTitle));
      if (!canonical) continue;
      title = canonical;
    }
    const list = Array.isArray(items) ? items : [];
    const findings: import('./types').ModeSectionFinding[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const text = cleanNoteText(typeof item === 'string' ? item : item?.text);
      if (!text) continue;
      const k = text.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const finding: import('./types').ModeSectionFinding = { text };
      if (item && typeof item === 'object') {
        const ev = sanitizeEvidenceArray((item as any).evidence, 3);
        if (ev.length) finding.evidence = ev;
        if ((item as any).source === 'explicit' || (item as any).source === 'inferred') finding.source = (item as any).source;
        if (['high', 'medium', 'low'].includes((item as any).confidence)) finding.confidence = (item as any).confidence;
      }
      findings.push(finding);
      if (findings.length >= 20) break;
    }
    if (findings.length) out[title] = findings;
  }
  return out;
}
