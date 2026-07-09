import {
  logManualProfileRoute,
  profileFactsReady,
  selectManualProfileEvidence,
  type ManualProfileRouteLog,
  type ManualProfileRouteResult,
  type ManualProfileSource,
  type StructuredJobFacts,
  type StructuredProfileFacts,
} from './manualProfileIntelligence';
import type { AnswerType } from './AnswerPlanner';

type MaybeStructured<T> = T | null | undefined;

interface StructuredDocument<T> {
  structured_data?: MaybeStructured<T>;
}

export interface ProfileAnswerBackendOrchestrator {
  activeResume?: StructuredDocument<StructuredProfileFacts> | null;
  activeJD?: StructuredDocument<StructuredJobFacts> | null;
}

export interface BuildManualProfileBackendAnswerInput {
  question: string;
  orchestrator?: ProfileAnswerBackendOrchestrator | null;
  source?: ManualProfileSource;
  /** Pre-computed planner answer type — enables full JD/resume evidence for the
   * JD-source and resume+JD shapes (Stage 4/5). */
  answerType?: AnswerType;
}

export interface BuildManualProfileBackendAnswerResult {
  route: ManualProfileRouteResult | null;
  routeLog: ManualProfileRouteLog;
  profileFactsReady: boolean;
}

const activeResumeFacts = (
  orchestrator?: ProfileAnswerBackendOrchestrator | null,
): MaybeStructured<StructuredProfileFacts> => orchestrator?.activeResume?.structured_data ?? null;

const activeJobFacts = (
  orchestrator?: ProfileAnswerBackendOrchestrator | null,
): MaybeStructured<StructuredJobFacts> => orchestrator?.activeJD?.structured_data ?? null;

export const buildManualProfileEvidenceRoute = ({
  question,
  orchestrator,
  source = 'manual_input',
  answerType,
}: BuildManualProfileBackendAnswerInput): BuildManualProfileBackendAnswerResult => {
  const profile = activeResumeFacts(orchestrator);
  const jobDescription = activeJobFacts(orchestrator);
  const ready = profileFactsReady(profile);
  const route = selectManualProfileEvidence({
    question,
    profile,
    jobDescription,
    source,
    answerType,
  });

  return {
    route,
    routeLog: logManualProfileRoute({
      source,
      question,
      route,
      profileFactsReady: ready,
    }),
    profileFactsReady: ready,
  };
};

/** @deprecated Full-JIT policy: use buildManualProfileEvidenceRoute. */
export const buildManualProfileBackendAnswer = buildManualProfileEvidenceRoute;
