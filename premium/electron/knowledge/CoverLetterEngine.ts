// electron/knowledge/CoverLetterEngine.ts
// Generates tailored cover letters using the same resume + JD (+ optional company dossier)
// inputs as the Negotiation Engine. Output is broken into small, copy-able prose pieces so the
// renderer can present it as a single continuous letter card while still exposing each piece
// individually for future editor-mode features.
//
// Voice layer: the /humanize skill lives in electron/llm/humanLikeness.ts and exports a
// prompt directive (HUMANIZE_DIRECTIVE) plus a deterministic final-pass rewriter
// (humanizeSpokenAnswer). We wire BOTH:
//   1. Append HUMANIZE_DIRECTIVE to the prompt — primary prevention (up-front steer).
//   2. Run humanizeSpokenAnswer on every prose piece the LLM emits — defence in depth,
//      catches any filler that slips past the directive.

import { KnowledgeDocument, StructuredResume, StructuredJD, CompanyDossier } from './types';
import { extractJsonObject } from './jsonExtract';
import { flattenSkills } from './skillsUtil';
import { HUMANIZE_DIRECTIVE, humanizeSpokenAnswer } from '../../../electron/llm/humanLikeness';

export interface CoverLetter {
    // Formal business-letter furniture (rendered as a multi-line header above the salutation)
    sender_block: string[];     // [name, email?, phone?, location?]
    date: string;               // "January 15, 2026"
    recipient_block: string[];  // [recipient name, title?, company, location?]
    // Prose body
    greeting: string;           // "Dear Hiring Manager," or "Dear [Company] Team,"
    opening_hook: string;       // 1 sentence naming the role + the one reason for fit
    body_paragraphs: string[];  // 1-2 paragraphs: relevant experience, achievements, why-this-company
    closing: string;            // appreciation + next-step intent
    signature: string[];        // ["Sincerely,", "Name"]
    // Pre-joined plain-text version, mirrors the visual order (sender, date, recipient,
    // blank, greeting, opening, body, closing, signature)
    full_text: string;
}

/**
 * Generate a tailored cover letter using LLM.
 *
 * Mirrors generateNegotiationScript's input contract and error path. The dossier is
 * optional — when present, its hiring_strategy and core_values are folded into the prompt
 * so the letter can reference what the company explicitly values (best-effort, may be null
 * if the user hasn't run Company Intel yet).
 *
 * Voice: see HUMANIZE_DIRECTIVE — first-person, plain, no corporate filler.
 */
