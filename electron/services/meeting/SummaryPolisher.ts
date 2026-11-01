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
import { MEETING_TITLE_RULE, isEmptyListPlaceholder, isEmptyPlaceholder, isEmptySessionTitle, type ActionItem, type DecisionItem, type MeetingNoteSection, type RiskItem } from './MeetingSummaryV3';
import { generateStructured, NOTE_CALL_TIMEOUT_MS } from './generateStructured';
import { INCLUDE_NEXT_STEPS, capAtSentence, getOverviewBand } from './MeetingSummaryReducer';
import { renderNotesPromptContext, type NotesPromptContext } from './meetingNotesContext';

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
      // Timeout only — deliberately NOT routed to purpose:'extraction'. This is a prose
      // polish (a writing task), not the benchmarked structured-extraction route.
      callOpts: { timeoutMs: NOTE_CALL_TIMEOUT_MS },
      validate: (raw) => {
        const arr = (raw && typeof raw === 'object' && Array.isArray((raw as any).summary)) ? (raw as any).summary : null;
        if (!arr) return { ok: false, errors: ['missing summary array'], repaired: false };
        const lines = arr.map((s: any) => String(s || '').replace(/\s+/g, ' ').trim()).filter((s: string) => !isEmptyListPlaceholder(s)).slice(0, 5);
        // Nothing to say is the answer the prompt asks for, not a failure: a repair
        // retry (which sees neither the notes nor that rule) would push the model to
        // write filler. "empty summary array." counts as nothing (GitHub #662).
        if (lines.length === 0) return { ok: true, data: { summary: [] }, errors: [], repaired: false };
        // HARD GATE: no new significant tokens vs the grounded input.
        const offending = newSignificantTokens(lines.join(' '), grounded);
        if (offending.length > 0) return { ok: false, errors: [`introduced new tokens: ${offending.slice(0, 5).join(', ')}`], repaired: false };
        return { ok: true, data: { summary: lines }, errors: [], repaired: false };
      },
    });

    if (result.ok && result.data && result.data.summary.length > 0) return result.data.summary;
    if (result.ok) {
      console.log('[SummaryPolisher] Summary polish found nothing to say; keeping deterministic version');
      return null;
    }
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
  //
  // `notesContext` (2026-10-15): the meeting's people, the user's own notes and the
  // spelling list. It is added to the prompt AND to the gate's reference text, so a
  // name spelled from the invite or a point from the user's notes is not rejected as
  // "new". LAST TIME is deliberately left out of both: the overview must describe this
  // meeting, and a fact only last time's notes hold would fail the gate and throw the
  // whole paragraph away. Carried-over items reach the overview through the notes.
  //
  // The meeting's TITLE rides in the same reply (2026-10-18): this is the one call that
  // reads the whole meeting, so the name covers all of it rather than its opening, and
  // naming the meeting costs no request of its own. The raw title is returned as the
  // model wrote it; the caller vets it (MeetingPersistence.vetProposedTitle) and keeps
  // it even when the overview itself is rejected by the gate.
  async polishOverview(p: PolishSummaryParams & { briefs?: string[]; topics?: string[]; totalTokensEstimate?: number; notesContext?: NotesPromptContext | null }): Promise<{ overview: string | null; title: string | null }> {
    const noteCorpus = this.buildGroundedNotes(p);
    const timeline = (p.briefs || []).filter(Boolean);
    const topics = (p.topics || []).filter(Boolean);
    const groundedParts: string[] = [];
    if (timeline.length) groundedParts.push(`Chronological highlights:\n${timeline.map(b => `- ${b}`).join('\n')}`);
    if (topics.length) groundedParts.push(`Topics:\n${topics.map(t => `- ${t}`).join('\n')}`);
    if (noteCorpus) groundedParts.push(noteCorpus);
    const grounded = groundedParts.join('\n\n');
    if (!grounded.trim()) return { overview: null, title: null };
    const contextText = renderNotesPromptContext(p.notesContext, { includeLastTime: false });
    // What the "no new information" gate accepts: the notes plus that context.
    const reference = contextText ? `${grounded}\n\n${contextText}` : grounded;

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
- ${MEETING_TITLE_RULE}. Only what the notes say, like the overview.
- If the notes contain no substance, return an empty "overview" string and an empty "title".${contextText ? `
- The context below is background for naming people, organisations and the meeting correctly. Name someone only where the NOTES tie them to what happened; never say who attended from the invite. When the user's own notes are present, lead with what they marked as important.

${contextText}` : ''}

NOTES:
${grounded}`;

    const jsonShapeHint = `{ "title": "the meeting's name", "overview": "one flowing paragraph summarizing the whole meeting" }`;

    // The title is kept apart from the overview's verdict: a paragraph rejected as
    // too short says nothing about its name. A name that carries a fact the notes
    // never mention is dropped, whichever reply it came from (inventedTitleFacts).
    // The accepted reply's title wins; otherwise the first clean one is kept.
    let title: string | null = null;
    let acceptedTitle: string | null = null;
    const result = await generateStructured<{ overview: string }>({
      schemaName: 'MeetingOverview',
      systemPrompt,
      jsonShapeHint,
      userContent: grounded,
      llmHelper: this.llmHelper,
      // Timeout only — deliberately NOT routed to purpose:'extraction'. This is a prose
      // polish (a writing task), not the benchmarked structured-extraction route.
      callOpts: { timeoutMs: NOTE_CALL_TIMEOUT_MS },
      validate: (raw) => {
        const reply = raw && typeof raw === 'object' ? raw as { title?: unknown; overview?: unknown } : null;
        const proposed = typeof reply?.title === 'string' ? reply.title.replace(/\s+/g, ' ').trim() : '';
        const hasTitle = proposed !== '' && !isEmptySessionTitle(proposed);
        // Collapse only HORIZONTAL whitespace and normalize runs of blank lines to a single
        // paragraph break (\n\n) — a plain `\s+ -> ' '` collapse (used elsewhere in this file
        // for single-line fields) would flatten every paragraph break the medium/long bands
        // just asked the model for, making that instruction a no-op.
        const text = reply
          ? String(reply.overview || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
          : '';
        const keepTitle = (inventions: string[]) => {
          const clean = hasTitle && inventedTitleFacts(proposed, reference, inventions).length === 0 ? proposed : null;
          if (title === null) title = clean;
          return clean;
        };
        // An empty overview is the answer the prompt asks for when there is nothing
        // to say; accepted as is, so no repair retry pushes the model into filler.
        if (typeof reply?.overview === 'string' && isEmptyPlaceholder(text)) {
          acceptedTitle = keepTitle([]);
          return { ok: true, data: { overview: '' }, errors: [], repaired: false };
        }
        if (!text || text.length < 20) {
          keepTitle([]);
          return { ok: false, errors: ['missing/short overview'], repaired: false };
        }
        const words = text.split(/\s+/);
        // Over the band: end on the last whole sentence (2026-10-31), not mid-clause.
        const clipped = words.length > band.maxWords ? capAtSentence(words.slice(0, band.maxWords).join(' ')) : text;
        const offending = newSignificantTokens(clipped, reference);
        if (offending.length > 0) {
          keepTitle(offending);
          return { ok: false, errors: [`introduced new tokens: ${offending.slice(0, 5).join(', ')}`], repaired: false };
        }
        acceptedTitle = keepTitle([]);
        return { ok: true, data: { overview: clipped }, errors: [], repaired: false };
      },
    });

    if (result.ok && result.data && result.data.overview) return { overview: result.data.overview, title: acceptedTitle ?? title };
    if (result.ok) {
      console.log('[SummaryPolisher] Overview polish found nothing to say; keeping deterministic version');
      return { overview: null, title: acceptedTitle };
    }
    // A rejected polish means the user silently receives the mechanical deterministic
    // overview. That failure was invisible for the entire life of this feature — log it.
    console.warn(`[SummaryPolisher] Overview polish rejected, keeping deterministic version: ${result.errors.join('; ') || 'unknown'}`);
    return { overview: null, title };
  }

  // The meeting's name alone, for when the overview polish is switched off
  // (meetingSummaryLlmPolish): the overview call is the one that names the
  // meeting, so without it a small call writes only the title. With the polish
  // on this is never called — the name rides in the overview reply.
  async nameMeeting(p: PolishSummaryParams & { briefs?: string[]; topics?: string[]; notesContext?: NotesPromptContext | null }): Promise<string | null> {
    const timeline = (p.briefs || []).filter(Boolean);
    const topics = (p.topics || []).filter(Boolean);
    const noteCorpus = this.buildGroundedNotes(p);
    const groundedParts: string[] = [];
    if (timeline.length) groundedParts.push(`Chronological highlights:\n${timeline.map(b => `- ${b}`).join('\n')}`);
    if (topics.length) groundedParts.push(`Topics:\n${topics.map(t => `- ${t}`).join('\n')}`);
    if (noteCorpus) groundedParts.push(noteCorpus);
    const grounded = groundedParts.join('\n\n');
    if (!grounded.trim()) return null;
    const contextText = renderNotesPromptContext(p.notesContext, { includeLastTime: false });
    const reference = contextText ? `${grounded}\n\n${contextText}` : grounded;

    const systemPrompt = `Name this meeting from the grounded notes below.
- ${MEETING_TITLE_RULE}. Only what the notes say.
- If the notes contain no substance, return an empty "title".${contextText ? `

${contextText}` : ''}

NOTES:
${grounded}`;

    let title: string | null = null;
    await generateStructured<{ title: string }>({
      schemaName: 'MeetingTitle',
      systemPrompt,
      jsonShapeHint: `{ "title": "the meeting's name" }`,
      userContent: grounded,
      llmHelper: this.llmHelper,
      callOpts: { timeoutMs: NOTE_CALL_TIMEOUT_MS },
      validate: (raw) => {
        const rawTitle = raw && typeof raw === 'object' && typeof (raw as any).title === 'string' ? (raw as any).title as string : null;
        if (rawTitle === null) return { ok: false, errors: ['missing title'], repaired: false };
        const proposed = rawTitle.replace(/\s+/g, ' ').trim();
        // An empty title is the answer the prompt asks for: no repair retry.
        if (proposed === '' || isEmptySessionTitle(proposed)) return { ok: true, data: { title: '' }, errors: [], repaired: false };
        const invented = inventedTitleFacts(proposed, reference, []);
        if (invented.length > 0) return { ok: false, errors: [`title introduced: ${invented.join(', ')}`], repaired: false };
        title = proposed;
        return { ok: true, data: { title: proposed }, errors: [], repaired: false };
      },
    });
    return title;
  }
}

/**
 * The facts a proposed title brings in that the notes never mention. A title is
 * usually Title Case, so a capitalised word is no sign of a name here; only a
 * number or a date is judged on its own, and a name only when the same reply's
 * overview was caught inventing it (`overviewInventions`).
 */
export function inventedTitleFacts(title: string, reference: string, overviewInventions: string[]): string[] {
  const invented = new Set(overviewInventions.map((t) => t.toLowerCase()));
  const out = newSignificantTokens(title, reference).filter((tok) => {
    const lower = tok.toLowerCase();
    return /[\d%$]/.test(lower) || MONTHS.has(lower) || WEEKDAYS.has(lower);
  });
  // Every word, the first one too: a title opens on its subject ("Contoso contract
  // signing"), where newSignificantTokens never reads a capital as a name.
  for (const word of title.split(/\s+/)) {
    const lower = word.replace(/['’]s$/i, '').replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '').toLowerCase();
    if (lower && invented.has(lower) && !out.some((t) => t.toLowerCase() === lower)) out.push(word);
  }
  return out;
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
  // A full stop stays only inside a number ("31.16"); at the end of a word it is
  // punctuation, or every word that ends a source sentence ("by Thursday.") would
  // fail to match the same word in the rewrite.
  return s.toLowerCase().replace(/[^a-z0-9%$.]/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Every number in the text by its value: "$31.16" → 31.16, "1,300" → 1300.
 * Only a thousands separator is dropped, never a decimal point, so "$50.00"
 * and "$5,000" stay different numbers.
 */
function numberValues(s: string): Set<number> {
  const out = new Set<number>();
  for (const raw of s.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
    const v = Number(raw.replace(/,(?=\d{3}(?!\d))/g, ''));
    if (Number.isFinite(v)) out.add(v);
  }
  return out;
}

export function newSignificantTokens(polished: string, grounded: string): string[] {
  const groundedNorm = normalizeForCompare(grounded);
  const groundedSet = new Set(groundedNorm.split(' ').filter(Boolean));
  const groundedNumbers = numberValues(grounded);
  // Names with an apostrophe ("O'Brien") read as one word on both sides.
  const groundedJoined = new Set(normalizeForCompare(grounded.replace(/['’](?!s\b)/g, '')).split(' ').filter(Boolean));
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
    const isFirstWord = atSentenceStart;
    // Advance the flag BEFORE any `continue` below, or a skipped token leaves it stale.
    if (/[A-Za-z0-9]/.test(rawToken)) atSentenceStart = /[.!?]["'’”)]*$/.test(rawToken);
    // A possessive is its noun ("Freight's" is "Freight", not a new word "Freights"),
    // and each half of a hyphenated word is checked on its own ("24-month", "Q3-only").
    const word = rawToken.replace(/['’]s(?=[^A-Za-z0-9]*$)/, '');
    const parts = word.split(/[-–—\/]/);
    for (const part of parts) {
      // Only the edges lose punctuation, so "$31.16" keeps its decimal point.
      const raw = part.replace(/^[^A-Za-z0-9$%]+|[^A-Za-z0-9%]+$/g, '').replace(/['’"“”()]/g, '');
      if (!raw) continue;
      const lower = raw.toLowerCase();
      const lowerCore = lower.replace(/[^a-z0-9%$.]/g, '');
      if (!lowerCore || STOPWORDS.has(lowerCore)) continue;

      const isNumberLike = /\d/.test(lowerCore) || /[%$]/.test(lowerCore);
      // "week", "month", "quarter" inside a compound ("24-month") is a unit, not a date.
      const isCalendar = MONTHS.has(lowerCore) || (WEEKDAYS.has(lowerCore) && !(parts.length > 1 && /^(week|month|quarter)$/.test(lowerCore)));
      const isProperNoun = !isFirstWord && /^[A-Z][a-zA-Z'’]+$/.test(raw);

      if (!isNumberLike && !isCalendar && !isProperNoun) continue; // only police fact-shaped tokens
      if (groundedSet.has(lowerCore) || groundedJoined.has(lowerCore)) continue; // present in source → fine
      // number contained within a grounded token (e.g. "soc2" vs "soc2")
      if (isNumberLike && groundedNorm.includes(lowerCore)) continue;
      // the same number written another way ("$31.16" vs "31.16", "1,300" vs "1300")
      const values = [...numberValues(raw)];
      if (isNumberLike && values.length > 0 && values.every((v) => groundedNumbers.has(v))) continue;
      if (seen.has(lowerCore)) continue;
      seen.add(lowerCore);
      offending.push(raw);
    }
  }
  return offending;
}
