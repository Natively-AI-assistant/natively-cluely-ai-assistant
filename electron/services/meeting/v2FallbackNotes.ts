// v2FallbackNotes.ts
//
// The single-call notes path that runs when the V3 pipeline is off or returns
// nothing: its prompts and the parser for its reply. Moved out of
// MeetingPersistence (2026-10-15) so both can be tested without Electron.
//
// Bug fixed here: GROQ_SUMMARY_JSON_PROMPT asked for "summary" while this
// parser read "overview", so a Groq-written fallback saved notes with no
// overview at all. The prompt now asks for "overview" and the parser accepts
// either key, so a reply in the old shape still lands.
//
// Pure. No Electron, no database, no platform branches.

import type { MeetingModeSectionInput } from './types';
import { MEETING_TITLE_RULE, isEmptyListPlaceholder, isEmptyPlaceholder } from './MeetingSummaryV3';
import { headingBudgetForTranscript, renderNotesPromptContext, userNoteHeadings, type NotesPromptContext } from './meetingNotesContext';

const BASE_RULES = `RULES:
- Do NOT invent information not present in the context
- You MAY infer implied action items or next steps if they are logical consequences of the discussion
- Do NOT explain or define concepts mentioned
- Do NOT use filler phrases like "The meeting covered..." or "Discussed various..."
- Do NOT mention transcripts, AI, or summaries
- Do NOT sound like an AI assistant
- Sound like a senior PM's internal notes

STYLE: Calm, neutral, professional, skim-friendly. Short bullets, no sub-bullets.`;

// Naming the meeting rides in the notes reply: no title call afterwards.
const TITLE_SHAPE = `"title": "the meeting's name"`;
const TITLE_RULE_LINE = `- ${MEETING_TITLE_RULE}.`;
const OVERVIEW_SHAPE = `"overview": "one solid paragraph compressing the ENTIRE meeting without losing anything important - purpose, what was discussed, key outcomes, and where things landed"`;

export interface V2FallbackPromptParams {
  modeNoteSections: MeetingModeSectionInput[];
  modeContextBlock?: string;
  /** Meeting context, user notes, spelling list. Last time is included when present. */
  notesContext?: NotesPromptContext | null;
  /** Characters of transcript, for the heading budget of free-form notes. */
  transcriptChars?: number;
  /** The provider-specific prompt for Groq's turn in the chain (GROQ_SUMMARY_JSON_PROMPT). */
  groqGenericPrompt: string;
}

/** How many key points a free-form note gets for its length. */
function keyPointRange(budget: number): string {
  if (budget <= 4) return '2-4';
  if (budget === 5) return '3-6';
  return `4-${Math.min(10, budget + 2)}`;
}

export function buildV2FallbackPrompts(params: V2FallbackPromptParams): { summaryPrompt: string; groqSummaryPrompt: string } {
  const context = renderNotesPromptContext(params.notesContext);
  const contextPart = context ? `\n${context}\n` : '';

  if (params.modeNoteSections.length > 0) {
    const sectionList = params.modeNoteSections
      .map(s => s.description?.trim() ? `- "${s.title}": ${s.description}` : `- "${s.title}"`)
      .join('\n');
    const sectionKeys = params.modeNoteSections.map(s => `    "${s.title}": []`).join(',\n');
    const summaryPrompt = `You are a silent meeting note-taker. Extract structured notes from the conversation transcript below.
${params.modeContextBlock || ''}${contextPart}
${BASE_RULES}
${TITLE_RULE_LINE}

SECTIONS TO FILL (extract only what is present in the transcript):
${sectionList}

Return ONLY valid JSON — no markdown fences, no comments, no extra keys. Each section value is an array of concise factual bullet strings taken directly from the conversation. Use [] if a section has no relevant content.

{
  ${TITLE_SHAPE},
  ${OVERVIEW_SHAPE},
  "sections": {
${sectionKeys}
  }
}`;
    return { summaryPrompt, groqSummaryPrompt: summaryPrompt };
  }

  // Free-form notes: the heading budget sets how much structure this meeting gets.
  const budget = headingBudgetForTranscript(params.transcriptChars ?? 0);
  const userHeadings = userNoteHeadings(params.notesContext?.userNotes);
  const headingRule = userHeadings.length > 0
    ? `- "sections": start with the user's own headings, in their order (${userHeadings.map(h => `"${h}"`).join(', ')}), then add others only if needed; at most ${Math.max(budget, userHeadings.length)} in all.`
    : `- "sections": at most ${budget} short headings for the distinct topics this meeting actually covered, each with its specific bullets. A short meeting with one topic gets [] and relies on keyPoints.`;
  const summaryPrompt = `You are a silent meeting summarizer. Convert this conversation into concise internal meeting notes.
${contextPart}
${BASE_RULES}
${TITLE_RULE_LINE}
- Notes are as long as the meeting warrants: a short call gets short notes.
${headingRule}

Return ONLY valid JSON (no markdown code blocks):
{
  ${TITLE_SHAPE},
  ${OVERVIEW_SHAPE},
  "keyPoints": ["${keyPointRange(budget)} specific bullets - each = one concrete topic or point discussed"],
  "sections": [{ "title": "short heading", "bullets": ["specific bullet"] }],
  "actionItems": ["specific next steps, assigned tasks, or implied follow-ups, owner first when the transcript names one. If absolutely none found, return empty array"]
}`;
  const groqSummaryPrompt = context ? `${params.groqGenericPrompt}\n\n${context}` : params.groqGenericPrompt;
  return { summaryPrompt, groqSummaryPrompt };
}

