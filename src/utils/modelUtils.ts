export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean;
    ids: string[];
    names: string[];
    descs: string[];
    pmKey: 'geminiPreferredModel' | 'openaiPreferredModel' | 'claudePreferredModel' | 'groqPreferredModel';
}> = {
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey,
        ids: [
            'gemini-3-flash-preview',
            'gemini-3.1-flash-lite',
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-3.5-flash',
            'gemini-3.1-flash-lite-preview',
            'gemini-3.1-pro-preview'
        ],
        names: [
            'Gemini 3 Flash',
            'Gemini 3.1 Flash-Lite',
            'Gemini 2.5 Flash',
            'Gemini 2.5 Flash-Lite',
            'Gemini 3.5 Flash',
            'Gemini 3.1 Flash-Lite Preview',
            'Gemini 3.1 Pro'
        ],
        descs: [
            'Best balance • Live interviews',
            'Budget • Fast',
            'Stable • 1M context',
            'Cheapest • High volume',
            'Quality • Frontier Flash',
            'Preview • Fastest',
            'Reasoning • High Quality'
        ],
        pmKey: 'geminiPreferredModel'
    },
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.4-mini', 'gpt-5.4'],
        names: ['GPT 5.4 Mini', 'GPT 5.4'],
        descs: ['Budget • Live interviews', 'OpenAI'],
        pmKey: 'openaiPreferredModel'
    },
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6'],
        names: ['Sonnet 4.6'],
        descs: ['Anthropic'],
        pmKey: 'claudePreferredModel'
    },
    groq: {
        hasKeyCheck: (creds) => !!creds?.hasGroqKey,
        ids: ['llama-3.3-70b-versatile'],
        names: ['Groq Llama 3.3'],
        descs: ['Ultra Fast'],
        pmKey: 'groqPreferredModel'
    },
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
