// premium/electron/knowledge/roleInsight/RequirementExtractor.ts
//
// JD raw text → structured requirements, each anchored to a character span in
// the source so the UI can prove the quote rather than re-assert it.
//
// The anchoring is the point. An LLM asked for "the exact wording" will often
// return a near-quote (normalized whitespace, dropped bullet glyph, a trimmed
// trailing clause). Accepting that text at face value would make "every
// requirement links back to exact JD evidence" unverifiable. So every returned
// quote is RELOCATED against raw_text — exact first, then whitespace-insensitive,
// then a bounded token-window search — and the requirement carries the span that
// was actually found. A quote that cannot be relocated keeps its text but gets
// a null span, and the UI drops the "locate in JD" affordance for it rather
// than pointing at the wrong offset.
//
// A heuristic, LLM-free extractor backs this up, mirroring the codebase's
// existing HeuristicExtractor policy: an unavailable extraction LLM must
// degrade to a usable-but-labelled result, not to nothing.

import { extractJSONArray, callWithTimeout } from '../llmUtils';
import {
    RoleRequirement, RequirementCategory, RequirementPriority,
    REQUIREMENT_CATEGORIES, REQUIREMENT_PRIORITIES, HARD_GATE_CATEGORIES,
} from './types';
import { extractCanonicalTerms } from './skillOntology';

const EXTRACTION_TIMEOUT_MS = 60_000;
/** Bound the prompt. Longer JDs are truncated at a section boundary, and the
 *  truncation is reported so the UI can say the analysis saw a partial JD. */
const MAX_JD_CHARS = 24_000;

export interface ExtractionResult {
    requirements: Omit<RoleRequirement, 'analysisId' | 'id'>[];
    mode: 'llm' | 'heuristic';
    truncated: boolean;
    /** Quotes the model returned that could not be located in the source. */
    unanchoredCount: number;
}

// ── Boilerplate suppression ───────────────────────────────────────────────────
//
// "Avoid treating every absent noun in the JD as a gap." These patterns are
// matched against a candidate requirement line; a hit drops the line entirely.

const BOILERPLATE_PATTERNS: RegExp[] = [
    /\bequal opportunity\b/i,
    /\bwithout regard to\b/i,
    /\bregardless of race\b/i,
    /\baffirmative action\b/i,
    /\breasonable accommodation\b/i,
    /\bE-Verify\b/i,
    /\bbackground check\b/i,
    /\bdrug (screen|test)\b/i,
    /\bwe (offer|provide)\b.*\b(insurance|401k|pto|vacation|benefits|equity|stipend)\b/i,
    /\b(health|dental|vision|life) insurance\b/i,
    /\b401\s?\(?k\)?\b/i,
    /\bunlimited (pto|vacation)\b/i,
    /\bparental leave\b/i,
    /\bcompetitive (salary|compensation|pay)\b/i,
    /\bstock options?\b/i,
    /\bour (mission|values|culture) is\b/i,
    /\bwe (believe|value|celebrate|embrace)\b/i,
    /\babout (us|the company|our team)\b/i,
    /\bjoin (us|our team)\b/i,
    /\bwhy (work|join)\b/i,
    /\bapply (now|today)\b/i,
    /\bsubmit your (application|resume)\b/i,
    /\bfollow us on\b/i,
    /\b(privacy policy|cookie|terms of service)\b/i,
    // Scraped-page navigation debris
    /^(home|careers?|jobs?|search|menu|sign in|log ?in|back to)$/i,
    /^\s*(share|save|print|email)\s+(this\s+)?job\s*$/i,
];

export function isBoilerplate(line: string): boolean {
    const t = line.trim();
    if (t.length < 8) return true;
    if (t.length > 400) return true; // a paragraph, not a requirement
    return BOILERPLATE_PATTERNS.some(re => re.test(t));
}

// ── Offset relocation ─────────────────────────────────────────────────────────

/**
 * Locate `quote` inside `source`, tolerating the whitespace and punctuation
 * drift an LLM introduces when asked to reproduce text verbatim.
 * Returns null when no confident location exists — callers must treat that as
 * "unanchored", never as offset 0.
 */
