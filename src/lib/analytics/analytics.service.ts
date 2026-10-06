// GA4 Analytics via manual gtag.js injection
// Works in Electron by dynamically loading the gtag script into the renderer DOM
// Only requires the public Measurement ID — no API secrets needed

import { answerFailureCause } from '../funnel/answerFailure.mjs';

// --- Types ---

export type ModelProviderType = 'cloud' | 'local';

export type AssistantMode = 'launcher' | 'overlay' | 'undetectable' | string;

export type AnalyticsEventName =
    // App Lifecycle
    | 'app_opened'
    | 'app_closed'
    | 'first_launch'
    // Feature Usage
    | 'assistant_started'
    | 'assistant_stopped'
    | 'mode_selected'
    | 'copy_answer_clicked'
    | 'calendar_connected'
    | 'pdf_exported'
    // Meeting Lifecycle
    | 'meeting_started'
    | 'meeting_ended'
    // Model Usage
    | 'model_used'
    // Session
    | 'session_duration'
    // Engagement
    | 'command_executed'
    | 'conversation_started';

interface ModelUsedPayload {
    model_name: string;
    provider_type: ModelProviderType;
    latency_ms: number;
    tokens_used?: number;
}

interface SessionDurationPayload {
    duration_seconds: number;
    assistant_active_seconds?: number;
    idle_seconds?: number;
}

// --- Configuration ---

const GA4_MEASUREMENT_ID = "G-494RMJ2G6E";
const APP_VERSION = "1.1.3";

// Extend window to include gtag/dataLayer
declare global {
    interface Window {
        dataLayer: any[];
        gtag: (...args: any[]) => void;
    }
}

// --- Provider Detection ---

/** Detect if a model is running locally (Ollama) or in the cloud */
export function detectProviderType(modelName: string): ModelProviderType {
    const lower = modelName.toLowerCase();
    // Ollama / local model patterns
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
    // Cloud models (Gemini, GPT, Claude, Groq)
    return 'cloud';
}

// --- First-party funnel ---
//
// The same moments, reported to Natively's own funnel as "this feature was used
// today" (src/lib/funnel). The main process allows one event per feature per
// day and nothing but the feature's name, and does nothing at all when Usage
// statistics is off. Deliberately independent of whether the GA4 script above
// loaded: a blocked script must not hide what people use.

type FunnelFeature =
    | 'answer' | 'follow_up' | 'recap' | 'suggest_questions' | 'clarify' | 'brainstorm'
    | 'chat' | 'search' | 'copy_answer' | 'pdf_export' | 'calendar_connect';

/** The funnel's name for a command, or null for commands that are navigation rather than use. */
export function funnelFeatureForCommand(commandType: string): FunnelFeature | null {
    if (commandType === 'what_to_say') return 'answer';
    if (commandType.startsWith('follow_up_')) return 'follow_up';
    if (commandType === 'recap' || commandType === 'suggest_questions' || commandType === 'clarify' || commandType === 'brainstorm') return commandType;
    if (commandType === 'ai_query_search' || commandType === 'literal_search') return 'search';
    return null;
}

/**
 * An answer was asked for and did not come: report the kind of cause, and only
 * that (src/lib/funnel/answerFailure.mjs). A stopped or cut-short answer is not
 * a failure and reports nothing. The main process allows one per cause per day,
 * so calling this twice for one failure (a state updater that runs again)
 * changes nothing.
 */
export function reportAnswerFailed(failure: Parameters<typeof answerFailureCause>[0]): void {
    try {
        const cause = answerFailureCause(failure);
        if (!cause) return;
        (window as any).electronAPI?.funnelTrack?.('answer_failed', { cause })?.catch?.(() => { });
    } catch { /* never into the answer path */ }
}

function reportFeatureUsed(feature: FunnelFeature | null): void {
    if (!feature) return;
    try {
        (window as any).electronAPI?.funnelTrack?.('feature_used', { feature })?.catch?.(() => { });
    } catch { /* never into the feature */ }
}

// --- Service ---

class AnalyticsService {
    private static instance: AnalyticsService;
    private initialized = false;
    private undetectable = false;
    private sessionStartTime: number = Date.now();
    private assistantStartTime: number | null = null;
    private totalAssistantDuration: number = 0;

    private constructor() { }

    public static getInstance(): AnalyticsService {
        if (!AnalyticsService.instance) {
            AnalyticsService.instance = new AnalyticsService();
        }
        return AnalyticsService.instance;
    }

    public setUndetectable(isUndetectable: boolean): void {
        this.undetectable = isUndetectable;
    }