function stringList(value: unknown, max: number = 50, isPlaceholder: (text: string) => boolean = isEmptyPlaceholder): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v : (v && typeof v === 'object' && typeof (v as any).text === 'string' ? (v as any).text : '')))
    .map(v => v.replace(/\s+/g, ' ').trim())
    // "If absolutely none found, return empty array" comes back as ["None"] or
    // ["empty array"] from some models; that is no bullet (GitHub #662).
    .filter(v => !isPlaceholder(v))
    .slice(0, max);
}

function freeFormSections(value: unknown): Array<{ title: string; bullets: string[] }> {
  const out: Array<{ title: string; bullets: string[] }> = [];
  if (Array.isArray(value)) {
    for (const s of value) {
      const title = typeof s?.title === 'string' ? s.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      const bullets = stringList(s?.bullets);
      if (title && bullets.length) out.push({ title, bullets });
    }
  } else if (value && typeof value === 'object') {
    for (const [title, bullets] of Object.entries(value as Record<string, unknown>)) {
      const clean = stringList(bullets);
      if (title.trim() && clean.length) out.push({ title: title.trim().slice(0, 120), bullets: clean });
    }
  }
  return out.slice(0, 12);
}

/**
 * The fallback reply as saved notes, or null when it is not JSON. Reads
 * "overview" and, for a reply in GROQ_SUMMARY_JSON_PROMPT's old shape, "summary".
 */
export function parseV2SummaryResponse(raw: string, modeNoteSections: MeetingModeSectionInput[]): any | null {
  const text = String(raw || '');
  const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || [null, text];
  const jsonStr = (jsonMatch[1] || text).trim();
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try { parsed = JSON.parse(jsonStr.slice(first, last + 1)); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  // The first of overview / summary that says something: a placeholder overview
  // ("None") must not hide a real summary.
  const overview = [
    typeof parsed.overview === 'string' ? parsed.overview : '',
    typeof parsed.summary === 'string' ? parsed.summary : (Array.isArray(parsed.summary) ? stringList(parsed.summary).join(' ') : ''),
  ].map((v) => v.trim()).find((v) => v && !isEmptyPlaceholder(v)) ?? '';
  // Unvetted; MeetingPersistence vets it. Absent when the model gave none.
  const title = typeof parsed.title === 'string' ? parsed.title.replace(/\s+/g, ' ').trim() : '';
  const titlePart = title ? { title } : {};

  if (modeNoteSections.length > 0 && parsed.sections && typeof parsed.sections === 'object') {
    // Template order, every template section present (empty when the model had nothing).
    const byTitle = new Map<string, string[]>();
    if (Array.isArray(parsed.sections)) {
      for (const s of parsed.sections) if (typeof s?.title === 'string') byTitle.set(s.title, stringList(s?.bullets));
    } else {
      for (const [k, v] of Object.entries(parsed.sections)) byTitle.set(k, stringList(v));
    }
    return {
      ...titlePart,
      overview,
      actionItems: [],
      keyPoints: [],
      sections: modeNoteSections.map(s => ({ title: s.title, bullets: byTitle.get(s.title) ?? [] })),
    };
  }

  const sections = freeFormSections(parsed.sections);
  const decisions = stringList(parsed.decisions, 50, isEmptyListPlaceholder);
  return {
    ...titlePart,
    overview,
    keyPoints: stringList(parsed.keyPoints),
    actionItems: stringList(parsed.actionItems, 50, isEmptyListPlaceholder),
    ...(decisions.length ? { decisions } : {}),
    ...(sections.length ? { sections } : {}),
  };
}

/** True when parsed fallback notes carry anything worth saving. */
export function v2NotesHaveContent(summaryData: any): boolean {
  return Boolean(summaryData?.overview || summaryData?.keyPoints?.length || summaryData?.actionItems?.length
    || summaryData?.sections?.some((section: any) => Array.isArray(section.bullets) && section.bullets.length > 0));
}
