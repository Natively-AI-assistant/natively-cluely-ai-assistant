/**
 * The notepad's live demo (2026-11-01), played by Settings › Overlay's notepad
 * preview: a short made-up meeting on a loop, drawn by the real NotesWindow.
 * The transcript streams in word by word, the notes are typed beside it, the
 * listening bars move with whoever talks, then "/" in Ask lists the recipes
 * and "What did I miss" is answered with the transcript lines it used.
 *
 * Pure: `notepadDemoFrame(ms)` says what the notepad shows `ms` into the loop.
 * No timers, no DOM, no platform branches.
 */
import type { AskTurn, LivePartial, LiveTranscript, TranscriptLine } from './notepadView';

export const NOTEPAD_DEMO_TITLE = 'Weekly product sync';
export const NOTEPAD_DEMO_PEOPLE = 4;
export const NOTEPAD_DEMO_TEMPLATE = 'weekly-team-meeting';
/** Who "them" is in the bubbles (the user is "You"). */
export const NOTEPAD_DEMO_THEM = 'Maya';

/** One spoken line: who, what, when it starts. Words arrive every WORD_MS, final WORD_MS after the last. */
const WORD_MS = 190;
const SCRIPT: Array<{ speaker: 'user' | 'them'; text: string; at: number }> = [
    { speaker: 'them', at: 3_400, text: 'Quick launch update. Beta goes out Thursday to the first 200 users.' },
    { speaker: 'user', at: 6_000, text: 'Great. Is the docs page ready?' },
    { speaker: 'them', at: 7_700, text: 'Almost. It still needs screenshots of the new settings.' },
    { speaker: 'user', at: 10_000, text: 'I can take those tomorrow morning.' },
    { speaker: 'them', at: 11_700, text: "Then I'll draft the release note once they're in." },
    { speaker: 'them', at: 13_900, text: "One risk: support hasn't seen the new billing flow yet." },
    { speaker: 'user', at: 16_400, text: "Let's walk them through it on Wednesday." },
];

/** The user's own notes: each piece's markers land at once, its words are typed at TYPE_MS a letter. */
const TYPE_MS = 45;
const NOTES: Array<{ at: number; marker: string; text: string }> = [
    { at: 400, marker: '# ', text: 'Launch' },
    { at: 4_900, marker: '\n- ', text: 'Beta out Thursday, first 200 users' },
    { at: 9_000, marker: '\n- ', text: 'Docs page needs screenshots' },
    { at: 12_600, marker: '\n\n# ', text: 'Next steps' },
    { at: 13_300, marker: '\n- [ ] ', text: 'Settings screenshots, tomorrow' },
    { at: 15_000, marker: '\n- [ ] ', text: 'Release note draft (Maya)' },
    { at: 18_600, marker: '\n- [ ] ', text: 'Billing walkthrough for support, Wed' },
];

/** The transcript is open while the call talks; Ask opens after it closes and answers. */
const TRANSCRIPT_OPEN = 2_600;
const TRANSCRIPT_CLOSE = 19_000;
const ASK_OPEN = 21_400;
/** "/" typed into Ask lists the recipes for a moment before one runs. */
const SLASH_AT = 22_300;
const ASK_TURN = 24_000;
const ANSWER_START = 24_900;
const ANSWER_WORD_MS = 70;
const ANSWER = "Beta goes out Thursday to the first 200 users. The docs page still needs screenshots of the new settings, which you'll take tomorrow morning; Maya drafts the release note after that. Open risk: support hasn't seen the new billing flow, and you suggested a walkthrough on Wednesday.";
const ASK_CLOSE = 33_500;
/** One loop, then it starts over. */
export const NOTEPAD_DEMO_LOOP_MS = 35_000;
/** The still frame shown with reduced motion: every line said, the transcript open, the notes nearly done. */
export const NOTEPAD_DEMO_STILL_MS = 18_900;

export interface NotepadDemoFrame {
    text: string;
    transcript: LiveTranscript;
    /** 0..1, the meeting audio's level for the listening bars. */
    level: number;
    showTranscript: boolean;
    askOpen: boolean;
    /** What is typed in Ask ("/" opens the recipe list). */
    askText: string;
    turns: AskTurn[];
}

const words = (s: string) => s.split(' ');

function wordsAt(text: string, start: number, ms: number, per: number): { shown: string; done: boolean } {
    const all = words(text);
    const n = Math.floor((ms - start) / per) + 1;
    if (n <= 0) return { shown: '', done: false };
    if (n > all.length) return { shown: text, done: true };
    return { shown: all.slice(0, n).join(' '), done: false };
}

export function notepadDemoFrame(rawMs: number): NotepadDemoFrame {
    const ms = ((rawMs % NOTEPAD_DEMO_LOOP_MS) + NOTEPAD_DEMO_LOOP_MS) % NOTEPAD_DEMO_LOOP_MS;

    let text = '';
    for (const n of NOTES) {
        if (ms < n.at) break;
        const letters = Math.min(n.text.length, Math.floor((ms - n.at) / TYPE_MS));
        text += n.marker + n.text.slice(0, letters);
    }

    const lines: TranscriptLine[] = [];
    const partials: LivePartial[] = [];
    let talking = false;
    for (const s of SCRIPT) {
        if (ms < s.at) break;
        const said = wordsAt(s.text, s.at, ms, WORD_MS);
        const finalAt = s.at + words(s.text).length * WORD_MS + WORD_MS;
        if (ms >= finalAt) lines.push({ speaker: s.speaker, text: s.text, at: s.at });
        else if (said.shown) {
            partials.push({ speaker: s.speaker, text: said.shown, at: s.at, seen: s.at });
            talking = true;
        }
    }

    const turns: AskTurn[] = [];
    if (ms >= ASK_TURN && ms < ASK_CLOSE) {
        const answer = ms >= ANSWER_START ? wordsAt(ANSWER, ANSWER_START, ms, ANSWER_WORD_MS) : { shown: '', done: false };
        turns.push({ question: 'What did I miss', text: answer.shown, status: answer.done ? 'done' : 'streaming' });
    }

    return {
        text,
        transcript: { lines, partials },
        // The bars follow the audio: a voice rises and falls while someone talks, a low hum between.
        // (the bars are full from 0.3125: notepadView listeningBarHeights reads level x 3.2)
        level: talking ? 0.12 + 0.12 * Math.abs(Math.sin(ms / 140)) + 0.06 * Math.abs(Math.sin(ms / 53)) : 0.06,
        showTranscript: ms >= TRANSCRIPT_OPEN && ms < TRANSCRIPT_CLOSE,
        askOpen: ms >= ASK_OPEN && ms < ASK_CLOSE,
        askText: ms >= SLASH_AT && ms < ASK_TURN ? '/' : '',
        turns,
    };
}

/** Whether two frames draw the same notes, transcript and Ask (the level moves on its own). */
export function sameDemoContent(a: NotepadDemoFrame, b: NotepadDemoFrame): boolean {
    const key = (f: NotepadDemoFrame) => JSON.stringify([f.text, f.transcript.lines.length, f.transcript.partials.map((p) => p.text), f.showTranscript, f.askOpen, f.askText, f.turns]);
    return key(a) === key(b);
}
