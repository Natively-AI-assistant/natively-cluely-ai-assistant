export type ActionStatus = 'candidate' | 'shown' | 'accepted' | 'dismissed' | 'completed' | 'expired';

export interface EvidenceRef {
    source: 'transcript' | 'screen' | 'reference' | 'meeting_history' | 'browser_dom';
    text: string;
    timestamp?: number;
    speaker?: string;
    fileId?: string;
    chunkId?: string;
}

export interface DynamicAction {
    id: string;
    sessionId: string;
    modeId: string;
    modeTemplateType: string;
    type: string;  // e.g., 'pricing_objection', 'competitor_mention', 'coding_question'
    label: string;  // e.g., "Handle pricing objection"
    description?: string;
    confidence: number;
    priority: number;
    evidenceRefs: EvidenceRef[];
    status: ActionStatus;
    createdAt: number;
    expiresAt?: number;
    promptInstruction: string;
    answerStyle?: {
        maxWords: number;
        format: 'bullets' | 'short_script' | 'code' | 'checklist' | 'summary';
        tone: string;
    };
}