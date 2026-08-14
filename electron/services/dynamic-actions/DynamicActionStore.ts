import { DynamicAction, ActionStatus } from './DynamicAction';

export class DynamicActionStore {
    private actions: Map<string, DynamicAction> = new Map();

    addAction(action: DynamicAction): void {
        this.actions.set(action.id, action);
    }

    updateStatus(id: string, status: ActionStatus): void {
        const action = this.actions.get(id);
        if (action) {
            action.status = status;
        }
    }

    getActiveActions(sessionId: string): DynamicAction[] {
        const now = Date.now();
        return Array.from(this.actions.values()).filter(
            (action) =>
                action.sessionId === sessionId &&
                action.status !== 'expired' &&
                action.status !== 'completed' &&
                action.status !== 'dismissed' &&
                (!action.expiresAt || action.expiresAt > now)
        );
    }

    expireStaleActions(sessionId: string, maxAgeMs: number): void {
        const now = Date.now();
        const cutoff = now - maxAgeMs;
        for (const action of this.actions.values()) {
            if (
                action.sessionId === sessionId &&
                action.createdAt < cutoff &&
                action.status === 'candidate'
            ) {
                action.status = 'expired';
            }
        }
    }

    deduplicate(newAction: DynamicAction, windowMs: number = 120000): DynamicAction | null {
        const now = Date.now();
        const windowStart = now - windowMs;

        for (const existing of this.actions.values()) {
            if (
                existing.sessionId === newAction.sessionId &&
                existing.modeId === newAction.modeId &&
                existing.type === newAction.type &&
                existing.status !== 'expired' &&
                existing.status !== 'dismissed' &&
                existing.createdAt > windowStart
            ) {
                return null; // Suppress duplicate
            }
        }

        return newAction;
    }

    getAction(id: string): DynamicAction | undefined {
        return this.actions.get(id);
    }

    getAllActions(sessionId: string): DynamicAction[] {
        return Array.from(this.actions.values()).filter(
            (action) => action.sessionId === sessionId
        );
    }
}