export function locateQuote(source: string, quote: string): { start: number; end: number } | null {
    if (!source || !quote) return null;
    const q = quote.trim();
    if (q.length < 6) return null;

    // 1. Exact.
    const exact = source.indexOf(q);
    if (exact >= 0) return { start: exact, end: exact + q.length };

    // 2. Whitespace-insensitive. Build a regex from the quote where every run of
    //    whitespace matches any whitespace run, and escape everything else.
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    try {
        const m = new RegExp(escaped, 'i').exec(source);
        if (m && m.index >= 0) return { start: m.index, end: m.index + m[0].length };
    } catch { /* pathological quote — fall through */ }

    // 3. Bounded token-window search.
    //
    // F5 (code review 2026-08-05): the old version anchored on the FIRST
    // occurrence of the quote's first token anywhere in the document. A quote
    // from "Minimum qualifications" whose leading token also appeared under an
    // earlier "Nice to have" heading relocated there, sectionAt reported the
    // wrong heading, and a REQUIRED qualification was silently demoted to
    // preferred — dropped from coverage, exposures and clarifications. Now
    // every occurrence of the first token is considered a candidate, each must
    // contain a MAJORITY of the quote's distinctive tokens within its span,
    // and the best-evidenced candidate wins. Anchoring to the wrong place is
    // strictly worse than not anchoring, so no qualifying candidate → null.
    const tokens = q.split(/\s+/).filter(t => t.replace(/\W/g, '').length > 3);
    if (tokens.length >= 2) {
        const lower = source.toLowerCase();
        const first = tokens[0].replace(/[^\w]/g, '').toLowerCase();
        const last = tokens[tokens.length - 1].replace(/[^\w]/g, '').toLowerCase();
        const middle = tokens.slice(1, -1).map(t => t.replace(/[^\w]/g, '').toLowerCase()).filter(Boolean);
        const maxSpan = q.length * 1.6 + 40;

        let best: { start: number; end: number; hits: number; sizeDelta: number } | null = null;
        for (let startIdx = lower.indexOf(first); startIdx >= 0; startIdx = lower.indexOf(first, startIdx + 1)) {
            const endIdx = lower.indexOf(last, startIdx + first.length);
            if (endIdx <= startIdx) continue;
            const end = endIdx + last.length;
            if (end - startIdx > maxSpan) continue;

            const window = lower.slice(startIdx, end);
            const hits = middle.filter(t => window.includes(t)).length;
            // First and last already match; the middle must carry its weight.
            if (middle.length > 0 && hits < Math.ceil(middle.length / 2)) continue;

            const sizeDelta = Math.abs((end - startIdx) - q.length);
            if (!best || hits > best.hits || (hits === best.hits && sizeDelta < best.sizeDelta)) {
                best = { start: startIdx, end, hits, sizeDelta };
            }
        }
        if (best) return { start: best.start, end: best.end };
    }

    return null;
}

/** The JD heading a character offset falls under, when the document has headings. */
export function sectionAt(source: string, offset: number): string | undefined {
    if (offset < 0 || offset > source.length) return undefined;
    const before = source.slice(0, offset);
    const lines = before.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line || line.length > 80) continue;
        const isHeading =
            /^#{1,6}\s+/.test(line) ||                      // markdown
            /^[A-Z][A-Za-z0-9 &/'’-]{2,60}:?$/.test(line) && !/[.!?]$/.test(line);
        if (isHeading) {
            return line.replace(/^#{1,6}\s+/, '').replace(/:$/, '').trim();
        }
    }
    return undefined;
}

// ── Priority / category inference (deterministic, LLM-independent) ────────────

const MANDATORY_MARKERS = /\b(must have|must be|required|requirement|minimum qualification|basic qualification|you (will )?need|non-?negotiable|mandatory|essential)\b/i;
const PREFERRED_MARKERS = /\b(nice to have|preferred|bonus|plus|a plus|desirable|ideal(ly)?|would be great|not required|advantageous)\b/i;
const PREFERRED_SECTIONS = /(nice[- ]to[- ]have|preferred|bonus|desirable|good to have|pluses)/i;
const MANDATORY_SECTIONS = /(minimum|basic|required|requirements|must[- ]have|qualifications|what you.ll need|who you are)/i;

export function inferMandatory(text: string, section?: string): boolean {
    if (PREFERRED_MARKERS.test(text)) return false;
    if (MANDATORY_MARKERS.test(text)) return true;
    if (section && PREFERRED_SECTIONS.test(section)) return false;
    if (section && MANDATORY_SECTIONS.test(section)) return true;
    return false;
}

export function inferPreferred(text: string, section?: string): boolean {
    if (PREFERRED_MARKERS.test(text)) return true;
    if (section && PREFERRED_SECTIONS.test(section)) return true;
    return false;
}

