/** Must match `CUSTOM_PROMPT_KEYBIND_PREFIX` in electron/services/PromptRegistryStore.ts */
export const CUSTOM_PROMPT_KEYBIND_PREFIX = 'chat:custom:';

export function customPromptKeybindId(customId: string): string {
    return `${CUSTOM_PROMPT_KEYBIND_PREFIX}${customId}`;
}
