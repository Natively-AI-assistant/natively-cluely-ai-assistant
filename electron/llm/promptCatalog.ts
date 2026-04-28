/**
 * Built-in copilot prompts exposed in Settings → Prompts.
 * Each id maps to one system prompt string resolved at generation time.
 */
export type BuiltinPromptId =
    | 'whatToAnswer'
    | 'bugFinder'
    | 'aiDesign'
    | 'systemDesign'
    | 'codingBrainstorm'
    | 'answerRecord'
    | 'codeHint'
    | 'refineAnswer'
    | 'clarify';

export interface PromptCatalogEntry {
    id: BuiltinPromptId;
    label: string;
    /** Key in renderer ShortcutConfig / useShortcuts; null = no global shortcut */
    shortcutKey: string | null;
    /** Main-process keybind id for accelerator lookup */
    keybindBackendId: string | null;
    /** Default tags for grouping / display in settings and overlay chips */
    defaultTags: readonly string[];
}

export const PROMPT_CATALOG: readonly PromptCatalogEntry[] = [
    { id: 'whatToAnswer', label: 'What to Answer', shortcutKey: 'whatToAnswer', keybindBackendId: 'chat:whatToAnswer', defaultTags: ['Copilot'] },
    { id: 'bugFinder', label: 'Bug Finder', shortcutKey: 'bugFinder', keybindBackendId: 'chat:bugFinder', defaultTags: ['Copilot'] },
    { id: 'aiDesign', label: 'AI Design', shortcutKey: 'followUp', keybindBackendId: 'chat:followUp', defaultTags: ['Copilot'] },
    { id: 'systemDesign', label: 'System Design', shortcutKey: 'dynamicAction4', keybindBackendId: 'chat:dynamicAction4', defaultTags: ['Copilot'] },
    { id: 'codingBrainstorm', label: 'Coding brainstorm', shortcutKey: 'codingBrainstorm', keybindBackendId: 'chat:codingBrainstorm', defaultTags: ['Copilot'] },
    { id: 'answerRecord', label: 'Answer / Record', shortcutKey: 'answer', keybindBackendId: 'chat:answer', defaultTags: ['Copilot'] },
    { id: 'codeHint', label: 'Get Code Hint', shortcutKey: 'codeHint', keybindBackendId: 'chat:codeHint', defaultTags: ['Copilot'] },
    { id: 'refineAnswer', label: 'Refine answer (rephrase, shorten, …)', shortcutKey: 'shorten', keybindBackendId: 'chat:shorten', defaultTags: ['Copilot'] },
    { id: 'clarify', label: 'Clarify (ask interviewer)', shortcutKey: null, keybindBackendId: null, defaultTags: ['Copilot'] },
] as const;

export const BUILTIN_PROMPT_IDS = new Set<string>(PROMPT_CATALOG.map((e) => e.id));