const CATEGORY_HINTS: Array<{ re: RegExp; category: RequirementCategory }> = [
    { re: /\b(work authorization|authorized to work|visa|sponsorship|right to work|work permit|citizen(ship)?|green card|eligib(le|ility) to work)\b/i, category: 'authorization' },
    { re: /\b(security clearance|clearance|ts\/sci|secret clearance|public trust)\b/i, category: 'clearance' },
    { re: /\b(on-?site|onsite|hybrid|remote|relocat\w+|based in|located in|commut\w+|office \d+ days)\b/i, category: 'location' },
    { re: /\b(travel|shift|weekend|overnight|on-?call rotation|schedule|hours per week|overtime)\b/i, category: 'logistics' },
    { re: /\b(bachelor|master|phd|degree|b\.?s\.?|m\.?s\.?|mba|diploma|university|graduat\w+)\b/i, category: 'education' },
    { re: /\b(certif\w+|licen[cs]\w+|accredit\w+|cpa|pmp|cissp|aws certified|scrum master cert)\b/i, category: 'certification' },
    { re: /\b(manage|lead|mentor|coach|direct reports?|hiring|people leader|team of)\b/i, category: 'leadership' },
    { re: /\b(communicat\w+|present\w+|stakeholder|writing|written|verbal|collaborat\w+|interpersonal)\b/i, category: 'communication' },
    { re: /\b(\d+\+?\s*(years|yrs)|seniority|senior|staff|principal|track record)\b/i, category: 'experience' },
    { re: /\b(industry|domain|sector|fintech|healthcare|e-?commerce|regulat\w+|compliance|hipaa|gdpr|sox)\b/i, category: 'domain' },
    { re: /\b(language|fluent|proficient in (english|spanish|french|german|mandarin|japanese))\b/i, category: 'communication' },
];

export function inferCategory(text: string, section?: string): RequirementCategory {
    for (const { re, category } of CATEGORY_HINTS) {
        if (re.test(text)) return category;
    }
    // A responsibility reads as an action the person performs; a skill reads as
    // a thing they possess. Section headings are the strongest signal available.
    if (section && /(responsibilit|what you.ll do|the role|day to day|about the job)/i.test(section)) {
        return 'core_responsibility';
    }
    if (/^(design|build|develop|own|drive|deliver|implement|maintain|architect|create|manage|partner|collaborate|scale|operate)\b/i.test(text.trim())) {
        return 'core_responsibility';
    }
    if (extractCanonicalTerms(text).length > 0) return 'technical_skill';
    return 'functional_skill';
}

/**
 * Priority is deliberately NOT keyword frequency. It weighs explicit mandatory
 * language, section placement, whether other responsibilities depend on the
 * item, and repetition across meaningful sections.
 */
export function inferPriority(args: {
    text: string;
    section?: string;
    mandatory: boolean;
    preferred: boolean;
    category: RequirementCategory;
    /** How many distinct JD passages were consolidated into this requirement. */
    passageCount: number;
    /** How many core responsibilities reference this requirement's canonical terms. */
    responsibilityLinks: number;
}): RequirementPriority {
    const { text, mandatory, preferred, category, passageCount, responsibilityLinks } = args;
    if (preferred) return 'preferred';
    if (category === 'preferred') return 'preferred';

    // Hard gates are never "supporting" — an unmet one is decisive regardless of
    // how the JD phrases it.
    if (HARD_GATE_CATEGORIES.has(category)) {
        return mandatory ? 'critical' : 'important';
    }

    let score = 0;
    if (mandatory) score += 3;
    if (category === 'core_responsibility') score += 2;
    if (responsibilityLinks >= 2) score += 2;
    else if (responsibilityLinks === 1) score += 1;
    if (passageCount >= 3) score += 2;
    else if (passageCount === 2) score += 1;
    if (/\b(deep|extensive|expert|strong|proven|significant|substantial)\b/i.test(text)) score += 1;
    if (/\b(exposure|awareness|some|basic|familiar)\b/i.test(text)) score -= 1;

    if (score >= 5) return 'critical';
    if (score >= 2) return 'important';
    return 'supporting';
}

// ── LLM extraction ────────────────────────────────────────────────────────────

function truncateAtBoundary(text: string, max: number): { text: string; truncated: boolean } {
    if (text.length <= max) return { text, truncated: false };
    const head = text.slice(0, max);
    const lastBreak = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('\n'));
    return { text: lastBreak > max * 0.6 ? head.slice(0, lastBreak) : head, truncated: true };
}

