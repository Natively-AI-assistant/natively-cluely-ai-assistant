export type RequirementStatus = 'candidate' | 'accepted' | 'dismissed';

export type RequirementSource = 'extracted' | 'manual';

export interface RequirementEvidence {
    speaker: string;
    quote: string;
    timestamp: number;
}

export interface LiveRequirement {
    id: string;
    text: string;
    status: RequirementStatus;
    source: RequirementSource;
    evidence: RequirementEvidence;
    confidence: number;
    createdAt: number;
    acceptedAt?: number;
    problemStatementAtAccept?: string;
}

export interface ExtractedRequirementCandidate {
    text: string;
    quote: string;
    confidence: number;
}
