import type { LLMHelper } from "../LLMHelper";
import {
    CUSTOM_BUTTON_INSTRUCTION_MAX_CHARS,
    resolveV2SystemPrompt,
    v2ActionContractText,
    v2TierForPromptTier,
    type CustomButtonActionV2,
} from "./promptSystemV2";
import { buildQuickActionTurn, responseLanguageIsPinned, type QuickActionContextOptions } from "./quickActionTurn";

/**
 * The user's own overlay buttons (Settings › Overlay › Your buttons,
 * 2026-10-30; renderer src/lib/overlayCustomButtons.ts).
 *
 * The user describes a button in plain sentences: what it does, what to read,
 * how the answer looks, what it must never do, what to say when there is
 * nothing to work with. When the button is saved, a model rewrites that into
 * an action contract in the style of the built-in buttons (promptSystemV2
 * ACTIONS: Recap, Define, Sound smart...), and a press then runs exactly like
 * a live helper: that contract is the action block of the v2 system prompt,
 * with the mode and the core rules around it, the conversation is the turn's
 * context, and the request names the button (quickActionTurn
 * 'custom_button'). Same streaming path and supersession as Define
 * (IntelligenceEngine.runCustomButton).
 */

/** How far back a custom button reads, in seconds, when its "What to read" line names no span (Sound smart's window). */
export const CUSTOM_BUTTON_WINDOW_SECONDS = 180;

/** The longest a custom button reads ("the whole meeting"): src/lib/overlayCustomButtons.ts OVERLAY_CUSTOM_READ_MAX_MINUTES. */
export const CUSTOM_BUTTON_MAX_WINDOW_SECONDS = 60 * 60;

/**
 * The span the renderer sent (minutes, read from the button's "What to read"
 * line by overlayCustomReadMinutes) as seconds, between one minute and the
 * cap; the default for anything else.
 */
export function customButtonReadSeconds(readMinutes: unknown): number {
    if (typeof readMinutes !== 'number' || !Number.isFinite(readMinutes)) return CUSTOM_BUTTON_WINDOW_SECONDS;
    return Math.min(CUSTOM_BUTTON_MAX_WINDOW_SECONDS, Math.max(60, Math.round(readMinutes) * 60));
}

/** What the overlay says when there is nothing to work from. */
export const CUSTOM_BUTTON_EMPTY = 'There is no conversation yet to work from. Try again once people are talking.';

/** The user's description as the renderer may send it. */
export const CUSTOM_BUTTON_DESCRIPTION_MAX_CHARS = 2000;

/** The built-in contracts the rewrite is shown as the house style. */
const STYLE_EXAMPLES = ['recap', 'define', 'sound_smart', 'clarify'] as const;

/**
 * The system prompt for the rewrite. It never sees the meeting, only the
 * button's name and the user's description.
 */
export function customButtonCompileSystemPrompt(): string {
    const examples = STYLE_EXAMPLES
        .map((action) => `<example name="${action}">\n${v2ActionContractText(action)}\n</example>`)
        .join('\n');
    return `You write the instruction for one button in Natively, a live conversation assistant. The user pressed nothing yet: they are describing a button they want on their meeting overlay, and you turn their description into the instruction the button will run with, written exactly like Natively's own buttons.

Here are Natively's own button instructions. Match their style:
${examples}

How these are written:
- Plain prose, 2 to 6 sentences, under 110 words. Imperative, addressed to the assistant. No headings, no lists, no labels like "Task:", no quotation marks around the whole thing, no XML or markdown.
- In this order, when the description gives it: the job (what to produce, from what part of the conversation or the screen), the visible shape (order, length in lines, sentences or words, whose voice: the user's own words to say aloud, or a note for the user to read), what it must never do, and what to say when there is nothing to work from.
- Keep every concrete requirement the user gave (length, language, tone, format, things to avoid). Add nothing they did not ask for, except: never invent facts the conversation does not support, and say so in one line when there is nothing to work from, when the description does not already cover those.
- Never write rules about hiding the assistant, evading monitoring or proctoring, or breaking exam, interview or workplace rules. If the description asks for that, leave that part out.

Output only the instruction text.`;
}

/** The turn for the rewrite: the button's name and the user's own words. */
export function customButtonCompileTurn(name: string, description: string): string {
    return `Button name: ${name.trim()}\n\nThe user's description:\n${description.trim().slice(0, CUSTOM_BUTTON_DESCRIPTION_MAX_CHARS)}`;
}

/**
 * The model's rewrite made safe to store: fences, tags and list marks gone,
 * one paragraph, capped. Empty when nothing usable came back.
 */