function buildPrompt(jdText: string): string {
    return `You are analysing a job description to produce a structured requirement list for a candidate who has ALREADY been invited to interview.

Return a JSON array. Each element describes ONE requirement the employer states or clearly implies about the candidate.

CRITICAL RULES:
1. "quote" MUST be copied CHARACTER-FOR-CHARACTER from the job description below. Do not fix typos, do not normalise whitespace, do not merge lines, do not paraphrase. If you cannot copy it exactly, omit the requirement.
2. Do NOT emit employer branding, benefits, perks, compensation, equal-opportunity or legal boilerplate, company values, application instructions, or page navigation text. Those are not candidate requirements.
3. Do NOT invent requirements that are not in the text.
4. Consolidate genuine duplicates into ONE element and list every supporting quote in "additional_quotes".
5. Separate what the employer REQUIRES from what it PREFERS. Use the document's own language ("must have", "minimum qualifications" vs "nice to have", "bonus").

Fields per element:
- "quote": exact source text (see rule 1)
- "additional_quotes": array of other exact quotes supporting the same requirement (may be empty)
- "normalized": one plain sentence stating what the candidate must be able to do or have
- "category": one of ${REQUIREMENT_CATEGORIES.join(' | ')}
- "mandatory": true if stated as required/minimum, false if preferred/optional
- "hard_gate": true ONLY for eligibility conditions — work authorization, security clearance, physical location or relocation, required licence, mandatory travel or shift, required language. Skills are NEVER hard gates.
- "central": true if other listed responsibilities depend on this one
- "confidence": 0.0–1.0, how certain you are this is a real stated requirement

JOB DESCRIPTION:
"""
${jdText}
"""

Return ONLY the JSON array.`;
}

function coerceCategory(raw: unknown, text: string, section?: string): RequirementCategory {
    const s = String(raw ?? '').toLowerCase().trim();
    if ((REQUIREMENT_CATEGORIES as readonly string[]).includes(s)) return s as RequirementCategory;
    return inferCategory(text, section);
}

function coerceConfidence(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0.5;
    return Math.min(1, Math.max(0, n));
}

export async function extractRequirements(
    jdRawText: string,
    generateContentFn: ((contents: any[]) => Promise<string>) | null,
): Promise<ExtractionResult> {
    const { text: promptText, truncated } = truncateAtBoundary(jdRawText, MAX_JD_CHARS);

    if (generateContentFn) {
        try {
            const raw = await callWithTimeout(
                () => generateContentFn([{ text: buildPrompt(promptText) }]),
                EXTRACTION_TIMEOUT_MS,
            );
            const parsed = extractJSONArray<any>(raw);
            const built = buildFromLlm(parsed, jdRawText);
            if (built.requirements.length > 0) {
                return { ...built, mode: 'llm', truncated };
            }
            console.warn('[RoleInsight/Extractor] LLM returned no usable requirements; falling back to heuristic.');
        } catch (e: any) {
            console.warn('[RoleInsight/Extractor] LLM extraction failed, falling back to heuristic:', e?.message);
        }
    }

    return { ...heuristicExtract(jdRawText), mode: 'heuristic', truncated };
}

