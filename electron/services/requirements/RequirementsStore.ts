import type { LiveRequirement, ExtractedRequirementCandidate, RequirementEvidence } from './LiveRequirement';
import { isDuplicateRequirement, normalizeRequirementText } from './requirementDedup';

export class RequirementsStore {
    private items: LiveRequirement[] = [];
    private archived: LiveRequirement[] = [];

    getVisible(): LiveRequirement[] {
        return this.items.filter((r) => r.status === 'candidate' || r.status === 'accepted');
    }

    getAcceptedTexts(): string[] {
        return this.items
            .filter((r) => r.status === 'accepted')
            .map((r) => r.text);
    }

    getAll(): LiveRequirement[] {
        return [...this.items];
    }

    getArchived(): LiveRequirement[] {
        return [...this.archived];
    }

    addCandidates(
        candidates: ExtractedRequirementCandidate[],
        evidence: Omit<RequirementEvidence, 'quote'>,
    ): LiveRequirement[] {
        const added: LiveRequirement[] = [];
        const existingTexts = [
            ...this.items.map((r) => r.text),
            ...this.archived.filter((r) => r.status === 'accepted').map((r) => r.text),
        ];

        for (const c of candidates) {
            const text = c.text?.trim();
            if (!text || text.length < 3) continue;

            const dup = existingTexts.some((t) => isDuplicateRequirement(t, text));
            if (dup) continue;

            const item: LiveRequirement = {
                id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                text,
                status: 'candidate',
                source: 'extracted',
                evidence: {
                    speaker: evidence.speaker,
                    quote: c.quote?.trim() || text,
                    timestamp: evidence.timestamp,
                },
                confidence: Math.max(0, Math.min(1, c.confidence ?? 0.7)),
                createdAt: Date.now(),
            };
            this.items.push(item);
            existingTexts.push(text);
            added.push(item);
        }
        return added;
    }

    accept(id: string, activeProblemStatement?: string | null): LiveRequirement | null {
        const item = this.items.find((r) => r.id === id);
        if (!item || item.status === 'dismissed') return null;
        item.status = 'accepted';
        item.acceptedAt = Date.now();
        item.problemStatementAtAccept = activeProblemStatement ?? undefined;
        return item;
    }

    dismiss(id: string): LiveRequirement | null {
        const idx = this.items.findIndex((r) => r.id === id);
        if (idx < 0) return null;
        const item = this.items[idx];
        item.status = 'dismissed';
        this.items.splice(idx, 1);
        return item;
    }

    /** Archive accepted requirements when active problem changes (Q2 transition). */
    archiveForProblemChange(): void {
        const toArchive = this.items.filter((r) => r.status === 'accepted' || r.status === 'candidate');
        if (toArchive.length > 0) {
            this.archived.push(...toArchive);
        }
        this.items = [];
    }

    clear(): void {
        this.items = [];
        this.archived = [];
    }

    /** Known texts for extractor prompt (accepted + dismissed + candidates). */
    getKnownTexts(): string[] {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const r of [...this.items, ...this.archived]) {
            const n = normalizeRequirementText(r.text);
            if (!seen.has(n)) {
                seen.add(n);
                out.push(r.text);
            }
        }
        return out;
    }
}
