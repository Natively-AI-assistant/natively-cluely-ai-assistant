import type { LLMHelper } from '../../LLMHelper';
import type { TranscriptSegment } from '../../SessionTracker';
import type { ChunkMeetingAtoms, MeetingModeSectionInput, MeetingSummaryTelemetryMeta, MeetingSummaryV3, SummaryStatus } from './types';
import type { MeetingSummaryModeMeta, SummaryStrategy } from './MeetingSummaryV3';
import { ChunkSummaryGenerator } from './ChunkSummaryGenerator';
import { MeetingSummaryReducer } from './MeetingSummaryReducer';
import { MeetingSummarySchemaValidator } from './MeetingSummarySchemaValidator';
import { MeetingSummaryStrategySelector } from './MeetingSummaryStrategySelector';
import { TranscriptChunker } from './TranscriptChunker';
import { TranscriptNormalizer } from './TranscriptNormalizer';
import { generateBuiltInRecipes } from './MeetingRecipes';
import { FollowUpDraftGenerator } from './FollowUpDraftGenerator';
import { SummaryPolisher } from './SummaryPolisher';
import type { FollowUpTone } from './MeetingSummaryV3';

export interface AssembleSummaryResult {
  summary: MeetingSummaryV3 | null;
  meta: MeetingSummaryTelemetryMeta;
}

export interface AssembleSummaryParams {
  transcript: TranscriptSegment[];
  title?: string;
  modeTemplateType?: string | null;
  modeNoteSections?: MeetingModeSectionInput[];
  modeContextBlock?: string;
  modeMeta?: MeetingSummaryModeMeta;
  onStatusUpdate?: (status: SummaryStatus) => void;
  // ISO timestamp the post-call processing started (for generation.startedAt).
  startedAtIso?: string;
  startedAtMs?: number;
  // When true, generate an LLM-based follow-up draft (Phase 8). Gated by the caller on the
  // followUpDraftV2 flag + post_call_summary scope.
  generateFollowUpDraft?: boolean;
  followUpTone?: FollowUpTone;
  // When true, run the constrained LLM Summary polish (#1). Gated by the caller on the
  // meetingSummaryLlmPolish flag + post_call_summary scope. Always falls back to the
  // deterministic summary, so it can never make the summary worse or block completion.
  polishSummary?: boolean;
}

export class MeetingContextAssembler {
  private readonly normalizer = new TranscriptNormalizer();
  private readonly chunker = new TranscriptChunker();
  private readonly generator: ChunkSummaryGenerator;
  private readonly reducer = new MeetingSummaryReducer();
  private readonly validator = new MeetingSummarySchemaValidator();
  private readonly strategySelector = new MeetingSummaryStrategySelector();

  constructor(private readonly llmHelper: LLMHelper) {
    this.generator = new ChunkSummaryGenerator(llmHelper);
  }

