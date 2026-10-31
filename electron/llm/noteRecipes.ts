/**
 * Notepad recipes (2026-10-31): Granola's recipe list, in Natively's words.
 *
 * A recipe is a named instruction run over one meeting. Granola keeps its recipe
 * prompts on its server (a static read of Granola 7.722.1 found names and
 * descriptions only), so each instruction here is written from the shape of
 * Granola's own answers on the same seven benchmark meetings
 * (~/natively-granola-bench/results/<id>/granola-recipes.json): "Write tldr" is one
 * line of who and what, then two bullets; "List my todos" is To do / Inferred with
 * bold dates; the follow-up email is a Subject line and a short note signed with
 * the user's first name.
 *
 * The four live helpers (What did I miss, Make me sound smart, Suggest questions,
 * Define) are recipes too, but run through IntelligenceEngine.runLiveHelper: they
 * read the last minutes of a live meeting, so they are offered only while it is live.
 *
 * Pure data and text; shared by the notepad (labels, "/" search) and the main
 * process (instructions). No platform branch.
 */

export type RecipeAvailability = 'live' | 'ended' | 'any';

export type LiveHelperRecipeAction = 'catch_me_up' | 'sound_smart' | 'follow_up_questions' | 'define';

export interface NoteRecipe {
    id: string;
    /** What the row and the turn read as. */
    label: string;
    /** The row's second line. */
    description: string;
    /** Extra words "/" matches besides the label ("summary" finds Write tldr). */
    keywords?: string[];
    availability: RecipeAvailability;
    /** Live helpers run through the overlay's helper path, not an instruction. */
    helper?: LiveHelperRecipeAction;
    /** What to write. Absent for helpers. */
    instruction?: string;
    /** The recipe works on what the user types after it ("/decide pricing or seats"). */
    takesInput?: string;
}

const TODO_SHAPE =
    'First work out what is mine, line by line: a promise on a ME line ("I\'ll send ...", "I\'ll ask ...", "let me ...") is mine; a promise on a THEM line ("I\'ll have it on staging") is that other person\'s, never mine, even though it says "I"; something a THEM line asks me to do is mine only if a ME line agrees; and a ME line that hands work to someone else ("write a one-page summary", "take Friday off", a recap like "Mei: endpoint by the fifth") gives that task to them, not me. Items the notes give to the name the others call me by are mine too. Under "**To do:**", one "- " line for each of mine, with no owner name: the task, then its due date in bold, said once ("by **Friday, November 6**", "**today, October 31**", "in **January**"), or "No deadline was promised." after the task when none was said. If I committed to nothing, list the others\' commitments under "**To do:**" instead, each starting with the owner in bold and a colon. Every line is a task; never a line that is only "No deadline was promised.". If nobody has committed to anything yet, the To do list is the one line "- Nothing has been committed to yet." Under "**Inferred:**", one to three follow-ups for me that the meeting implies but nobody promised, such as checking that someone else delivers ("Confirm Kemal reconnects the feed"); never repeat a To do line there; leave "**Inferred:**" out when there are none. Add a "**Date note:**" line only when a weekday and date said together disagree with the CALENDAR, or a relative day ("tomorrow, Tuesday") does not fit the meeting\'s date; check against the CALENDAR, never from memory, and never write a note saying the dates fit.';

