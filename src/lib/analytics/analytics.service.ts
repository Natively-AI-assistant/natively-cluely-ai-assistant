// Analytics service disabled — all methods are no-ops.

export type ModelProviderType = 'cloud' | 'local';
export type AssistantMode = 'launcher' | 'overlay' | 'undetectable' | string;
export type AnalyticsEventName = string;

export function detectProviderType(modelName: string): ModelProviderType {
    const lower = modelName.toLowerCase();
    if (
        lower.startsWith('ollama:') ||
        lower.includes('llama') ||
        lower.includes('mistral') ||
        lower.includes('codellama') ||
        lower.includes('phi') ||
        lower.includes('deepseek') ||
        lower.includes('qwen') ||
        lower.includes('vicuna') ||
        lower.includes('orca')
    ) {
        return 'local';
    }
    return 'cloud';
}

class AnalyticsService {
    private static instance: AnalyticsService;
    private constructor() {}

    public static getInstance(): AnalyticsService {
        if (!AnalyticsService.instance) {
            AnalyticsService.instance = new AnalyticsService();
        }
        return AnalyticsService.instance;
    }

    public initAnalytics(): void {}
    public trackAppOpen(): void {}
    public trackAppClose(): void {}
    public trackAssistantStart(): void {}
    public trackAssistantStop(): void {}
    public trackModeSelected(_mode: AssistantMode): void {}
    public trackModelUsed(_payload: Record<string, any>): void {}
    public trackCopyAnswer(): void {}
    public trackCommandExecuted(_commandType: string): void {}
    public trackConversationStarted(): void {}
    public trackCalendarConnected(): void {}
    public trackMeetingStarted(): void {}
    public trackMeetingEnded(): void {}
    public trackPdfExported(): void {}
}

export const analytics = AnalyticsService.getInstance();
