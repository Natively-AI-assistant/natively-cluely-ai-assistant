import { PromptRegistryStore } from '../services/PromptRegistryStore';
import type { BuiltinPromptId } from './promptCatalog';
import {
    UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
    BUG_FINDER_PROMPT,
    UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT,
    UNIVERSAL_SYSTEM_DESIGN_PROMPT,
    BRAINSTORM_MODE_PROMPT,
    UNIVERSAL_ANSWER_PROMPT,
    CODE_HINT_PROMPT,
    UNIVERSAL_FOLLOWUP_PROMPT,
    CLARIFY_MODE_PROMPT,
} from './prompts';

const defaultBodies: Record<BuiltinPromptId, () => string> = {
    whatToAnswer: () => UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
    bugFinder: () => BUG_FINDER_PROMPT,
    aiDesign: () => UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT,
    systemDesign: () => UNIVERSAL_SYSTEM_DESIGN_PROMPT,
    codingBrainstorm: () => BRAINSTORM_MODE_PROMPT,
    answerRecord: () => UNIVERSAL_ANSWER_PROMPT,
    codeHint: () => CODE_HINT_PROMPT,
    refineAnswer: () => UNIVERSAL_FOLLOWUP_PROMPT,
    clarify: () => CLARIFY_MODE_PROMPT,
};

export function getDefaultPromptBody(id: BuiltinPromptId): string {
    const fn = defaultBodies[id];
    return fn ? fn() : '';
}

/** Effective system prompt: user override if set, else built-in default. */
export function getResolvedPromptBody(id: BuiltinPromptId): string {
    const custom = PromptRegistryStore.getInstance().getOverride(id);
    if (custom !== undefined) return custom;
    return getDefaultPromptBody(id);
}

export function isBuiltinPromptId(id: string): id is BuiltinPromptId {
    return id in defaultBodies;
}

export type { BuiltinPromptId };
