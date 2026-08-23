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
  /**
   * Capability-scoped source grant from the canonical turn decision. When
   * supplied, the legacy selector receives only the source objects the user
   * is entitled to, and its result is filtered defensively by the same set
   * before returning. Without this filter, a JD-only turn could still
   * receive résumé items from selectManualProfileEvidence (the historical
   * leak), and `_attr.structured_resume_used = route.items.some(...)`
   * would over-report.
   */
  allowedSourceKinds?: string[];
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
  allowedSourceKinds,
}: BuildManualProfileBackendAnswerInput): BuildManualProfileBackendAnswerResult => {
  const availableProfile = activeResumeFacts(orchestrator);
  const availableJobDescription = activeJobFacts(orchestrator);
  // Withhold an unauthorized source family BEFORE the selector sees it.
  // This is the architecturally correct placement — filter at the boundary,
  // not after. With no filter the legacy fallback path is preserved.
  const allowed = allowedSourceKinds ? new Set(allowedSourceKinds) : null;
  const allowsResume = !allowed || allowed.has('profile_resume') || allowed.has('projects');
  const allowsJd = !allowed || allowed.has('profile_jd');
  const profile = allowsResume ? availableProfile : null;
  const jobDescription = allowsJd ? availableJobDescription : null;
  const ready = profileFactsReady(profile);
  const routeSelection = selectManualProfileEvidence({
    question,
    profile,
    jobDescription,
    source,
    answerType,
  });
  // Defensive post-filter on the selection's emitted items — protects against
  // a future selector emitter that adds source kinds without honoring the
  // pre-filter.
  const route = routeSelection && allowed
    ? (() => {
      const items = routeSelection.items.filter((item) => allowed.has(item.sourceKind));
      if (items.length === 0) return null;
      return {
        ...routeSelection,
        items,
        selectedFacts: routeSelection.selectedFacts.filter((item) => allowed.has(item.sourceKind)),
        checkedSources: routeSelection.checkedSources.filter((kind) => allowed.has(kind)),
        sourceRefs: Array.from(new Set(items.map((item) => (item as any).sourceRef).filter(Boolean) as string[])),
      };
    })()
    : routeSelection;

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
