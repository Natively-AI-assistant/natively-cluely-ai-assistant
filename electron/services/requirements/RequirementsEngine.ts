import { EventEmitter } from 'events';
import type { SessionTracker } from '../../SessionTracker';
import type { TranscriptSegment } from '../../SessionTracker';
import { LLMHelper } from '../../LLMHelper';
import { buildInterviewContext } from '../context/InterviewContextBuilder';
import { RequirementsStore } from './RequirementsStore';
import { RequirementExtractorLLM } from './RequirementExtractorLLM';
import type { LiveRequirement } from './LiveRequirement';

export interface RequirementsEngineEvents {
    requirements_updated: (requirements: LiveRequirement[]) => void;
}

export class RequirementsEngine extends EventEmitter {
    private store = new RequirementsStore();
    private extractor: RequirementExtractorLLM;
    private session: SessionTracker;
    private enabled = false;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private finalsSinceExtract = 0;
    private extractInFlight = false;
    private lastActiveProblemStatement: string | null = null;

    static readonly DEBOUNCE_MS = 20_000;
    static readonly MIN_FINALS_BEFORE_EXTRACT = 2;

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.extractor = new RequirementExtractorLLM(llmHelper);
        this.session = session;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.cancelDebounce();
            this.clear();
            return;
        }
        this.lastActiveProblemStatement = this.session.getActiveProblem()?.statement
            ?? this.session.getDetectedCodingQuestion().question
            ?? null;
    }

    getStore(): RequirementsStore {
        return this.store;
    }

    onFinalSegment(segment: TranscriptSegment): void {
        if (!this.enabled) return;
        if (!segment.final) return;

        const problem = this.session.getActiveProblem()?.statement
            ?? this.session.getDetectedCodingQuestion().question;
        this.handleProblemTransition(problem ?? null);

        this.finalsSinceExtract += 1;
        this.scheduleExtract();
    }

    accept(id: string): LiveRequirement | null {
        const problem = this.session.getActiveProblem()?.statement
            ?? this.session.getDetectedCodingQuestion().question;
        const item = this.store.accept(id, problem);
        if (item) {
            this.syncAcceptedToActiveProblem();
            this.emitUpdate();
        }
        return item;
    }

    dismiss(id: string): LiveRequirement | null {
        const item = this.store.dismiss(id);
        if (item) {
            this.syncAcceptedToActiveProblem();
            this.emitUpdate();
        }
        return item;
    }

    getVisible(): LiveRequirement[] {
        return this.store.getVisible();
    }

    clear(): void {
        this.cancelDebounce();
        this.store.clear();
        this.finalsSinceExtract = 0;
        this.lastActiveProblemStatement = null;
        this.emitUpdate();
    }

    private handleProblemTransition(problem: string | null): void {
        if (!problem?.trim()) return;
        const trimmed = problem.trim();
        if (this.lastActiveProblemStatement !== null && trimmed !== this.lastActiveProblemStatement) {
            this.store.archiveForProblemChange();
            this.syncAcceptedToActiveProblem();
            this.emitUpdate();
        }
        this.lastActiveProblemStatement = trimmed;
    }

    private syncAcceptedToActiveProblem(): void {
        const accepted = this.store.getAcceptedTexts();
        const active = this.session.getActiveProblem();
        if (active) {
            this.session.updateActiveProblemConstraints(accepted);
        } else {
            const coding = this.session.getDetectedCodingQuestion();
            if (coding.question) {
                this.session.ensureActiveProblemWithConstraints(coding.question, coding.source ?? 'transcript', accepted);
            }
        }
    }

    private scheduleExtract(): void {
        this.cancelDebounce();
        this.debounceTimer = setTimeout(() => {
            void this.runExtractTick();
        }, RequirementsEngine.DEBOUNCE_MS);
    }

    private cancelDebounce(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private async runExtractTick(): Promise<void> {
        if (!this.enabled || this.extractInFlight) return;
        if (this.finalsSinceExtract < RequirementsEngine.MIN_FINALS_BEFORE_EXTRACT) return;

        const problem = this.session.getActiveProblem()?.statement
            ?? this.session.getDetectedCodingQuestion().question;
        if (!problem?.trim()) return;

        this.extractInFlight = true;
        try {
            const ctx = buildInterviewContext(this.session);
            const added = await this.extractor.extract({
                recencyTranscript: ctx.recencyTranscript,
                activeProblemStatement: problem,
                knownRequirements: this.store.getKnownTexts(),
            });

            if (added.length === 0) return;

            const lastSeg = this.session.getFullTranscript().slice(-1)[0];
            const newItems = this.store.addCandidates(added, {
                speaker: lastSeg?.speaker ?? 'interviewer',
                timestamp: lastSeg?.timestamp ?? Date.now(),
            });

            if (newItems.length > 0) {
                this.finalsSinceExtract = 0;
                this.emitUpdate();
            }
        } finally {
            this.extractInFlight = false;
        }
    }

    private emitUpdate(): void {
        this.emit('requirements_updated', this.store.getVisible());
    }
}
