// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { extractCanonicalTerms } from "./skillOntology";
import { HARD_GATE_CATEGORIES } from "./types";
import { REQUIREMENT_CATEGORIES } from "./types";
import { callWithTimeout } from "../llmUtils";
import { extractJSONArray } from "../llmUtils";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
// premium/electron/knowledge/roleInsight/RequirementExtractor.ts
var EXTRACTION_TIMEOUT_MS = 6e4;
var MAX_JD_CHARS = 24e3;
var BOILERPLATE_PATTERNS = [
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
    /^\s*(share|save|print|email)\s+(this\s+)?job\s*$/i
];
function isBoilerplate(line) {
    const t = line.trim();
    if (t.length < 8)
        return true;
    if (t.length > 400)
        return true;
    return BOILERPLATE_PATTERNS.some((re) => re.test(t));
}
function locateQuote(source, quote) {
    if (!source || !quote)
        return null;
    const q = quote.trim();
    if (q.length < 6)
        return null;
    const exact = source.indexOf(q);
    if (exact >= 0)
        return { start: exact, end: exact + q.length };
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    try {
        const m = new RegExp(escaped, "i").exec(source);
        if (m && m.index >= 0)
            return { start: m.index, end: m.index + m[0].length };
    }
    catch {
    }
    const tokens = q.split(/\s+/).filter((t) => t.replace(/\W/g, "").length > 3);
    if (tokens.length >= 2) {
        const lower = source.toLowerCase();
        const first = tokens[0].replace(/[^\w]/g, "").toLowerCase();
        const last = tokens[tokens.length - 1].replace(/[^\w]/g, "").toLowerCase();
        const middle = tokens.slice(1, -1).map((t) => t.replace(/[^\w]/g, "").toLowerCase()).filter(Boolean);
        const maxSpan = q.length * 1.6 + 40;
        let best = null;
        for (let startIdx = lower.indexOf(first); startIdx >= 0; startIdx = lower.indexOf(first, startIdx + 1)) {
            const endIdx = lower.indexOf(last, startIdx + first.length);
            if (endIdx <= startIdx)
                continue;
            const end = endIdx + last.length;
            if (end - startIdx > maxSpan)
                continue;
            const window = lower.slice(startIdx, end);
            const hits = middle.filter((t) => window.includes(t)).length;
            if (middle.length > 0 && hits < Math.ceil(middle.length / 2))
                continue;
            const sizeDelta = Math.abs(end - startIdx - q.length);
            if (!best || hits > best.hits || hits === best.hits && sizeDelta < best.sizeDelta) {
                best = { start: startIdx, end, hits, sizeDelta };
            }
        }
        if (best)
            return { start: best.start, end: best.end };
    }
    return null;
}
function sectionAt(source, offset) {
    if (offset < 0 || offset > source.length)
        return void 0;
    const before = source.slice(0, offset);
    const lines = before.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line || line.length > 80)
            continue;
        const isHeading = /^#{1,6}\s+/.test(line) || // markdown
            /^[A-Z][A-Za-z0-9 &/'’-]{2,60}:?$/.test(line) && !/[.!?]$/.test(line);
        if (isHeading) {
            return line.replace(/^#{1,6}\s+/, "").replace(/:$/, "").trim();
        }
    }
    return void 0;
}
var MANDATORY_MARKERS = /\b(must have|must be|required|requirement|minimum qualification|basic qualification|you (will )?need|non-?negotiable|mandatory|essential)\b/i;
var PREFERRED_MARKERS = /\b(nice to have|preferred|bonus|plus|a plus|desirable|ideal(ly)?|would be great|not required|advantageous)\b/i;
var PREFERRED_SECTIONS = /(nice[- ]to[- ]have|preferred|bonus|desirable|good to have|pluses)/i;
var MANDATORY_SECTIONS = /(minimum|basic|required|requirements|must[- ]have|qualifications|what you.ll need|who you are)/i;
function inferMandatory(text, section) {
    if (PREFERRED_MARKERS.test(text))
        return false;
    if (MANDATORY_MARKERS.test(text))
        return true;
    if (section && PREFERRED_SECTIONS.test(section))
        return false;
    if (section && MANDATORY_SECTIONS.test(section))
        return true;
    return false;
}
function inferPreferred(text, section) {
    if (PREFERRED_MARKERS.test(text))
        return true;
    if (section && PREFERRED_SECTIONS.test(section))
        return true;
    return false;
}
var CATEGORY_HINTS = [
    { re: /\b(work authorization|authorized to work|visa|sponsorship|right to work|work permit|citizen(ship)?|green card|eligib(le|ility) to work)\b/i, category: "authorization" },
    { re: /\b(security clearance|clearance|ts\/sci|secret clearance|public trust)\b/i, category: "clearance" },
    { re: /\b(on-?site|onsite|hybrid|remote|relocat\w+|based in|located in|commut\w+|office \d+ days)\b/i, category: "location" },
    { re: /\b(travel|shift|weekend|overnight|on-?call rotation|schedule|hours per week|overtime)\b/i, category: "logistics" },
    { re: /\b(bachelor|master|phd|degree|b\.?s\.?|m\.?s\.?|mba|diploma|university|graduat\w+)\b/i, category: "education" },
    { re: /\b(certif\w+|licen[cs]\w+|accredit\w+|cpa|pmp|cissp|aws certified|scrum master cert)\b/i, category: "certification" },
    { re: /\b(manage|lead|mentor|coach|direct reports?|hiring|people leader|team of)\b/i, category: "leadership" },
    { re: /\b(communicat\w+|present\w+|stakeholder|writing|written|verbal|collaborat\w+|interpersonal)\b/i, category: "communication" },
    { re: /\b(\d+\+?\s*(years|yrs)|seniority|senior|staff|principal|track record)\b/i, category: "experience" },
    { re: /\b(industry|domain|sector|fintech|healthcare|e-?commerce|regulat\w+|compliance|hipaa|gdpr|sox)\b/i, category: "domain" },
    { re: /\b(language|fluent|proficient in (english|spanish|french|german|mandarin|japanese))\b/i, category: "communication" }
];
function inferCategory(text, section) {
    for (const { re, category } of CATEGORY_HINTS) {
        if (re.test(text))
            return category;
    }
    if (section && /(responsibilit|what you.ll do|the role|day to day|about the job)/i.test(section)) {
        return "core_responsibility";
    }
    if (/^(design|build|develop|own|drive|deliver|implement|maintain|architect|create|manage|partner|collaborate|scale|operate)\b/i.test(text.trim())) {
        return "core_responsibility";
    }
    if (extractCanonicalTerms(text).length > 0)
        return "technical_skill";
    return "functional_skill";
}
function inferPriority(args) {
    const { text, mandatory, preferred, category, passageCount, responsibilityLinks } = args;
    if (preferred)
        return "preferred";
    if (category === "preferred")
        return "preferred";
    if (HARD_GATE_CATEGORIES.has(category)) {
        return mandatory ? "critical" : "important";
    }
    let score = 0;
    if (mandatory)
        score += 3;
    if (category === "core_responsibility")
        score += 2;
    if (responsibilityLinks >= 2)
        score += 2;
    else if (responsibilityLinks === 1)
        score += 1;
    if (passageCount >= 3)
        score += 2;
    else if (passageCount === 2)
        score += 1;
    if (/\b(deep|extensive|expert|strong|proven|significant|substantial)\b/i.test(text))
        score += 1;
    if (/\b(exposure|awareness|some|basic|familiar)\b/i.test(text))
        score -= 1;
    if (score >= 5)
        return "critical";
    if (score >= 2)
        return "important";
    return "supporting";
}
function truncateAtBoundary(text, max) {
    if (text.length <= max)
        return { text, truncated: false };
    const head = text.slice(0, max);
    const lastBreak = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"));
    return { text: lastBreak > max * 0.6 ? head.slice(0, lastBreak) : head, truncated: true };
}
function buildPrompt(jdText) {
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
- "category": one of ${REQUIREMENT_CATEGORIES.join(" | ")}
- "mandatory": true if stated as required/minimum, false if preferred/optional
- "hard_gate": true ONLY for eligibility conditions \u2014 work authorization, security clearance, physical location or relocation, required licence, mandatory travel or shift, required language. Skills are NEVER hard gates.
- "central": true if other listed responsibilities depend on this one
- "confidence": 0.0\u20131.0, how certain you are this is a real stated requirement

JOB DESCRIPTION:
"""
${jdText}
"""

Return ONLY the JSON array.`;
}
function coerceCategory(raw, text, section) {
    const s = String(raw ?? "").toLowerCase().trim();
    if (REQUIREMENT_CATEGORIES.includes(s))
        return s;
    return inferCategory(text, section);
}
function coerceConfidence(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n))
        return 0.5;
    return Math.min(1, Math.max(0, n));
}
async function extractRequirements(jdRawText, generateContentFn) {
    const { text: promptText, truncated } = truncateAtBoundary(jdRawText, MAX_JD_CHARS);
    if (generateContentFn) {
        try {
            const raw = await callWithTimeout(() => generateContentFn([{ text: buildPrompt(promptText) }]), EXTRACTION_TIMEOUT_MS);
            const parsed = extractJSONArray(raw);
            const built = buildFromLlm(parsed, jdRawText);
            if (built.requirements.length > 0) {
                return { ...built, mode: "llm", truncated };
            }
            console.warn("[RoleInsight/Extractor] LLM returned no usable requirements; falling back to heuristic.");
        }
        catch (e) {
            console.warn("[RoleInsight/Extractor] LLM extraction failed, falling back to heuristic:", e?.message);
        }
    }
    return { ...heuristicExtract(jdRawText), mode: "heuristic", truncated };
}
function buildFromLlm(items, source) {
    const out = [];
    let unanchored = 0;
    let ordinal = 0;
    for (const item of Array.isArray(items) ? items : []) {
        const quote = String(item?.quote ?? "").trim();
        if (!quote || isBoilerplate(quote))
            continue;
        const span = locateQuote(source, quote);
        if (!span)
            unanchored++;
        const section = span ? sectionAt(source, span.start) : void 0;
        const additional = Array.isArray(item?.additional_quotes) ? item.additional_quotes.map((q) => String(q ?? "").trim()).filter((q) => q.length > 0 && !isBoilerplate(q)) : [];
        const normalized = String(item?.normalized ?? "").trim() || quote;
        const category = coerceCategory(item?.category, quote, section);
        const preferred = inferPreferred(quote, section);
        const mandatory = preferred ? false : item?.mandatory === true || inferMandatory(quote, section);
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
                text: quote,
                section,
                mandatory,
                preferred,
                category,
                passageCount: 1 + additional.length,
                responsibilityLinks: item?.central === true ? 2 : 0
            }),
            hardGate,
            explicit: true,
            mandatory,
            extractionConfidence: coerceConfidence(item?.confidence),
            supportingPassages: additional,
            excluded: false,
            ordinal: ordinal++
        });
    }
    return { requirements: out, unanchoredCount: unanchored };
}
function heuristicExtract(source) {
    const out = [];
    const lines = source.split("\n");
    let offset = 0;
    let ordinal = 0;
    let currentSection;
    const seen = /* @__PURE__ */ new Set();
    for (const rawLine of lines) {
        const lineStart = offset;
        offset += rawLine.length + 1;
        const line = rawLine.trim();
        if (!line)
            continue;
        const headingMatch = /^#{1,6}\s+(.*)$/.exec(line) ?? null;
        if (headingMatch) {
            currentSection = headingMatch[1].trim();
            continue;
        }
        if (line.length <= 80 && /^[A-Z][A-Za-z0-9 &/'’-]{2,60}:?$/.test(line) && !/[.!?]$/.test(line)) {
            currentSection = line.replace(/:$/, "").trim();
            continue;
        }
        const bullet = /^\s*([-*•·‣▪●]|\d+[.)])\s+(.*)$/.exec(rawLine);
        const body = bullet ? bullet[2].trim() : line;
        const isRequirementShaped = bullet || MANDATORY_MARKERS.test(body) || currentSection !== void 0 && (MANDATORY_SECTIONS.test(currentSection) || PREFERRED_SECTIONS.test(currentSection));
        if (!isRequirementShaped)
            continue;
        if (isBoilerplate(body))
            continue;
        const key = body.toLowerCase().replace(/\W+/g, " ").trim();
        if (seen.has(key))
            continue;
        seen.add(key);
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
                text: body,
                section: currentSection,
                mandatory,
                preferred,
                category,
                passageCount: 1,
                responsibilityLinks: 0
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
            ordinal: ordinal++
        });
    }
    return { requirements: out, unanchoredCount: 0 };
}
export { extractRequirements, heuristicExtract, inferCategory, inferMandatory, inferPreferred, inferPriority, isBoilerplate, locateQuote, sectionAt };
