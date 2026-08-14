import * as crypto from 'crypto';
import { DynamicAction, EvidenceRef } from './DynamicAction';
import { DynamicActionStore } from './DynamicActionStore';
import { DynamicActionDetector, MODE_TRIGGERS } from './DynamicActionDetector';

export class DynamicActionEngine {
    private store: DynamicActionStore;
    private detector: DynamicActionDetector;

    constructor(
        store: DynamicActionStore = new DynamicActionStore(),
        detector: DynamicActionDetector = new DynamicActionDetector(MODE_TRIGGERS)
    ) {
        this.store = store;
        this.detector = detector;
    }

    detectActions(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
    }): DynamicAction[] {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = Date.now();
        const candidateActions: DynamicAction[] = [];

        // Detect triggers using regex patterns
        const matchedTriggers = this.detector.detectTriggers({ transcript, modeTemplateType });

        for (const { trigger, match, index } of matchedTriggers) {
            // Build evidence ref from transcript
            const evidenceRef: EvidenceRef = {
                source: 'transcript',
                text: transcript,
                timestamp: now,
                speaker,
            };

            // Create candidate action. Loop runs once per matched trigger
            // within a single detectActions() call, so `now` is identical for
            // every action minted here — embedding it in the id is not
            // sufficient on its own. Use a UUID for the id; `now` stays as
            // createdAt (where the shared timestamp is the correct semantic).
            const action: DynamicAction = {
                id: `action_${crypto.randomUUID()}`,
                sessionId,
                modeId,
                modeTemplateType,
                type: trigger.type,
                label: trigger.label,
                description: `Triggered by: "${match}"`,
                confidence: trigger.priority,
                priority: trigger.priority,
                evidenceRefs: [evidenceRef],
                status: 'candidate',
                createdAt: now,
                promptInstruction: trigger.promptInstruction,
                answerStyle: trigger.answerStyle,
            };

            // Check deduplication
            const deduplicatedAction = this.store.deduplicate(action);
            if (deduplicatedAction) {
                candidateActions.push(deduplicatedAction);
                this.store.addAction(deduplicatedAction);
            }
        }

        return candidateActions;
    }

    getTopActions(sessionId: string, maxAgeMs: number = 60000): DynamicAction[] {
        // Expire stale actions first
        this.store.expireStaleActions(sessionId, maxAgeMs);

        // Get active actions sorted by priority (descending)
        const activeActions = this.store.getActiveActions(sessionId);
        return activeActions
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 3);
    }

    acceptAction(actionId: string): DynamicAction | null {
        const action = this.store.getAction(actionId);
        if (action) {
            this.store.updateStatus(actionId, 'accepted');
            return action;
        }
        return null;
    }

    dismissAction(actionId: string): void {
        this.store.updateStatus(actionId, 'dismissed');
    }

    completeAction(actionId: string): void {
        this.store.updateStatus(actionId, 'completed');
    }

    getStore(): DynamicActionStore {
        return this.store;
    }

    getDetector(): DynamicActionDetector {
        return this.detector;
    }
}