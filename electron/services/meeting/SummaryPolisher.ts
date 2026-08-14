// SummaryPolisher.ts (#1 — constrained LLM summary polish)
//
// The deterministic Summary (MeetingSummaryReducer.buildSummary) is faithful but reads
// mechanically. This service runs ONE LLM call to rewrite it into clean, outcome-first prose
// — but ONLY over already-grounded note content, with a hard "introduce no new information"
// gate. If the polished output contains a name/number/date/significant token not present in
// the grounded input, it is REJECTED and the deterministic summary is kept. The deterministic
// version is always the fallback, so the LLM can never make Summary worse, hallucinate, or
// block completion.
//
// Privacy: sends only the already-extracted note content (tldr/decisions/actions/risks/
// section bullets) — NEVER the raw transcript. Scope-gated by the caller on post_call_summary.

import type { LLMHelper } from '../../LLMHelper';
import type { ActionItem, DecisionItem, MeetingNoteSection, RiskItem } from './MeetingSummaryV3';
import { generateStructured } from './generateStructured';

export interface PolishSummaryParams {
  deterministicSummary: string[];        // the grounded buildSummary() output
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  risks: RiskItem[];
  sections: MeetingNoteSection[];
  mode?: string | null;
}

export class SummaryPolisher {
  constructor(private readonly llmHelper: LLMHelper) {}

  // Build the grounded fact corpus the LLM is allowed to draw from (note content only).
  private buildGroundedNotes(p: PolishSummaryParams): string {
    const parts: string[] = [];
    if (p.deterministicSummary.length) parts.push(`Summary points:\n${p.deterministicSummary.map(s => `- ${s}`).join('\n')}`);
    if (p.decisions.length) parts.push(`Decisions:\n${p.decisions.map(d => `- ${d.text}`).join('\n')}`);
    if (p.actionItems.length) parts.push(`Action items:\n${p.actionItems.map(a => `- ${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` (by ${a.deadline})` : ''}`).join('\n')}`);
    if (p.risks.length) parts.push(`Risks:\n${p.risks.map(r => `- ${r.text}`).join('\n')}`);
    if (p.sections.length) parts.push(`Section notes:\n${p.sections.flatMap(s => s.bullets.map(b => `- ${b.text}`)).join('\n')}`);
    return parts.join('\n\n');
  }

  // Returns polished prose split into 3-5 lines, or null to keep the deterministic summary.
  async polish(p: PolishSummaryParams): Promise<string[] | null> {
    const grounded = this.buildGroundedNotes(p);
    if (!grounded.trim() || p.deterministicSummary.length === 0) return null;

    const systemPrompt = `Rewrite the meeting summary below into 3-5 short, clear sentences. Lead with the outcome, not chronology: sentence 1 = the meeting's purpose/topic, then the key decisions or conclusions, then the single most important next step.

STRICT RULES:
- Use ONLY the facts in the NOTES below. Introduce NO new information, name, number, date, company, or owner that is not already present in the notes.
- Do not restate an agenda or add filler ("productive discussion", "the team aligned", "great meeting").
- Plain, professional prose. No headings, no bullet markup inside sentences.
- If the notes contain no concrete outcome, return an empty "summary" array.

NOTES:
${grounded}`;

    const jsonShapeHint = `{ "summary": ["sentence 1", "sentence 2", "sentence 3"] }`;

    const result = await generateStructured<{ summary: string[] }>({
      schemaName: 'PolishedSummary',
      systemPrompt,
      jsonShapeHint,
      userContent: grounded,
      llmHelper: this.llmHelper,
      validate: (raw) => {
        const arr = (raw && typeof raw === 'object' && Array.isArray((raw as any).summary)) ? (raw as any).summary : null;
        if (!arr) return { ok: false, errors: ['missing summary array'], repaired: false };
        const lines = arr.map((s: any) => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 5);
        if (lines.length === 0) return { ok: false, errors: ['empty summary'], repaired: false };
        // HARD GATE: no new significant tokens vs the grounded input.
        const offending = newSignificantTokens(lines.join(' '), grounded);
        if (offending.length > 0) return { ok: false, errors: [`introduced new tokens: ${offending.slice(0, 5).join(', ')}`], repaired: false };
        return { ok: true, data: { summary: lines }, errors: [], repaired: false };
      },
    });

    if (result.ok && result.data && result.data.summary.length > 0) return result.data.summary;
    return null; // keep deterministic summary
  }