export const NOTE_RECIPES: NoteRecipe[] = [
    // Live helpers: Granola's live chips.
    { id: 'what-did-i-miss', label: 'What did I miss', description: 'The last few minutes in two or three lines', keywords: ['catch up', 'recap'], availability: 'live', helper: 'catch_me_up' },
    { id: 'sound-smart', label: 'Make me sound smart', description: 'A sharper way to say your point, ready to read out', keywords: ['smart', 'say'], availability: 'live', helper: 'sound_smart' },
    { id: 'suggest-questions', label: 'Suggest questions', description: 'Good questions to ask next', keywords: ['follow-up questions', 'ask'], availability: 'live', helper: 'follow_up_questions' },
    { id: 'define', label: 'Define', description: 'Explains the term that was just used', keywords: ['explain', 'term'], availability: 'live', helper: 'define' },

    // Granola's built-ins.
    {
        id: 'tldr', label: 'Write tldr', description: 'Two bullet meeting summary for sharing with your team', keywords: ['summary', 'tl;dr', 'recap'], availability: 'any',
        instruction:
            'Write a tldr of the meeting to share with my team. First line: one sentence of at most 18 words, who I met and what about ("Met with Samuel from Ironbark to discuss ..."; for a class or talk, "Attended a class on ..."). Then exactly two "- " bullets: the main outcome with its key figure, then what happens next with the main names and dates. Each bullet one sentence of 12 to 22 words with at most two figures: the facts that matter most, the rest left to the notes. Nothing else: no heading, no closing line, no signature.',
    },
    {
        id: 'follow-up-email', label: 'Write follow up email', description: 'Quick email to send after a meeting recapping next steps', keywords: ['email', 'mail', 'recap'], availability: 'any',
        instruction:
            'Write the follow-up email I send to the other person after this meeting. First line "**Subject:** " and a subject of two to six words. Then "Hi <their first name>," and a short body of two short paragraphs, under 110 words in all: what I will do and by when, then what I need from them and by when, with the dates and figures said. Plain and warm, no "I hope this finds you well", no bullet points, no recap of the whole meeting. Sign off with "Thanks," or "Best," and my first name on its own line.',
    },
    { id: 'todos', label: 'List my todos', description: 'Your action items from the meeting', keywords: ['action items', 'tasks', 'to do', 'next steps'], availability: 'any', instruction: `List the action items from this meeting. ${TODO_SHAPE} Nothing else.` },
    {
        id: 'notes-shorter', label: 'Make notes shorter', description: 'Rewrites meeting notes so they are shorter and more concise', keywords: ['concise', 'shorten', 'brief'], availability: 'ended',
        instruction:
            'Rewrite the meeting notes about half as long. Keep the same "### " topic headings (drop one only if it is empty after cutting), each with two to four "- " bullets in note-taker shorthand of at most 14 words, keeping every figure, date, name and decision. End with "### Next steps" and the action items. Nothing before the first heading.',
    },
    {
        id: 'notes-longer', label: 'Make notes longer', description: 'Expands the notes with more detail from the transcript', keywords: ['expand', 'detail', 'longer'], availability: 'ended',
        instruction:
            'Rewrite the meeting notes with more detail from the transcript. Keep the topic order with "### " headings, five to eight "- " bullets under each, and indented "  - " sub-bullets for the reasons, numbers and examples given. Add anything said that the notes left out. End with "### Next steps" and the action items with owners and dates. Nothing before the first heading.',
    },

    // Granola's public library, rewritten.
    {
        id: 'affirm', label: 'Affirm', description: 'One-sentence replies that affirm the other person and build rapport', keywords: ['rapport', 'empathy', 'sales'], availability: 'any',
        instruction:
            'Give me three replies I could say to the other person to affirm what they said and build rapport, each one sentence of at most 25 words, as "- " bullets, each naming the specific thing they said (a goal, worry or win). Warm, not flattering, no questions. Nothing else.',
    },
    {
        id: 'content-plan', label: 'Content plan', description: 'Turns the meeting into a content production plan with a checklist', keywords: ['devrel', 'content', 'blog', 'video'], availability: 'any',
        instruction:
            'Turn this meeting into a content production plan. "### Ideas": two to four pieces of content the meeting suggests, each "- **Title**: format, audience, the angle in one line". "### Key points to cover": the facts, figures and quotes from the meeting each piece needs. "### Checklist": "- [ ] " lines for each step (draft, review, assets, publish) with an owner and date where the meeting gave one.',
    },
    {
        id: 'help-doc', label: 'Create help doc', description: 'A customer-facing help article for a feature discussed in the meeting', keywords: ['documentation', 'support', 'article', 'faq'], availability: 'any',
        instruction:
            'Write a customer-facing help article for the feature or change discussed in this meeting. "# " title naming the feature. One short paragraph of what it does and who it is for. "### How to use it": numbered steps. "### Good to know": limits, prices and dates that were said. "### FAQ": two or three questions a customer would ask, each with a short answer. Use only what the meeting said; write "[confirm]" where a detail is missing.',
    },
    {
        id: 'build-brief', label: 'Build brief', description: 'A build brief to paste into an AI coding tool', keywords: ['replit', 'prd', 'spec', 'prototype', 'cursor'], availability: 'any',
        instruction:
            'Write a build brief I can paste into an AI app builder to prototype what this meeting described. "### Goal": one or two sentences. "### Users": who uses it. "### Must have": "- " features as testable behaviour. "### Data": the main records and fields. "### Out of scope": what was ruled out. "### Done when": two or three acceptance checks. Use the meeting\'s own names and numbers; no invented features.',
    },
    {
        id: 'tickets', label: 'Create tickets', description: 'Product and engineering tasks as tickets for Linear or Jira', keywords: ['linear', 'jira', 'issue', 'bug', 'engineering'], availability: 'any',
        instruction:
            'Extract the product and engineering tasks from this meeting as tickets. For each: "### " a title starting with a verb, then "- **Why:** ", "- **What:** " (the expected behaviour), "- **Owner:** " and "- **Due:** " when said, and "- **Priority:** " (Urgent, High, Medium or Low, judged from what was said). Only real tasks the meeting raised; if there are none, say so in one line.',
    },
    {
        id: 'linkedin-brief', label: 'Pain point to LinkedIn brief', description: 'Turns a customer frustration into a brief for a LinkedIn post', keywords: ['linkedin', 'post', 'social', 'marketing'], availability: 'any',
        instruction:
            'Pick the sharpest customer frustration in this meeting and turn it into a brief for a LinkedIn post. "**Pain point:** " in the customer\'s words. "**Hook:** " a first line of at most 12 words. "**Story:** " three "- " beats (the problem, what it costs, the turn). "**Visual:** " one line for the designer. "**Call to action:** " one line. Never name the customer or their company.',
    },
    {
        id: 'schedule-follow-up', label: 'Schedule follow up meeting', description: 'A calendar invite and email to book the next meeting', keywords: ['calendar', 'invite', 'meeting', 'book'], availability: 'any',
        instruction:
            'Draft the next meeting this one agreed or implies. "**Title:** ", "**When:** " (the date or window said, or "Propose a time"), "**Who:** " (the people), "**Agenda:** " with two to four "- " items from the open questions and next steps. Then a two-line email asking them to confirm the time, signed with my first name.',
    },
    {
        id: 'help-me-decide', label: 'Help me decide', description: 'Weighs a decision from the meeting with a clear recommendation', keywords: ['decide', 'decision', 'tradeoff', 'framework'], availability: 'any',
        takesInput: 'the decision, if not the meeting\'s main one',
        instruction:
            'Help me make the decision raised in this meeting (or the one I name). "**Decision:** " one line. "**Options:** " each option as a "- " bullet with its main upside and downside from what was said. "**What matters most:** " the one or two criteria that should decide it. "**Reversible?** " one line. "**My recommendation:** " the option to pick and why in two sentences, and what would change it.',
    },
];

