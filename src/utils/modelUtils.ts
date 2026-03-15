import type { PreferredModelKey } from '../types/providers';

export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean;
    ids: string[];
    names: string[];
    descs: string[];
    pmKey: PreferredModelKey;
}> = {
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey,
        ids: ['gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview'],
        names: ['Gemini 3.1 Flash', 'Gemini 3.1 Pro'],
        descs: ['Fastest • Multimodal', 'Reasoning • High Quality'],
        pmKey: 'geminiPreferredModel'
    },
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.3-chat-latest'],
        names: ['GPT 5.3'],
        descs: ['OpenAI'],
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
    bedrock: {
        hasKeyCheck: (creds) => !!creds?.hasBedrockKey,
        ids: [
            'bedrock-anthropic.claude-opus-4-6-v1',
            'bedrock-anthropic.claude-sonnet-4-6',
            'bedrock-anthropic.claude-haiku-4-5-20251001-v1:0',
            'bedrock-amazon.nova-pro-v1:0',
        ],
        names: ['Claude Opus 4.6', 'Claude Sonnet 4.6', 'Claude Haiku 4.5', 'Amazon Nova Pro'],
        descs: ['AWS Bedrock', 'AWS Bedrock Fast', 'AWS Bedrock'],
        pmKey: 'bedrockPreferredModel'
    },
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