  async assembleSummary(params: AssembleSummaryParams): Promise<AssembleSummaryResult> {
    const startedAtMs = params.startedAtMs ?? 0;
    const startedAtIso = params.startedAtIso || new Date(0).toISOString();
    let chunkCount = 0;
    let strategy: SummaryStrategy = 'fallback';

    const failMeta = (): MeetingSummaryTelemetryMeta => ({ chunkCount, v3Used: false, transcriptCoveragePercent: 0, strategy });

    try {
      params.onStatusUpdate?.('chunking');
      const normalized = this.normalizer.normalize(params.transcript);
      if (normalized.segments.length < 3) {
        return { summary: null, meta: failMeta() };
      }

      // The selector's hint is recorded for telemetry, but the executed strategy is derived
      // from the actual chunk count: 1 chunk = direct single pass, >1 = map_reduce.
      // long_context single-pass is not yet implemented and degrades to chunk/reduce
      // (documented in meeting-notes-v3-design.md §4).
      this.strategySelector.select(normalized);

      const chunks = this.chunker.chunk(normalized);
      chunkCount = chunks.length;
      strategy = chunks.length > 1 ? 'map_reduce' : 'direct';

      params.onStatusUpdate?.('summarizing_chunks');
      const atoms = await mapWithConcurrency(chunks, 3, chunk => this.generator.generateAtoms({
        chunk,
        totalChunks: chunks.length,
        modeTemplateType: params.modeTemplateType,
        modeNoteSections: params.modeNoteSections,
        modeContextBlock: params.modeContextBlock,
      }));
      const validAtoms = atoms.filter((atom): atom is ChunkMeetingAtoms => atom !== null);
      const droppedChunks = chunks.length - validAtoms.length;
      if (validAtoms.length === 0) {
        strategy = 'fallback';
        return { summary: null, meta: failMeta() };
      }

      params.onStatusUpdate?.('reducing');
      const generationWarnings: string[] = [];
      if (droppedChunks > 0) generationWarnings.push(`${droppedChunks} of ${chunks.length} chunk(s) failed extraction and were skipped.`);

      const reduced = this.reducer.reduce({
        title: params.title,
        atoms: validAtoms,
        normalizedTranscript: normalized,
        modeTemplateType: params.modeTemplateType,
        modeNoteSections: params.modeNoteSections,
        transcriptCoverage: normalized.totalChars > 0 ? Math.min(1, chunks.reduce((sum, chunk) => sum + chunk.charCount, 0) / normalized.totalChars) : 0,
        mode: params.modeMeta,
        generation: {
          strategy,
          startedAt: startedAtIso,
          chunkCount: chunks.length,
          warnings: generationWarnings,
        },
      });
      reduced.recipes = generateBuiltInRecipes(reduced, params.modeTemplateType);

      params.onStatusUpdate?.('validating');
      const summary = this.validator.validateAndRepairSummary(reduced);
      if (!summary) {
        strategy = 'fallback';
        return { summary: null, meta: failMeta() };
      }

      // #1 — Constrained LLM polish (note-content only, "no new tokens" gated). Polishes both
      // the bullet Summary (summary.tldr) and the whole-meeting Overview paragraph. On any
      // rejection the deterministic versions are kept.
      if (params.polishSummary && (summary.tldr.length > 0 || validAtoms.length > 0)) {
        try {
          const polisher = new SummaryPolisher(this.llmHelper);
          const baseInputs = {
            deterministicSummary: summary.tldr,
            decisions: summary.decisions,
            actionItems: summary.actionItems,
            risks: summary.risks,
            sections: summary.sections,
            mode: params.modeTemplateType,
          };
          // Run the bullet-summary polish and the whole-meeting overview polish in parallel.
          const briefs = validAtoms.map(a => a.brief).filter(Boolean);
          const topics = summary.topics || [];
          const [polished, polishedOverview] = await Promise.all([
            summary.tldr.length > 0 ? polisher.polish(baseInputs) : Promise.resolve(null),
            polisher.polishOverview({ ...baseInputs, briefs, topics }),
          ]);
          if (polished && polished.length > 0) summary.tldr = polished;
          if (polishedOverview) summary.overview = polishedOverview;
        } catch (e) {
          console.warn('[MeetingContextAssembler] summary polish failed (non-fatal):', (e as Error)?.message);
        }
      }

      // Phase 8 — LLM follow-up draft (note-content only, never transcript).
      if (params.generateFollowUpDraft) {
        try {
          const draft = await new FollowUpDraftGenerator(this.llmHelper).generate({
            summary,
            mode: params.modeTemplateType,
            tone: params.followUpTone,
          });
          summary.followUpDraft = draft;
        } catch (e) {
          console.warn('[MeetingContextAssembler] follow-up draft generation failed (non-fatal):', (e as Error)?.message);
        }
      }

      // Stamp completion timing on the generation block.
      if (startedAtMs) {
        const now = Date.now();
        summary.generation.completedAt = new Date(now).toISOString();
        summary.generation.durationMs = now - startedAtMs;
      }

      return {
        summary,
        meta: {
          chunkCount,
          v3Used: true,
          transcriptCoveragePercent: Math.round((summary.sourceQuality.transcriptCoverage || 0) * 100),
          strategy,
        },
      };
    } catch (error) {
      console.warn('[MeetingContextAssembler] V3 assembly failed:', (error as Error)?.message || error);
      strategy = 'fallback';
      return { summary: null, meta: failMeta() };
    }
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const count = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: count }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index]);
    }
  }));
  return out;
}