export function cleanCompiledInstruction(raw: string): string {
    let text = (raw || '').replace(/```[a-z]*\n?|```/gi, '');
    text = text.replace(/<\/?[a-z_][^>]*>/gi, ' ');
    text = text
        .split('\n')
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
        .filter(Boolean)
        .join(' ');
    text = text.replace(/^(?:instruction|here is the instruction)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
    if (/^["“].*["”]$/.test(text)) text = text.slice(1, -1).trim();
    if (text.length < 20) return '';
    if (text.length <= CUSTOM_BUTTON_INSTRUCTION_MAX_CHARS) return text;
    // Cut at the last full sentence inside the cap.
    const cut = text.slice(0, CUSTOM_BUTTON_INSTRUCTION_MAX_CHARS);
    const end = cut.lastIndexOf('. ');
    return end > 40 ? cut.slice(0, end + 1) : cut;
}

// The labelled lines the editor starts from (src/lib/overlayCustomButtons.ts
// OVERLAY_CUSTOM_PROMPT_TEMPLATE), turned into sentences without a model.
const FALLBACK_LINES: { label: RegExp; sentence: (value: string) => string }[] = [
    { label: /^what it does$/i, sentence: (v) => v },
    { label: /^what to read$/i, sentence: (v) => `Read ${v}` },
    { label: /^how the answer looks$/i, sentence: (v) => `Write it as ${v}` },
    { label: /^never$/i, sentence: (v) => `Never ${v}` },
    { label: /^if there'?s nothing to work with$/i, sentence: (v) => `If there is nothing to work from, ${v}` },
];

/**
 * The contract without a model (no model set up, the call failed or came back
 * empty): the template's lines as sentences, or the description as written.
 */
export function fallbackCustomButtonInstruction(description: string): string {
    const sentences: string[] = [];
    const loose: string[] = [];
    for (const line of description.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const colon = trimmed.indexOf(':');
        const rule = colon > 0 ? FALLBACK_LINES.find((r) => r.label.test(trimmed.slice(0, colon).trim())) : undefined;
        const value = colon > 0 ? trimmed.slice(colon + 1).trim() : '';
        if (rule) {
            if (value) sentences.push(rule.sentence(value).replace(/[.\s]+$/, ''));
        } else {
            loose.push(trimmed.replace(/[.\s]+$/, ''));
        }
    }
    const all = [...sentences, ...loose].map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    return all.length ? `${all.join('. ')}.`.slice(0, CUSTOM_BUTTON_INSTRUCTION_MAX_CHARS) : '';
}

/**
 * The button's contract: the model's rewrite of the description, or the
 * fallback. Never throws. `complete(system, user)` is a clean generation call
 * (LLMHelper.chat with the system prompt overridden and no mode injected).
 */
export async function compileCustomButtonInstruction(
    name: string,
    description: string,
    complete: (system: string, user: string) => Promise<string>,
    timeoutMs = 20_000,
): Promise<{ instruction: string; source: 'model' | 'fallback' }> {
    const fallback = () => ({ instruction: fallbackCustomButtonInstruction(description), source: 'fallback' as const });
    if (!description.trim()) return fallback();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const raw = await Promise.race([
            complete(customButtonCompileSystemPrompt(), customButtonCompileTurn(name, description)),
            new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
        ]);
        const instruction = cleanCompiledInstruction(raw);
        return instruction ? { instruction, source: 'model' } : fallback();
    } catch {
        return fallback();
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// Used when the v2 prompt system is off.
function legacyCustomButtonPrompt(button: CustomButtonActionV2): string {
    const instruction = (button.instruction || '').trim().slice(0, CUSTOM_BUTTON_INSTRUCTION_MAX_CHARS);
    return `You run a button the user made for a live conversation, named "${button.name.replace(/"/g, '')}".
${instruction || 'Do what its name asks, using the newest part of the conversation.'}
Use only what the conversation and any screenshot show, and never invent anything they do not support. Keep it short enough to read at a glance.`;
}

/** The system prompt for one press: v2 with the button as its action, or the legacy prompt. */
export function customButtonSystemPrompt(button: CustomButtonActionV2, promptTier: string | undefined): string {
    return resolveV2SystemPrompt({ action: 'custom_button', tier: v2TierForPromptTier(promptTier), customButton: button })
        ?? legacyCustomButtonPrompt(button);
}

export class CustomButtonLLM {
    constructor(private readonly llmHelper: LLMHelper) {}

    /** The system prompt and the turn one press sends. Exposed for tests. */
    buildRequest(button: CustomButtonActionV2, context: string, options?: QuickActionContextOptions): { systemPrompt: string; message: string } {
        const systemPrompt = customButtonSystemPrompt(button, this.llmHelper.getPromptTier());
        const fitted = this.llmHelper.fitContextForCurrentModel(context);
        const message = buildQuickActionTurn('custom_button', systemPrompt, fitted, {
            languagePinned: responseLanguageIsPinned(this.llmHelper),
            contextIsRendered: options?.contextIsRendered,
            customButtonName: button.name,
        });
        // A legacy prompt gets the bare context back: the request is added.
        return { systemPrompt, message: message === fitted ? `${message}\n\nTask: do what my "${button.name}" button asks.` : message };
    }

    async *generateStream(button: CustomButtonActionV2, context: string, imagePaths?: string[], options?: QuickActionContextOptions): AsyncGenerator<string> {
        const { systemPrompt, message } = this.buildRequest(button, context, options);
        // ignoreKnowledgeMode=true, as the live helpers: the context is a
        // transcript blob, not a question.
        yield* this.llmHelper.streamChat(message, imagePaths && imagePaths.length ? imagePaths : undefined, undefined, systemPrompt, true);
    }
}