/** Recipes offered in this phase of the meeting. */
export function recipesFor(phase: 'live' | 'ended'): NoteRecipe[] {
    return NOTE_RECIPES.filter((r) => r.availability === 'any' || r.availability === phase);
}

export function noteRecipeById(id: string): NoteRecipe | undefined {
    return NOTE_RECIPES.find((r) => r.id === id);
}

/**
 * "/" search: the text after the slash against the label first, then keywords and
 * the description. Label starts rank first, then word starts, then anywhere.
 */
export function searchRecipes(list: NoteRecipe[], query: string): NoteRecipe[] {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    const scored: Array<{ r: NoteRecipe; s: number; i: number }> = [];
    list.forEach((r, i) => {
        const label = r.label.toLowerCase();
        const words = label.split(/\s+/);
        let s = 0;
        if (label.startsWith(q)) s = 4;
        else if (words.some((w) => w.startsWith(q))) s = 3;
        else if (label.includes(q)) s = 2;
        else if ((r.keywords ?? []).some((k) => k.toLowerCase().includes(q)) || r.description.toLowerCase().includes(q)) s = 1;
        if (s) scored.push({ r, s, i });
    });
    return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
}

/**
 * "/tldr in Spanish" → the recipe the text names and what follows it. The longest
 * label or keyword the text starts with wins; null when it names none.
 */