    public initAnalytics(): void {
        if (this.initialized || this.undetectable) return;

        try {
            // 1. Initialize dataLayer
            window.dataLayer = window.dataLayer || [];
            window.gtag = function () {
                window.dataLayer.push(arguments);
            };
            window.gtag('js', new Date());

            // 2. Configure GA4 with privacy settings
            window.gtag('config', GA4_MEASUREMENT_ID, {
                anonymize_ip: true,
                send_page_view: false,
                cookie_flags: 'SameSite=None;Secure',
                app_version: APP_VERSION,
            });

            // 3. Inject the gtag.js script
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
            script.onerror = () => {
                console.warn("[Analytics] Failed to load gtag.js — analytics disabled.");
            };
            document.head.appendChild(script);

            this.initialized = true;
            console.log(`[Analytics] Initialized (v${APP_VERSION}) via gtag.js injection.`);
        } catch (error) {
            console.warn("[Analytics] Initialization failed:", error);
        }
    }

    // --- Tracking Methods ---

    public trackAppOpen(): void {
        if (!this.initialized || this.undetectable) return;

        this.trackEvent('app_opened');

        const hasLaunched = localStorage.getItem('natively_has_launched');
        if (!hasLaunched) {
            this.trackEvent('first_launch');
            localStorage.setItem('natively_has_launched', 'true');
        }
    }

    public trackAppClose(): void {
        if (!this.initialized || this.undetectable) return;

        this.trackSessionDuration();
        this.trackEvent('app_closed');
    }

    public trackAssistantStart(): void {
        if (!this.initialized || this.undetectable) return;

        this.assistantStartTime = Date.now();
        this.trackEvent('assistant_started');
    }

    public trackAssistantStop(): void {
        if (!this.initialized || this.undetectable) return;

        if (this.assistantStartTime) {
            const duration = (Date.now() - this.assistantStartTime) / 1000;
            this.totalAssistantDuration += duration;
            this.assistantStartTime = null;
        }
        this.trackEvent('assistant_stopped');
    }

    public trackModeSelected(mode: AssistantMode): void {
        if (!this.initialized || this.undetectable) return;

        this.trackEvent('mode_selected', { mode });
    }

    public trackModelUsed(payload: ModelUsedPayload): void {
        if (!this.initialized || this.undetectable) return;

        this.trackEvent('model_used', payload);
    }

    public trackCopyAnswer(): void {
        reportFeatureUsed('copy_answer');
        if (!this.initialized || this.undetectable) return;
        this.trackEvent('copy_answer_clicked');
    }

    /** A typed question was sent. This, not a session starting, is "chat was used". */
    public trackChatQuestionSent(): void {
        reportFeatureUsed('chat');
    }

    public trackCommandExecuted(commandType: string): void {
        reportFeatureUsed(funnelFeatureForCommand(commandType));
        if (!this.initialized || this.undetectable) return;
        this.trackEvent('command_executed', { command_type: commandType });
    }

    public trackConversationStarted(): void {
        // Not "chat was used": this runs whenever a session starts, so until
        // 2026-10-06 every meeting reported a chat it never had.
        if (!this.initialized || this.undetectable) return;
        this.trackEvent('conversation_started');
    }

    public trackCalendarConnected(): void {
        reportFeatureUsed('calendar_connect');
        if (!this.initialized || this.undetectable) return;
        this.trackEvent('calendar_connected');
    }

    public trackMeetingStarted(): void {
        if (!this.initialized || this.undetectable) return;
        this.trackEvent('meeting_started');
    }

    public trackMeetingEnded(): void {
        if (!this.initialized || this.undetectable) return;
        this.trackEvent('meeting_ended');
    }

    public trackPdfExported(): void {
        reportFeatureUsed('pdf_export');
        if (!this.initialized || this.undetectable) return;
        this.trackEvent('pdf_exported');
    }

    private trackSessionDuration(): void {
        const totalDuration = (Date.now() - this.sessionStartTime) / 1000;

        let currentAssistantDuration = this.totalAssistantDuration;
        if (this.assistantStartTime) {
            currentAssistantDuration += (Date.now() - this.assistantStartTime) / 1000;
        }

        const payload: SessionDurationPayload = {
            duration_seconds: Math.round(totalDuration),
            assistant_active_seconds: Math.round(currentAssistantDuration),
            idle_seconds: Math.round(totalDuration - currentAssistantDuration)
        };

        this.trackEvent('session_duration', payload);
    }

    // --- Core Event Sender ---

    private trackEvent(eventName: AnalyticsEventName, payload?: Record<string, any>): void {
        if (import.meta.env.DEV) {
            console.log(`[Analytics] ${eventName}`, payload);
        }

        try {
            if (typeof window.gtag === 'function') {
                window.gtag('event', eventName, {
                    app_version: APP_VERSION,
                    ...payload
                });
            }
        } catch (error) {
            console.warn("[Analytics] Failed to send event:", error);
        }
    }
}

export const analytics = AnalyticsService.getInstance();
