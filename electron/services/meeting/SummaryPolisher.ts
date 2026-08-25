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
import { INCLUDE_NEXT_STEPS, getOverviewBand } from './MeetingSummaryReducer';

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
  //
  // `includeActionItems` defaults to true for polishOverview() (a whole-meeting prose
  // paragraph, where a commitment mentioned in passing is not the thing being removed).
  // polish() passes false: while INCLUDE_NEXT_STEPS is false, the Summary must not end in
  // a next-step sentence, and withholding the Action items block from the corpus is what
  // makes that safe — the model cannot emit tokens it was never shown, so the
  // newSignificantTokens() "no new information" gate (which reads this same `grounded`
  // string as its reference set) never has an action item to catch. Leaving the block in
  // and only prohibiting it in the prompt risks the model mentioning one anyway and being
  // silently rejected by the gate, discarding the whole rewrite — a real bug on this branch.
  private buildGroundedNotes(p: PolishSummaryParams, includeActionItems: boolean = true): string {
    const parts: string[] = [];
    if (p.deterministicSummary.length) parts.push(`Summary points:\n${p.deterministicSummary.map(s => `- ${s}`).join('\n')}`);
    if (p.decisions.length) parts.push(`Decisions:\n${p.decisions.map(d => `- ${d.text}`).join('\n')}`);
    if (includeActionItems && p.actionItems.length) parts.push(`Action items:\n${p.actionItems.map(a => `- ${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` (by ${a.deadline})` : ''}`).join('\n')}`);
    if (p.risks.length) parts.push(`Risks:\n${p.risks.map(r => `- ${r.text}`).join('\n')}`);
    if (p.sections.length) parts.push(`Section notes:\n${p.sections.flatMap(s => s.bullets.map(b => `- ${b.text}`)).join('\n')}`);
    return parts.join('\n\n');
  }

  // Returns polished prose split into 3-5 lines, or null to keep the deterministic summary.
  async polish(p: PolishSummaryParams): Promise<string[] | null> {
    // Action items withheld while INCLUDE_NEXT_STEPS is false — see buildGroundedNotes().
    const grounded = this.buildGroundedNotes(p, INCLUDE_NEXT_STEPS);
    if (!grounded.trim() || p.deterministicSummary.length === 0) return null;

    // The opening sentence and the next-steps prohibition rule are the ONLY things that
    // differ between the two branches below. Everything else — the shared STRICT RULES,
    // the NOTES header, ${grounded} — is factored into `sharedRules` so the
    // flag-off branch can never again drift into an incomplete prompt (see 2026-08-25 code
    // review: the flag-on branch used to end right after "STRICT RULES:", silently
    // stripping every anti-fabrication rule from the restore path).
    const opening = INCLUDE_NEXT_STEPS
      ? `Rewrite the meeting summary below into 3-5 short, clear sentences. Lead with the outcome, not chronology: sentence 1 = the meeting's purpose/topic, then the key decisions or conclusions, then the single most important next step.`
      : `Rewrite the meeting summary below into 3-5 short, clear sentences. Lead with the outcome, not chronology: sentence 1 = the meeting's purpose/topic, then the key decisions or conclusions.`;

    const nextStepsRule = INCLUDE_NEXT_STEPS
      ? ''
      : '\n- Do NOT add a next-steps / action-item sentence, and do NOT mention what happens next. That is deliberately omitted — the reader tracks it elsewhere.';

    const sharedRules = `- Use ONLY the facts in the NOTES below. Introduce NO new information, name, number, date, company, or owner that is not already present in the notes.
- Do not restate an agenda or add filler ("productive discussion", "the team aligned", "great meeting").
- Plain, professional prose. No headings, no bullet markup inside sentences.
- If the notes contain no concrete outcome, return an empty "summary" array.`;

    const systemPrompt = `${opening}

STRICT RULES:${nextStepsRule}
${sharedRules}

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
    // A rejected polish means the user silently receives the mechanical deterministic
    // summary. That failure was invisible for the entire life of this feature — log it.
    console.warn(`[SummaryPolisher] Summary polish rejected, keeping deterministic version: ${result.errors.join('; ') || 'unknown'}`);
    return null;
  }

  // Whole-meeting Overview: a single grounded paragraph (up to ~400 words) covering the
  // entire meeting — purpose, the arc of what was discussed, key decisions/outcomes, and where
  // things landed. Drawn from the WHOLE meeting's grounded content (chunk briefs across the
  // timeline + topics + decisions/actions/risks + section bullets), never raw transcript.
  // Same "no new tokens" gate; returns null to keep the deterministic overview.
  // `totalTokensEstimate` is NormalizedTranscript.totalTokensEstimate (chars/4), threaded
  // in by MeetingContextAssembler — the same length signal buildOverview's deterministic
  // fallback uses (see getOverviewBand in MeetingSummaryReducer.ts). It sets a CONCRETE
  // target for THIS meeting rather than a generic ceiling: a model told "up to 400 words"
  // reliably writes ~160; a model told "write 2-3 paragraphs, about 380 words" writes that.
  async polishOverview(p: PolishSummaryParams & { briefs?: string[]; topics?: string[]; totalTokensEstimate?: number }): Promise<string | null> {
    const noteCorpus = this.buildGroundedNotes(p);
    const timeline = (p.briefs || []).filter(Boolean);
    const topics = (p.topics || []).filter(Boolean);
    const groundedParts: string[] = [];
    if (timeline.length) groundedParts.push(`Chronological highlights:\n${timeline.map(b => `- ${b}`).join('\n')}`);
    if (topics.length) groundedParts.push(`Topics:\n${topics.map(t => `- ${t}`).join('\n')}`);
    if (noteCorpus) groundedParts.push(noteCorpus);
    const grounded = groundedParts.join('\n\n');
    if (!grounded.trim()) return null;

    const band = getOverviewBand(p.totalTokensEstimate ?? 0);
    // Additive to the length target only — every rule below is unconditional and identical
    // across bands, and the STRICT RULES / NOTES block is never assembled inside a
    // conditional branch, so there is no way for a band to silently ship a truncated prompt
    // (see the 2026-08-25 review note on SummaryPolisher.polish(), which DID have that bug).
    const paragraphInstruction = band.paragraphs === 'one paragraph'
      ? 'Flowing prose, ONE paragraph (no headings, no bullets).'
      : `Flowing prose in ${band.paragraphs}, with a genuine paragraph break (a blank line) between each paragraph — no headings, no bullets, no bullet markup inside paragraphs.`;

    const systemPrompt = `Write an overview of the ENTIRE meeting from the grounded notes below — a quick read that tells someone who missed it what happened, compressed without losing anything important. Target for THIS meeting: about ${band.targetWords} words (roughly ${band.minWords}-${band.maxWords} words). ${paragraphInstruction} Cover the meeting's purpose, the arc of what was discussed, the key decisions/outcomes, and where things landed.

STRICT RULES:
- Use ONLY the facts in the NOTES below. Introduce NO new information, name, number, date, company, or owner not already present.
- No filler ("productive discussion", "the team aligned", "great meeting"). Every sentence must carry a real fact — writing more paragraphs is not licence to pad; only expand if the notes actually contain that much grounded content.
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
        // Collapse only HORIZONTAL whitespace and normalize runs of blank lines to a single
        // paragraph break (\n\n) — a plain `\s+ -> ' '` collapse (used elsewhere in this file
        // for single-line fields) would flatten every paragraph break the medium/long bands
        // just asked the model for, making that instruction a no-op.
        const text = (raw && typeof raw === 'object')
          ? String((raw as any).overview || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
          : '';
        if (!text || text.length < 20) return { ok: false, errors: ['missing/short overview'], repaired: false };
        const words = text.split(/\s+/);
        const clipped = words.length > band.maxWords ? words.slice(0, band.maxWords).join(' ') : text;
        const offending = newSignificantTokens(clipped, grounded);
        if (offending.length > 0) return { ok: false, errors: [`introduced new tokens: ${offending.slice(0, 5).join(', ')}`], repaired: false };
        return { ok: true, data: { overview: clipped }, errors: [], repaired: false };
      },
    });

    if (result.ok && result.data && result.data.overview) return result.data.overview;
    // A rejected polish means the user silently receives the mechanical deterministic
    // overview. That failure was invisible for the entire life of this feature — log it.
    console.warn(`[SummaryPolisher] Overview polish rejected, keeping deterministic version: ${result.errors.join('; ') || 'unknown'}`);
    return null;
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
  // Sentence-initial capitalisation is not a proper-noun signal. This used to be
  // `i === 0` — the first token of the ENTIRE output — so every sentence after the first
  // that opened with a capitalised non-stopword ("However,", "Additionally,") was scored
  // as an invented proper noun and discarded the whole rewrite. The prompt asks for 3-5
  // sentences, so the polish was being thrown away constantly, silently, in production.
  let atSentenceStart = true;
  for (let i = 0; i < rawTokens.length; i++) {
    const rawToken = rawTokens[i];
    const raw = rawToken.replace(/[.,!?;:()"'’“”]/g, '');
    const isFirstWord = atSentenceStart;
    // Advance the flag BEFORE any `continue` below, or a skipped token leaves it stale.
    if (raw) atSentenceStart = /[.!?]["'’”)]*$/.test(rawToken);
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const lowerCore = lower.replace(/[^a-z0-9%$.]/g, '');
    if (!lowerCore || STOPWORDS.has(lowerCore)) continue;

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