export async function generateCoverLetter(
    resumeDoc: KnowledgeDocument,
    jdDoc: KnowledgeDocument | null,
    dossier: CompanyDossier | null,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<CoverLetter | null> {
    const resume = resumeDoc.structured_data as StructuredResume;
    // Always trust the resume's identity.name field. Trim defensively so empty
    // whitespace from a partial extraction doesn't produce a blank sign-off line.
    // Fallback to 'the candidate' only when identity itself is missing.
    const rawName = (resume.identity?.name ?? '').trim();
    const name = rawName.length > 0 ? rawName : 'the candidate';

    // ── Resume highlights — same shape as generateNegotiationScript ──
    const topExperience = resume.experience?.slice(0, 3).map(e =>
        `${e.role} at ${e.company} (${e.bullets?.slice(0, 2).join('; ')})`
    ).join('\n') || 'No experience data';

    const topSkills = (resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 8).join(', ') || 'Not specified';

    // ── JD context ──
    let jdContext = '';
    let jdCompany: string | undefined;
    if (jdDoc) {
        const jd = jdDoc.structured_data as StructuredJD;
        jdCompany = jd.company;
        jdContext = `Target Role: ${jd.title} at ${jd.company} (${jd.level || 'mid'}-level, ${jd.location || 'unspecified location'})`;
        if (jd.requirements?.length) {
            jdContext += `\nKey Requirements: ${jd.requirements.slice(0, 5).join('; ')}`;
        }
        if (jd.technologies?.length) {
            jdContext += `\nTechnologies: ${jd.technologies.slice(0, 6).join(', ')}`;
        }
    }

    // ── Optional company signals from cached dossier ──
    let companyInsightContext = '';
    if (dossier) {
        const lines: string[] = [];
        if (dossier.hiring_strategy) lines.push(`Hiring Strategy: ${dossier.hiring_strategy}`);
        if (dossier.core_values && dossier.core_values.length > 0) {
            lines.push(`Company Values: ${dossier.core_values.slice(0, 5).join(', ')}`);
        }
        if (dossier.recent_news) lines.push(`Recent News: ${dossier.recent_news}`);
        if (lines.length > 0) {
            companyInsightContext = `\nCompany Signals (from prior research):\n${lines.map(l => `  - ${l}`).join('\n')}`;
        }
    }

    const prompt = `Write a formal cover letter for ${name}, in standard business-letter format. Follow the exact format specified below — every block has a role.

Resume:
${topExperience}
Top Skills: ${topSkills}

${jdContext}
${companyInsightContext ? `\n${companyInsightContext}` : ''}

Return JSON only (no markdown, no fences), exactly:

{
  "sender_block": [
    "${name}",
    "${name}'s email if it appears in the resume, else omit this line",
    "${name}'s phone if it appears in the resume, else omit this line",
    "${name}'s location (city, country) if it appears in the resume, else omit this line"
  ],
  "date": "today's date in 'Month DD, YYYY' format, e.g. 'January 15, 2026'",
  "recipient_block": [
    "Recipient name if you can confidently infer it from the JD, else 'Hiring Manager'",
    "Recipient title (e.g. 'Engineering Manager') if the JD names one, else this line",
    "${jdCompany ?? 'the company'}",
    "Company location if the JD gives one, else this line"
  ],
  "greeting": "1 formal salutation line, e.g. 'Dear Hiring Manager,' or 'Dear ${jdCompany ?? 'Hiring'} Team,'",
  "opening_hook": "1 sentence. Name the role by title and state the one clear reason ${name} is a fit.",
  "body_paragraphs": [
    "paragraph 1: 2-4 sentences. The candidate's most relevant experience, with 2-4 real achievements. Concrete numbers when the resume has them.",
    "paragraph 2 (only if there's something left to say): 2-3 sentences on why ${name} wants to work at ${jdCompany ?? 'this company'} specifically, and a clear ask for next steps."
  ],
  "closing": "1 short sentence expressing appreciation and next-step intent, e.g. 'I look forward to hearing from you.'",
  "signature": [
    "Sincerely,",
    "${name}"
  ]
}

Hard rules:
- Total letter 250 words MAX across greeting, opening_hook, body, and closing. Closer to 200 is better. The full document is longer because of the address blocks, but the prose itself stays tight.
- First person from ${name}.
- REAL achievements only. No invented metrics, scopes, or impacts.
- 1-2 body paragraphs. If one paragraph carries the letter, return body_paragraphs as a single-entry array.
- NO em-dashes (—), NO en-dashes (–), NO "--". Use comma, period, or colon.
- NEVER begin a sentence with "I am writing to apply", "I am excited to apply", "I would like to", "I have always been passionate". Start with the substance.
- No filler phrases: "unique blend", "drive business objectives", "competitive advantage", "data-driven mindset", "technical rigor", "actionable insights", "leverage", "synergy", "best-in-class", "results-oriented", "proven track record", "cutting-edge", "seamless", "spearheaded", "passionate about". If it sounds like a LinkedIn caption, do not write it.
- Don't reference "the resume" or "the job description" in the prose. Just make the points.
- Plain words over fancy ones.
- sender_block / recipient_block / signature arrays: omit any entry whose content you cannot fill from the inputs above. Do NOT invent an address line.
- Do NOT include any markdown formatting, bullet points, or JSON fences in the output values.
- Return JSON only.`;

    try {
        const response = await generateContentFn([{ text: prompt }]);
        const parsed = extractJsonObject(response);

        // Belt-and-suspenders dash scrub — the prompt forbids em/en-dashes, but in case
        // any slipped past the LLM and the post-pass filters, normalize them here too.
        // 1. em-dash (—, U+2014)  2. en-dash (–, U+2013)  3. double hyphen (--)
        const scrubDash = (s: string) =>
            s
                .replace(/—/g, ',')
                .replace(/–/g, ',')
                .replace(/--/g, ',')
                .replace(/ ,/g, ',');

        // humanize passes over body fields (prose filler rewrite). Address/signoff blocks
        // skip humanize — names/addresses are not corporate filler targets, running them
        // through the rewriter risks mangling legitimate text.
        const arrayOrEmpty = (v: any) => (Array.isArray(v) ? v : []);

        const sender_block = arrayOrEmpty(parsed.sender_block)
            .map((s: any) => scrubDash(String(s ?? '').trim()))
            .filter((s: string) => s.length > 0);
        const recipient_block = arrayOrEmpty(parsed.recipient_block)
            .map((s: any) => scrubDash(String(s ?? '').trim()))
            .filter((s: string) => s.length > 0);
        const signature = arrayOrEmpty(parsed.signature)
            .map((s: any) => scrubDash(String(s ?? '').trim()))
            .filter((s: string) => s.length > 0);

        const date = scrubDash(String(parsed.date ?? '').trim());

        // Normalize body prose through humanizeSpokenAnswer (defence in depth)
        // then dash-scrub.
        const rawParas = arrayOrEmpty(parsed.body_paragraphs);
        const body_paragraphs = rawParas
            .map((p: any) => scrubDash(humanizeSpokenAnswer(String(p ?? '').trim())))
            .filter((s: string) => s.length > 0);

        const greeting = scrubDash(humanizeSpokenAnswer(String(parsed.greeting ?? '').trim())) || 'Dear Hiring Manager,';
        const opening_hook = scrubDash(humanizeSpokenAnswer(String(parsed.opening_hook ?? '').trim()));
        // Append the candidate's name to the closing paragraph with a blank line
        // between, so the letter signs off with the actual name (e.g. "Thank you... \n\nEvin John")
        // — covers the "no salutation line below 'thank you'" case without needing a
        // separate signature block in the renderer.
        const rawClosing = scrubDash(humanizeSpokenAnswer(String(parsed.closing ?? '').trim()));
        const closing = rawClosing
            ? (rawClosing.includes(name) ? rawClosing : `${rawClosing}\n\n${name}`)
            : `Thank you for your time and consideration.\n\n${name}`;

        // Pre-join for one-click copy. Prose-only — the address blocks (sender,
        // date, recipient, signature) the LLM still produces are kept in their
        // own array fields but excluded from the copy-able string. The renderer
        // also skips rendering them. The user only sees letter content, so the
        // copy matches the visible output.
        const full_text = [
            greeting,
            opening_hook,
            ...body_paragraphs,
            closing,
        ].filter(s => s.length > 0).join('\n\n');

        return {
            sender_block,
            date,
            recipient_block,
            greeting,
            opening_hook,
            body_paragraphs,
            closing,
            signature,
            full_text,
        };
    } catch (error: any) {
        console.error('[CoverLetterEngine] Failed to generate cover letter:', error.message);
        return null;
    }
}