  // Whole-meeting Overview: a single grounded paragraph (up to ~400 words) covering the
  // entire meeting — purpose, the arc of what was discussed, key decisions/outcomes, and where
  // things landed. Drawn from the WHOLE meeting's grounded content (chunk briefs across the
  // timeline + topics + decisions/actions/risks + section bullets), never raw transcript.
  // Same "no new tokens" gate; returns null to keep the deterministic overview.
  async polishOverview(p: PolishSummaryParams & { briefs?: string[]; topics?: string[] }): Promise<string | null> {
    const noteCorpus = this.buildGroundedNotes(p);
    const timeline = (p.briefs || []).filter(Boolean);
    const topics = (p.topics || []).filter(Boolean);
    const groundedParts: string[] = [];
    if (timeline.length) groundedParts.push(`Chronological highlights:\n${timeline.map(b => `- ${b}`).join('\n')}`);
    if (topics.length) groundedParts.push(`Topics:\n${topics.map(t => `- ${t}`).join('\n')}`);
    if (noteCorpus) groundedParts.push(noteCorpus);
    const grounded = groundedParts.join('\n\n');
    if (!grounded.trim()) return null;

    const systemPrompt = `Write a single-paragraph overview of the ENTIRE meeting from the grounded notes below — a quick read that tells someone who missed it what happened. Up to 400 words; usually much shorter. Cover the meeting's purpose, the arc of what was discussed, the key decisions/outcomes, and where things landed. Flowing prose, ONE paragraph (no headings, no bullets).

STRICT RULES:
- Use ONLY the facts in the NOTES below. Introduce NO new information, name, number, date, company, or owner not already present.
- No filler ("productive discussion", "the team aligned", "great meeting"). Every sentence must carry a real fact.
- If the notes contain no substance, return an empty "overview" string.

NOTES:
${grounded}`;

    const jsonShapeHint = `{ "overview": "one flowing paragraph summarizing the whole meeting" }`;

    const result = await generateStructured<{ overview: string }>({
      schemaName: 'MeetingOverview',
      systemPrompt,
      jsonShapeHint,
      userContent: grounded,
      llmHelper: this.llmHelper,
      validate: (raw) => {
        const text = (raw && typeof raw === 'object') ? String((raw as any).overview || '').replace(/\s+/g, ' ').trim() : '';
        if (!text || text.length < 20) return { ok: false, errors: ['missing/short overview'], repaired: false };
        const words = text.split(/\s+/);
        const clipped = words.length > 400 ? words.slice(0, 400).join(' ') : text;
        const offending = newSignificantTokens(clipped, grounded);
        if (offending.length > 0) return { ok: false, errors: [`introduced new tokens: ${offending.slice(0, 5).join(', ')}`], repaired: false };
        return { ok: true, data: { overview: clipped }, errors: [], repaired: false };
      },
    });

    if (result.ok && result.data && result.data.overview) return result.data.overview;
    return null; // keep deterministic overview
  }
}

// ── "No new information" gate ─────────────────────────────────────────────────
// Flags tokens in the polished text that look like concrete facts (capitalized
// names/orgs, numbers, dates/weekdays, %/$ figures) and are NOT present in the grounded
// source. Common English words, the user, and generic connectors are ignored so ordinary
// rephrasing is allowed; only fact-shaped tokens are policed.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'for', 'of', 'in', 'on', 'by', 'with', 'from', 'as', 'at', 'is', 'are', 'was', 'were',
  'we', 'i', 'they', 'he', 'she', 'it', 'you', 'our', 'their', 'his', 'her', 'this', 'that', 'these', 'those', 'will', 'would', 'should',
  'team', 'meeting', 'call', 'next', 'step', 'steps', 'decision', 'decisions', 'action', 'items', 'summary', 'discussed', 'agreed',
  'plan', 'review', 'follow', 'up', 'after', 'before', 'during', 'about', 'into', 'be', 'been', 'has', 'have', 'had', 'do', 'does',
  'me', 'us', 'them', 'then', 'now', 'who', 'what', 'when', 'which', 'how', 'why', 'not', 'no', 'yes',
]);

const MONTHS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow', 'tonight', 'week', 'month', 'quarter']);

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9%$.]/g, ' ').replace(/\s+/g, ' ');
}

export function newSignificantTokens(polished: string, grounded: string): string[] {
  const groundedNorm = normalizeForCompare(grounded);
  const groundedSet = new Set(groundedNorm.split(' ').filter(Boolean));
  const offending: string[] = [];
  const seen = new Set<string>();

  // Tokenize the polished text preserving original case to detect proper nouns.
  const rawTokens = polished.split(/\s+/);
  for (let i = 0; i < rawTokens.length; i++) {
    const raw = rawTokens[i].replace(/[.,!?;:()"'’“”]/g, '');
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const lowerCore = lower.replace(/[^a-z0-9%$.]/g, '');
    if (!lowerCore || STOPWORDS.has(lowerCore)) continue;

    const isFirstWord = i === 0; // sentence-initial capitalization is not a proper-noun signal
    const isNumberLike = /\d/.test(lowerCore) || /[%$]/.test(lowerCore);
    const isCalendar = MONTHS.has(lowerCore) || WEEKDAYS.has(lowerCore);
    const isProperNoun = !isFirstWord && /^[A-Z][a-zA-Z'’-]+$/.test(raw);

    if (!isNumberLike && !isCalendar && !isProperNoun) continue; // only police fact-shaped tokens
    if (groundedSet.has(lowerCore)) continue;                    // present in source → fine
    // number contained within a grounded token (e.g. "soc2" vs "soc2")
    if (isNumberLike && groundedNorm.includes(lowerCore)) continue;
    if (seen.has(lowerCore)) continue;
    seen.add(lowerCore);
    offending.push(raw);
  }
  return offending;
}
