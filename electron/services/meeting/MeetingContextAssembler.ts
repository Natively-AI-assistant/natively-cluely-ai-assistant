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
import { cleanUserNotes, cleanVocabulary, userNoteHeadings, type NotesPromptContext } from './meetingNotesContext';

export interface AssembleSummaryResult {
  summary: MeetingSummaryV3 | null;
  meta: MeetingSummaryTelemetryMeta;
  /** The meeting's name as the overview call wrote it, unvetted (MeetingPersistence
   *  vets it). Absent when that call did not run or wrote none. */
  proposedTitle?: string;
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
  // followUpDraftV2 flag + post_call_summary scope. No caller sets it since 2026-10-18:
  // a follow-up is written only when the user asks (MeetingPersistence.regenerateFollowUpDraft).
  generateFollowUpDraft?: boolean;
  followUpTone?: FollowUpTone;
  // The user's own voice for the re-draft ('your_style'), when the mode has samples.
  followUpStyleGuide?: string;
  // The user's own name for the draft's sign-off (Google account behind Calendar sync).
  followUpSenderName?: string;
  // When true, run the constrained LLM Summary polish (#1). Gated by the caller on the
  // meetingSummaryLlmPolish flag + post_call_summary scope. Always falls back to the
  // deterministic summary, so it can never make the summary worse or block completion.
  polishSummary?: boolean;
  // ── What the notes know besides the transcript (2026-10-15). All optional; with
  // none of them the prompts are what they were. ──
  /** meetingNotesContext.formatMeetingPeopleBlock: invite, people, date, the user. */
  meetingContextBlock?: string;
  /** recurringMeetings.formatLastTimeBlock: the previous meeting of the series. */
  lastTimeBlock?: string;
  /** The user's own notes typed during the meeting. The notes are built around them. */
  userNotes?: string;
  /** The user's spelling list for names and terms. */
  vocabulary?: string[];
  /** screenShareNotes.formatSharedScreensBlock: what others shared on screen. */
  sharedScreensBlock?: string;
}

/** The NotesPromptContext for these params, or null when they carry none. */
export function notesContextFromParams(params: Pick<AssembleSummaryParams, 'meetingContextBlock' | 'lastTimeBlock' | 'userNotes' | 'vocabulary' | 'sharedScreensBlock'>): NotesPromptContext | null {
  const ctx: NotesPromptContext = {
    ...(params.meetingContextBlock?.trim() ? { meetingContextBlock: params.meetingContextBlock.trim() } : {}),
    ...(params.lastTimeBlock?.trim() ? { lastTimeBlock: params.lastTimeBlock.trim() } : {}),
    ...(params.sharedScreensBlock?.trim() ? { sharedScreensBlock: params.sharedScreensBlock.trim() } : {}),
  };
  const notes = cleanUserNotes(params.userNotes);
  if (notes) ctx.userNotes = notes;
  const vocabulary = cleanVocabulary(params.vocabulary);
  if (vocabulary.length) ctx.vocabulary = vocabulary;
  return Object.keys(ctx).length > 0 ? ctx : null;
}

/**
 * The note sections with the user's own headings first. A heading the user typed
 * ("# Pricing") becomes a section the notes fill, so their structure survives;
 * one that matches a mode section by name is that section, not a second one.
 */
export function sectionsWithUserHeadings(modeSections: MeetingModeSectionInput[], userNotes?: string): MeetingModeSectionInput[] {
  const headings = userNoteHeadings(userNotes);
  if (headings.length === 0) return modeSections;
  const existing = new Set(modeSections.map(s => s.title.trim().toLowerCase()));
  const fromUser = headings
    .filter(h => !existing.has(h.toLowerCase()))
    .map(h => ({
      title: h,
      description: `The user's own heading from their notes. Expand the points they wrote under "${h}" with the detail the transcript gives, and add other findings that belong under it. Nothing the transcript does not support.`,
    }));
  return [...fromUser, ...modeSections];
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

      const notesContext = notesContextFromParams(params);
      const noteSections = sectionsWithUserHeadings(params.modeNoteSections || [], notesContext?.userNotes);

      const chunks = this.chunker.chunk(normalized);
      chunkCount = chunks.length;
      strategy = chunks.length > 1 ? 'map_reduce' : 'direct';

      params.onStatusUpdate?.('summarizing_chunks');
      const atoms = await mapWithConcurrency(chunks, 3, chunk => this.generator.generateAtoms({
        chunk,
        totalChunks: chunks.length,
        modeTemplateType: params.modeTemplateType,
        modeNoteSections: noteSections,
        modeContextBlock: params.modeContextBlock,
        notesContext,
        meetingTotalChars: normalized.totalChars,
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
        modeNoteSections: noteSections,
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
      // rejection the deterministic versions are kept. The overview call also names the
      // meeting, so there is no title call afterwards (unless the polish is off).
      let proposedTitle: string | undefined;
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
            polisher.polishOverview({ ...baseInputs, briefs, topics, totalTokensEstimate: normalized.totalTokensEstimate, notesContext }),
          ]);
          if (polished && polished.length > 0) summary.tldr = polished;
          if (polishedOverview.overview) summary.overview = polishedOverview.overview;
          if (polishedOverview.title) proposedTitle = polishedOverview.title;
        } catch (e) {
          console.warn('[MeetingContextAssembler] summary polish failed (non-fatal):', (e as Error)?.message);
        }
      } else if (summary.tldr.length > 0 || validAtoms.length > 0) {
        // Polish switched off: no overview call to carry the name, so one small call
        // writes the title alone (the request the old separate title call made).
        try {
          const named = await new SummaryPolisher(this.llmHelper).nameMeeting({
            deterministicSummary: summary.tldr,
            decisions: summary.decisions,
            actionItems: summary.actionItems,
            risks: summary.risks,
            sections: summary.sections,
            mode: params.modeTemplateType,
            briefs: validAtoms.map(a => a.brief).filter(Boolean),
            topics: summary.topics || [],
            notesContext,
          });
          if (named) proposedTitle = named;
        } catch (e) {
          console.warn('[MeetingContextAssembler] meeting naming failed (non-fatal):', (e as Error)?.message);
        }
      }

      // Phase 8 — LLM follow-up draft (note-content only, never transcript).
      if (params.generateFollowUpDraft) {
        try {
          const draft = await new FollowUpDraftGenerator(this.llmHelper).generate({
            summary,
            mode: params.modeTemplateType,
            tone: params.followUpTone,
            senderName: params.followUpSenderName,
            styleGuide: params.followUpStyleGuide,
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
        ...(proposedTitle ? { proposedTitle } : {}),
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