export function parseSlashCommand(list: NoteRecipe[], text: string): { recipe: NoteRecipe; extra: string } | null {
    if (!text.startsWith('/')) return null;
    const body = text.slice(1).toLowerCase();
    let best: { recipe: NoteRecipe; len: number } | null = null;
    for (const r of list) {
        for (const name of [r.label, r.id.replace(/-/g, ' '), ...(r.keywords ?? [])]) {
            const n = name.toLowerCase();
            if ((body === n || body.startsWith(`${n} `)) && (!best || n.length > best.len)) best = { recipe: r, len: n.length };
        }
    }
    return best ? { recipe: best.recipe, extra: text.slice(1 + best.len).trim() } : null;
}

/** The system prompt every recipe runs under: the house style of Granola's answers. */
export function recipeSystemPrompt(params: { userName?: string | null; today: string; calendar?: string }): string {
    const first = params.userName?.trim().split(/\s+/)[0];
    return [
        'You write for the user from one of their meetings. In the transcript ME is the user and THEM is everyone else; the notes name the people, so use their names, spelled as the notes spell them.',
        'Everything ME says is the user, whatever name the others call them by in the meeting: write the user\'s part as "I" and "we", never under a name, and never list the user as someone else.',
        `Sign only an email or message the recipe asks for, ${first ? `as ${first}` : 'with "[Your name]"'}; never sign a summary, list or brief.`,
        `Today is ${params.today}. Keep dates as said ("Friday, November 6"); never invent a year or a date nobody said.`,
        params.calendar ? `CALENDAR (weekday of each date from today on): ${params.calendar}` : '',
        'Use only what the meeting said. Keep every figure exactly ("$7.20", "58%"). If something the recipe asks for never came up, leave it out or say so in a few words; never fill a gap with a guess.',
        'Markdown only as the recipe asks: "- " bullets, "### " headings, **bold** for the labels and dates it names. No preamble ("Here is ..."), no closing offer ("Want me to ...?").',
    ].filter(Boolean).join('\n');
}

/**
 * The weekday of each of the next `days` dates ("Sat Oct 31, Sun Nov 1, ..."): models
 * get weekdays wrong from memory, and a todo's Date note depends on them.
 */
export function calendarLine(from: Date, days = 60): string {
    const out: string[] = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
        out.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    }
    return out.join('; ');
}

/** The user turn: the recipe, what the user added, then the meeting. */
export function recipeUserPrompt(params: { recipe: NoteRecipe; extra?: string; context: string }): string {
    const extra = params.extra?.trim();
    const lines = [`RECIPE: ${params.recipe.label}`, params.recipe.instruction ?? ''];
    if (extra) lines.push(`The user added: "${extra}". Follow it where it changes the recipe.`);
    return `${lines.join('\n')}\n\n${params.context}`;
}

/** Live transcript lines up to which a live recipe reads the whole meeting so far (about 60k characters). */
const LIVE_RECIPE_MAX_CHARS = 60000;

/**
 * A live meeting for a recipe: what the user typed in the notepad, then the
 * transcript so far ("user" lines are ME). Longer meetings keep their latest part.
 * Null when nothing was said yet.
 */
export function liveRecipeContext(lines: Array<{ speaker: string; text: string }>, notes: string): string | null {
    const said = lines.filter((l) => l.text?.trim()).map((l) => `${l.speaker === 'user' ? 'ME' : 'THEM'}: ${l.text.trim()}`);
    if (said.length === 0) return null;
    let transcript = said.join('\n');
    if (transcript.length > LIVE_RECIPE_MAX_CHARS) transcript = `(earlier part left out)\n${transcript.slice(-LIVE_RECIPE_MAX_CHARS)}`;
    const typed = notes.trim();
    return `${typed ? `MY NOTES (typed during the meeting):\n${typed.slice(0, 8000)}\n\n` : ''}TRANSCRIPT SO FAR (ME is the user; THEM is everyone else):\n${transcript}`;
}
