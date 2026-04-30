import { EventEmitter } from 'events';

/**
 * Session-scoped, in-memory store for free-form meeting context the user pastes
 * or types during a live meeting. The string is injected into LLM calls
 * alongside any active-mode context (resume/JD/notes) at LLMHelper.streamChat,
 * inside a `<live_meeting_context source="user">` block.
 *
 * Lifetime: cleared on session-reset / meeting end. Process-wide singleton, no
 * disk persistence — restarting the app or ending the meeting drops it.
 */
export class MeetingContextStore {
    public static readonly MAX_CHARS = 15_000;
    private static instance: MeetingContextStore | null = null;

    private context = '';
    private readonly emitter = new EventEmitter();

    private constructor() {}

    public static getInstance(): MeetingContextStore {
        if (!MeetingContextStore.instance) {
            MeetingContextStore.instance = new MeetingContextStore();
        }
        return MeetingContextStore.instance;
    }

    public get(): string {
        return this.context;
    }

    public hasContext(): boolean {
        return this.context.trim().length > 0;
    }

    public set(text: string): void {
        const next = typeof text === 'string'
            ? text.slice(0, MeetingContextStore.MAX_CHARS)
            : '';
        if (next === this.context) return;
        this.context = next;
        this.emitChanged();
    }

    public clear(): void {
        if (!this.context) return;
        this.context = '';
        this.emitChanged();
    }

    public buildContextBlock(): string {
        if (!this.hasContext()) return '';
        return `<live_meeting_context source="user">\n${this.context.trim()}\n</live_meeting_context>`;
    }

    public on(event: 'changed', cb: (info: { chars: number; hasContext: boolean }) => void): () => void {
        this.emitter.on(event, cb);
        return () => this.emitter.off(event, cb);
    }

    private emitChanged(): void {
        this.emitter.emit('changed', {
            chars: this.context.length,
            hasContext: this.hasContext(),
        });
    }
}