function buildFromLlm(items: any[], source: string): Omit<ExtractionResult, 'mode' | 'truncated'> {
    const out: Omit<RoleRequirement, 'analysisId' | 'id'>[] = [];
    let unanchored = 0;
    let ordinal = 0;

    for (const item of Array.isArray(items) ? items : []) {
        const quote = String(item?.quote ?? '').trim();
        if (!quote || isBoilerplate(quote)) continue;

        const span = locateQuote(source, quote);
        if (!span) unanchored++;
        const section = span ? sectionAt(source, span.start) : undefined;

        const additional: string[] = Array.isArray(item?.additional_quotes)
            ? item.additional_quotes.map((q: any) => String(q ?? '').trim()).filter((q: string) => q.length > 0 && !isBoilerplate(q))
            : [];

        const normalized = String(item?.normalized ?? '').trim() || quote;
        const category = coerceCategory(item?.category, quote, section);
        // The document's own language outranks the model's boolean: a line that
        // literally says "nice to have" is preferred even if the model marked it
        // mandatory. Category decides hard-gate status regardless of `hard_gate`,
        // because a model that labels "5 years of Python" a gate must not be able
        // to promote a skill out of the coverage calculation.
        const preferred = inferPreferred(quote, section);
        const mandatory = preferred ? false
            : (item?.mandatory === true || inferMandatory(quote, section));
        const hardGate = HARD_GATE_CATEGORIES.has(category);

        out.push({
            originalText: quote,
            normalizedText: normalized,
            canonicalTerms: extractCanonicalTerms(`${quote} ${normalized}`),
            sourceSection: section,
            sourceCharStart: span ? span.start : null,
            sourceCharEnd: span ? span.end : null,
            category,
            // Priority is finalized in RequirementNormalizer once consolidation
            // and responsibility linkage are known; this is the provisional pass.
            priority: inferPriority({
                text: quote, section, mandatory, preferred, category,
                passageCount: 1 + additional.length,
                responsibilityLinks: item?.central === true ? 2 : 0,
            }),
            hardGate,
            explicit: true,
            mandatory,
            extractionConfidence: coerceConfidence(item?.confidence),
            supportingPassages: additional,
            excluded: false,
            ordinal: ordinal++,
        });
    }

    return { requirements: out, unanchoredCount: unanchored };
}

// ── Heuristic extraction (LLM-free fallback) ──────────────────────────────────

/**
 * Deterministic bullet/line extraction. Deliberately conservative: it prefers
 * missing a requirement to inventing one, because a fabricated requirement
 * produces a fabricated gap.
 */
export function heuristicExtract(source: string): Omit<ExtractionResult, 'mode' | 'truncated'> {
    const out: Omit<RoleRequirement, 'analysisId' | 'id'>[] = [];
    const lines = source.split('\n');
    let offset = 0;
    let ordinal = 0;
    let currentSection: string | undefined;
    const seen = new Set<string>();

    for (const rawLine of lines) {
        const lineStart = offset;
        offset += rawLine.length + 1; // +1 for the consumed '\n'

        const line = rawLine.trim();
        if (!line) continue;

        // Heading?
        const headingMatch = /^#{1,6}\s+(.*)$/.exec(line) ?? null;
        if (headingMatch) { currentSection = headingMatch[1].trim(); continue; }
        if (line.length <= 80 && /^[A-Z][A-Za-z0-9 &/'’-]{2,60}:?$/.test(line) && !/[.!?]$/.test(line)) {
            currentSection = line.replace(/:$/, '').trim();
            continue;
        }

        // Bullet or a requirement-shaped sentence.
        const bullet = /^\s*([-*•·‣▪●]|\d+[.)])\s+(.*)$/.exec(rawLine);
        const body = bullet ? bullet[2].trim() : line;
        const isRequirementShaped = bullet
            || MANDATORY_MARKERS.test(body)
            || (currentSection !== undefined && (MANDATORY_SECTIONS.test(currentSection) || PREFERRED_SECTIONS.test(currentSection)));
        if (!isRequirementShaped) continue;
        if (isBoilerplate(body)) continue;

        const key = body.toLowerCase().replace(/\W+/g, ' ').trim();
        if (seen.has(key)) continue;
        seen.add(key);

        // Anchor to the body's real position within the line, not the line start.
        const bodyOffsetInLine = rawLine.indexOf(body);
        const start = bodyOffsetInLine >= 0 ? lineStart + bodyOffsetInLine : lineStart;

        const category = inferCategory(body, currentSection);
        const preferred = inferPreferred(body, currentSection);
        const mandatory = !preferred && inferMandatory(body, currentSection);

        out.push({
            originalText: body,
            normalizedText: body,
            canonicalTerms: extractCanonicalTerms(body),
            sourceSection: currentSection,
            sourceCharStart: start,
            sourceCharEnd: start + body.length,
            category,
            priority: inferPriority({
                text: body, section: currentSection, mandatory, preferred, category,
                passageCount: 1, responsibilityLinks: 0,
            }),
            hardGate: HARD_GATE_CATEGORIES.has(category),
            // Heuristic extraction cannot distinguish a stated requirement from
            // an inferred one, so nothing it produces claims to be explicit.
            explicit: false,
            mandatory,
            // Lower ceiling than the LLM path: this is pattern matching, and the
            // confidence number feeds evidence-confidence downstream.
            extractionConfidence: bullet ? 0.6 : 0.45,
            supportingPassages: [],
            excluded: false,
            ordinal: ordinal++,
        });
    }

    return { requirements: out, unanchoredCount: 0 };
}
