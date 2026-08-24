import * as crypto from 'crypto';
import type {
  ActionItem,
  ChunkMeetingAtoms,
  DecisionItem,
  MeetingModeSectionInput,
  MeetingNoteSection,
  MeetingSummaryGenerationMeta,
  MeetingSummaryModeMeta,
  MeetingSummaryV3,
  NormalizedTranscript,
  NoteBlock,
  NoteBullet,
  PersonMention,
  QuestionItem,
  RiskItem,
  TimelineItem,
} from './types';
import { SECTION_BULLET_CAP } from './MeetingSummaryV3';

// ── "Next steps" suppression (2026-08-24, product decision) ───────────────────
// The labelled "Next steps" block was judged redundant in generated meeting notes
// and follow-up mail: it restates the action items that already appear in the
// Action Items block / the mode's own sections, so every artefact ended with the
// same list twice. It is switched OFF, not deleted.
//
// Flip INCLUDE_NEXT_STEPS back to true to restore it in this file. Matching
// switches (flip all four together) live in:
//   electron/services/meeting/FollowUpDraftGenerator.ts   (LLM mail prompt + inputs)
//   electron/services/post-call/PostCallWorkflow.ts        (post-call follow-up draft)
//   src/components/MeetingDetails.tsx                      (renderer, incl. already-saved notes)
export const INCLUDE_NEXT_STEPS: boolean = false;

// Note-section titles that ARE the next-steps block, across the built-in mode
// templates and user-authored sections: "Next steps", "Owners and next steps",
// "Asks / next steps", "What happens next", "Recommended next step".
export function isNextStepsSectionTitle(title: string | undefined | null): boolean {
  const t = (title || '').trim();
  if (!t) return false;
  return /next\s*steps?\b/i.test(t) || /^what\s+happens\s+next\b/i.test(t);
}

export interface ReduceParams {
  title?: string;
  atoms: ChunkMeetingAtoms[];
  normalizedTranscript: NormalizedTranscript;
  modeTemplateType?: string | null;
  modeNoteSections?: MeetingModeSectionInput[];
  transcriptCoverage?: number;
  mode?: MeetingSummaryModeMeta;
  generation?: Partial<MeetingSummaryGenerationMeta>;
}

export class MeetingSummaryReducer {
  reduce(params: ReduceParams): MeetingSummaryV3 {
    const atoms = [...params.atoms].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const decisions = assignIds(mergeSimilar(flatMap(atoms, atom => atom.decisions), 'decision')) as DecisionItem[];
    const actionItems = assignIds(mergeSimilar(flatMap(atoms, atom => [...atom.actionItems, ...(atom.deadlines || [])]), 'action')) as ActionItem[];
    const openQuestions = assignIds(mergeSimilar(flatMap(atoms, atom => atom.openQuestions), 'question')) as QuestionItem[];
    const risks = assignIds(mergeSimilar(flatMap(atoms, atom => atom.risks), 'risk')) as RiskItem[];
    const topics = dedupeStrings(flatMap(atoms, atom => atom.topics)).slice(0, 20);
    const people = mergePeople(flatMap(atoms, atom => atom.people)).slice(0, 20);
    const sectionWarnings: string[] = [];
    const sections = buildSections(params.modeNoteSections || [], atoms, sectionWarnings);
    const timeline = buildTimeline(atoms, decisions, actionItems, risks);
    // "Summary" (rendered at the top of the notes) = outcome-first, grounded, no filler.
    const tldr = buildSummary(decisions, actionItems, risks, atoms, sections, params.modeTemplateType);
    const whatChanged = buildWhatChanged(atoms, decisions).slice(0, 6);
    const overview = buildOverview(tldr, atoms, decisions, sections, params.modeTemplateType);
    const actionConfidence = deriveActionConfidence(actionItems);
    const transcriptCoverage = Math.max(0, Math.min(1, typeof params.transcriptCoverage === 'number' ? params.transcriptCoverage : (params.normalizedTranscript.totalChars > 0 ? 1 : 0)));
    // Order matters: sourceQuality.warnings is capped downstream (sanitizeStringArray keeps
    // only the FIRST N and silently drops the rest — see MeetingSummaryV3.ts). A section-
    // truncation warning is the rarest and highest-value signal (it says "notes content was
    // deleted"), so it must never lose its slot to lower-value transcript/atom warnings in the
    // exact giant-meeting scenario where truncation actually fires. Put it first.
    const atomWarnings = dedupeStrings(flatMap(atoms, atom => atom.sourceQualityWarnings || []));
    const warnings = [...sectionWarnings, ...atomWarnings, ...params.normalizedTranscript.qualityWarnings];
    if (atoms.length === 0) warnings.push('No summary atoms were produced; notes may be incomplete.');

    const generation: MeetingSummaryGenerationMeta = {
      strategy: params.generation?.strategy || (atoms.length > 1 ? 'map_reduce' : 'direct'),
      ...(params.generation?.provider ? { provider: params.generation.provider } : {}),
      ...(params.generation?.model ? { model: params.generation.model } : {}),
      startedAt: params.generation?.startedAt || new Date(0).toISOString(),
      ...(params.generation?.completedAt ? { completedAt: params.generation.completedAt } : {}),
      ...(typeof params.generation?.durationMs === 'number' ? { durationMs: params.generation.durationMs } : {}),
      chunkCount: params.generation?.chunkCount ?? atoms.length,
      warnings: params.generation?.warnings || [],
    };

    const summary: MeetingSummaryV3 = {
      schemaVersion: 3,
      title: params.title || 'Meeting Notes',
      tldr,
      overview,
      whatChanged,
      decisions,
      actionItems,
      openQuestions,
      risks,
      sections,
      timeline,
      people,
      topics,
      sourceQuality: {
        transcriptCoverage,
        speakerQuality: params.normalizedTranscript.speakerQuality,
        actionItemConfidence: actionConfidence,
        warnings: dedupeStrings(warnings),
      },
      mode: params.mode || {},
      generation,
      noteBlocks: buildNoteBlocks({ tldr, whatChanged, decisions, actionItems, openQuestions, risks, sections }),
    };

    return summary;
  }
}

function flatMap<T>(atoms: ChunkMeetingAtoms[], mapper: (atom: ChunkMeetingAtoms) => T[]): T[] {
  return atoms.flatMap(mapper).filter(Boolean);
}

// SECTION_BULLET_CAP is defined in MeetingSummaryV3.ts and reused here so this reducer-level
// cap and the schema validator's cap (sanitizeSections -> sanitizeBullets, which runs on the
// reduced summary immediately after this) can never drift apart. Realistic density is 5-12
// findings per section per chunk; a well-covered section across 4-10 chunks can legitimately
// reach ~120 bullets. This cap exists only to bound pathological input (a runaway chunk count
// or a misbehaving extractor), not to trim a normal dense meeting — 500 is far above anything
// the density contract should ever produce. If it ever fires, `buildSections` pushes a warning
// into `warnings` (below) naming the section and the drop count, so truncation is never silent.

function buildSections(modeSections: MeetingModeSectionInput[], atoms: ChunkMeetingAtoms[], warnings: string[]): MeetingNoteSection[] {
  const sectionMap = new Map<string, { title: string; bullets: NoteBullet[]; order: number }>();
  const titleCounts = new Map<string, number>();
  let orderCounter = 0;

  const ensure = (title: string) => {
    const idBase = slugify(title || 'notes');
    const count = titleCounts.get(idBase) || 0;
    titleCounts.set(idBase, count + 1);
    const id = count === 0 ? idBase : `${idBase}_${count + 1}`;
    if (!sectionMap.has(id)) sectionMap.set(id, { title, bullets: [], order: orderCounter++ });
    return id;
  };

  for (const section of modeSections) ensure(section.title);

  // Only route findings into PRE-DECLARED mode sections — the validator already drops
  // invented keys, but this is a second guard so the output never contains a section the
  // user's template didn't define.
  const allowedIds = new Set(sectionMap.keys());
  for (const atom of atoms) {
    for (const [title, findings] of Object.entries(atom.modeSpecificFindings || {})) {
      const matching = [...sectionMap.entries()].find(([, s]) => normalize(s.title) === normalize(title));
      const id = matching?.[0];
      if (!id || !allowedIds.has(id)) continue;
      const section = sectionMap.get(id)!;
      for (const finding of findings) {
        const text = typeof finding === 'string' ? finding : finding?.text;
        if (!text) continue;
        const evidence = (finding && typeof finding === 'object') ? finding.evidence : undefined;
        const confidence = (finding && typeof finding === 'object' && finding.confidence) ? finding.confidence : 'medium';
        // Keep the RICHER text, mirroring mergeSimilar: the old code dropped whichever
        // finding arrived second, and chunk 0 always arrives first — so a terse early
        // bullet permanently shadowed a more specific later one in this exact path.
        const existing = section.bullets.find(b => similar(b.text, text));
        if (existing) {
          if (text.trim().length > (existing.text || '').trim().length) {
            existing.text = text;
          }
          if (evidence?.length) existing.evidence = [...(existing.evidence || []), ...evidence].slice(0, 3);
          continue;
        }
        section.bullets.push({ id: `bullet_${crypto.randomUUID()}`, text, ...(evidence?.length ? { evidence } : {}), confidence });
      }
    }
  }

  return [...sectionMap.entries()]
    .map(([id, section]) => {
      if (section.bullets.length > SECTION_BULLET_CAP) {
        const dropped = section.bullets.length - SECTION_BULLET_CAP;
        warnings.push(`Section "${section.title}" produced ${section.bullets.length} findings; kept the first ${SECTION_BULLET_CAP} chronologically and dropped ${dropped}.`);
      }
      return { id, title: section.title, bullets: section.bullets.slice(0, SECTION_BULLET_CAP), order: section.order };
    })
    .filter(section => section.bullets.length > 0)
    // Next-steps sections are suppressed at the source, so they never reach the
    // notes, the follow-up draft inputs, or any recipe built from `sections`.
    .filter(section => INCLUDE_NEXT_STEPS || !isNextStepsSectionTitle(section.title))
    .sort((a, b) => a.order - b.order);
}

function buildTimeline(atoms: ChunkMeetingAtoms[], decisions: DecisionItem[], actionItems: ActionItem[], risks: RiskItem[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const atom of atoms) {
    if (atom.brief) items.push({ id: `moment_${atom.chunkIndex}`, timestampMs: atom.timeRange.startMs, title: atom.brief, type: 'topic_shift' });
  }
  for (const decision of decisions) items.push({ id: `decision_${decision.id || crypto.randomUUID()}`, timestampMs: decision.timestampMs, title: decision.text, type: 'decision', evidence: decision.evidence });
  for (const action of actionItems) items.push({ id: `action_${action.id || crypto.randomUUID()}`, timestampMs: action.sourceTimestampMs, title: action.text, type: 'action_item', evidence: action.evidence });
  for (const risk of risks) items.push({ id: `risk_${risk.id || crypto.randomUUID()}`, timestampMs: risk.evidence?.[0]?.timestampMs, title: risk.text, type: 'risk', evidence: risk.evidence });
  return items.sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)).slice(0, 20);
}

function buildWhatChanged(atoms: ChunkMeetingAtoms[], decisions: DecisionItem[]): string[] {
  // "What changed" = concrete outcomes: confirmed decisions + chunk briefs that describe a shift.
  const candidates: string[] = [];
  candidates.push(...decisions.slice(0, 3).map(d => d.text));
  candidates.push(...atoms.map(a => a.brief).filter(Boolean));
  return dedupeStrings(candidates).slice(0, 6);
}

// The mode's DEFINING sections, in priority order — the content that makes this
// mode's headline Summary read differently from every other mode's. buildSummary
// leads with the first non-empty bullet from the first matching section, so a
// technical interview's Summary opens with the hiring signal / problem, a
// lecture's with its study summary, a sales call's with buying signals — not a
// generic first-chunk brief. Titles must match TEMPLATE_NOTE_SECTIONS
// (ModesManager.ts) — buildSections carries those titles into
// summary.sections verbatim. Unknown/custom modes fall through to the generic
// shape (their custom sections still render below).
const MODE_HEADLINE_SECTIONS: Record<string, string[]> = {
  'technical-interview': ['Hiring signal', 'Problem discussed', 'Approach'],
  lecture: ['Study summary', 'Core concepts'],
  sales: ['Buying signals', 'Pain points', 'Next steps'],
  recruiting: ['Role fit', 'Candidate profile'],
  'team-meet': ['Progress since last sync', 'Blockers'],
  'looking-for-work': ['Role fit', 'Next steps'],
  seminar: ['Core concepts', 'Open questions'],
  'call-center': ['Customer issue', 'Resolution'],
};

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const rankConfidence = (c?: string): number => CONFIDENCE_RANK[c || ''] ?? 1;

// Outcome-first Summary, built deterministically from the already-grounded reduced content.
// 3–5 lines: mode-defining lead → purpose → key decisions → most important next step →
// high-severity risk. Zero new information. Returns [] (empty Summary) rather than
// boilerplate when there is genuinely no grounded outcome — honest beats filler.
//
// Selection quality (review 2026-08-23 — the previous version was a positional
// grab: chunk 1's brief, the first 2 decisions CHronologically, actionItems[0],
// risk only as filler — so a critical decision at minute 45, the 3rd action
// item, or a high-severity mid-meeting risk never reached the headline even
// though the pipeline had already computed confidence/severity for them):
//   - decisions ranked by confidence (stable among equals, so chronology still
//     breaks ties);
//   - the next step prefers explicit over inferred, then confidence;
//   - a HIGH-severity risk is always included, not just as filler;
//   - the lead line comes from the active mode's defining section.
function buildSummary(decisions: DecisionItem[], actionItems: ActionItem[], risks: RiskItem[], atoms: ChunkMeetingAtoms[], sections: MeetingNoteSection[], modeTemplateType?: string | null): string[] {
  const out: string[] = [];

  // Mode-defining lead: the first non-empty bullet of the mode's top section.
  const headlineTitles = MODE_HEADLINE_SECTIONS[modeTemplateType || ''] || [];
  for (const title of headlineTitles) {
    const sec = sections.find(sect => sect.title === title && sect.bullets.length > 0);
    const bullet = sec?.bullets[0]?.text?.trim();
    if (bullet) { out.push(bullet); break; }
  }

  const purpose = atoms.map(a => a.brief).find(Boolean) || sections.find(sect => sect.bullets.length)?.bullets[0]?.text;
  if (purpose) out.push(purpose);

  const rankedDecisions = decisions
    .map((d, i) => ({ d, i }))
    .sort((x, y) => rankConfidence(x.d.confidence) - rankConfidence(y.d.confidence) || x.i - y.i);
  out.push(...rankedDecisions.slice(0, 2).map(({ d }) => d.text));

  const rankedActions = actionItems
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.explicitness === 'explicit' ? 0 : 1) - (y.a.explicitness === 'explicit' ? 0 : 1)
      || rankConfidence(x.a.confidence) - rankConfidence(y.a.confidence)
      || x.i - y.i);
  const a = rankedActions[0]?.a;
  if (a) out.push(`${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` by ${a.deadline}` : ''}`);

  const highRisk = risks.find(r => r.severity === 'high');
  if (highRisk) out.push(highRisk.text);
  else if (out.length < 2 && risks[0]) out.push(risks[0].text);

  return dedupeStrings(out).slice(0, 5);
}

// Deterministic whole-meeting overview paragraph (fallback when LLM polish is off/unavailable).
// Stitches the chunk briefs (the chronological arc of the meeting) into a paragraph, then
// folds in the headline decisions so it reads as a quick recap of the ENTIRE meeting rather
// than just the first two summary bullets. Capped to ~400 words.
function buildOverview(summary: string[], atoms: ChunkMeetingAtoms[], decisions: DecisionItem[], sections: MeetingNoteSection[] = [], modeTemplateType?: string | null): string {
  const briefs = dedupeStrings(atoms.map(a => a.brief).filter(Boolean));
  const parts: string[] = [];
  if (briefs.length) parts.push(briefs.join(' '));
  else if (summary.length) parts.push(summary.join(' '));
  // Confidence-ranked, mirroring buildSummary (review 2026-08-23).
  const topDecisions = decisions
    .map((d, i) => ({ d, i }))
    .sort((x, y) => rankConfidence(x.d.confidence) - rankConfidence(y.d.confidence) || x.i - y.i)
    .slice(0, 3).map(({ d }) => d.text);
  if (topDecisions.length) parts.push(`Key decisions: ${topDecisions.join('; ')}.`);
  // Mode-defining close, so the overview paragraph also reads in the mode's
  // own terms (a technical interview ends on the hiring signal, a lecture on
  // its study summary) instead of always generic decisions.
  const headlineTitles = MODE_HEADLINE_SECTIONS[modeTemplateType || ''] || [];
  for (const title of headlineTitles) {
    const sec = sections.find(sect => sect.title === title && sect.bullets.length > 0);
    const bullet = sec?.bullets[0]?.text?.trim();
    if (bullet && !parts.some(pp => pp.includes(bullet))) { parts.push(`${title}: ${bullet}`); break; }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  const words = text.split(/\s+/);
  return words.length > 400 ? words.slice(0, 400).join(' ') : text;
}

// Deterministic follow-up body (fallback used when the LLM follow-up generator is
// unavailable or scope-denied). Kept exported so FollowUpDraftGenerator can reuse it.
// Mode-aware: salutation, opening, section labels and sign-off match the meeting mode
// so an offline draft still reads correctly for its audience (a sales prospect, a
// candidate, an internal team, a study recap, etc.) rather than always "Hi team,".
export function buildFollowUpBody(decisions: DecisionItem[], actionItems: ActionItem[], mode?: string | null): string {
  // Per-mode scaffold: [salutation, opening, decisionsLabel, nextStepsLabel, emptyLine, signoff]
  // A null salutation/sign-off means "omit" (study notes, interviewer feedback).
  // `emptyNoNextSteps` overrides `empty` while INCLUDE_NEXT_STEPS is false: with the
  // action-item block suppressed, "no decisions OR action items were captured" would be
  // a false statement on a meeting that did produce action items — only the decisions
  // block can be missing at that point. Modes whose `empty` line never mentions action
  // items don't need an override.
  const S: Record<string, { salutation: string | null; opening: string; decisionsLabel: string; nextStepsLabel: string; empty: string; emptyNoNextSteps?: string; signoff: string | null }> = {
    general:              { salutation: 'Hi team,',            opening: 'Thanks for the conversation.',           decisionsLabel: 'Decisions confirmed:', nextStepsLabel: 'Next steps:',        empty: 'No explicit decisions or action items were captured.', emptyNoNextSteps: 'No explicit decisions were captured.', signoff: 'Best,' },
    sales:                { salutation: 'Hi there,',           opening: 'Thanks for taking the time to meet today.', decisionsLabel: 'What we aligned on:',  nextStepsLabel: 'Next steps:',        empty: 'It was great connecting — I\'ll follow up with next steps shortly.', signoff: 'Best regards,' },
    // Recruiting omits the decisions block from the deterministic fallback entirely:
    // negative-hiring decisions or Concerns would be leaked to the candidate if rendered.
    recruiting:           { salutation: 'Hi there,',           opening: 'Thank you for taking the time to speak with us today.', decisionsLabel: '',                       nextStepsLabel: 'What happens next:',  empty: 'Thanks again — we\'ll be in touch about next steps soon.', signoff: 'Best,' },
    'team-meet':          { salutation: 'Hi team,',            opening: 'Quick recap from our sync:',             decisionsLabel: 'Decisions:',           nextStepsLabel: 'Owners & next steps:', empty: 'No decisions or action items were captured this time.', emptyNoNextSteps: 'No decisions were captured this time.', signoff: 'Thanks,' },
    'looking-for-work':   { salutation: 'Dear interviewer,',   opening: 'Thank you for taking the time to speak with me today.', decisionsLabel: 'What we discussed:',   nextStepsLabel: 'Next steps:',        empty: 'Thank you again for the conversation — I really enjoyed it.', signoff: 'Best regards,' },
    'technical-interview':{ salutation: null,                  opening: 'Interview debrief:',                     decisionsLabel: 'Assessment:',          nextStepsLabel: 'Recommended next step:', empty: 'No decisions were recorded during the session.', signoff: null },
    lecture:              { salutation: null,                  opening: 'Study recap:',                           decisionsLabel: 'Key points:',          nextStepsLabel: 'To review:',         empty: 'No key points were captured.', signoff: null },
  };
  const p = (mode && S[mode]) || S.general;

  const lines: string[] = [];
  if (p.salutation) lines.push(p.salutation, '');
  lines.push(p.opening);
  // `rendered` tracks whether ANY substantive block made it into the body. With the
  // next-steps block suppressed, "decisions.length === 0 && actionItems.length === 0"
  // is no longer the right emptiness test: a meeting with action items but no
  // decisions — and every recruiting draft, whose decisionsLabel is deliberately
  // empty — would otherwise render as salutation + opening + sign-off and nothing else.
  let rendered = false;
  if (decisions.length > 0 && p.decisionsLabel) {
    lines.push('', p.decisionsLabel, ...decisions.slice(0, 5).map(item => `- ${item.text}`));
    rendered = true;
  }
  if (INCLUDE_NEXT_STEPS && actionItems.length > 0) {
    lines.push('', p.nextStepsLabel, ...actionItems.slice(0, 8).map(item => {
      const owner = item.owner ? `${item.owner}: ` : '';
      const deadline = item.deadline ? ` by ${item.deadline}` : '';
      const inferred = item.explicitness === 'inferred' ? ' (inferred)' : '';
      return `- ${owner}${item.text}${deadline}${inferred}`;
    }));
    rendered = true;
  }
  if (!rendered) lines.push('', (!INCLUDE_NEXT_STEPS && p.emptyNoNextSteps) || p.empty);
  if (p.signoff) lines.push('', p.signoff);
  return lines.join('\n');
}

function buildNoteBlocks(params: { tldr: string[]; whatChanged: string[]; decisions: DecisionItem[]; actionItems: ActionItem[]; openQuestions: QuestionItem[]; risks: RiskItem[]; sections: MeetingNoteSection[] }): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  if (params.tldr.length) {
    blocks.push({ type: 'heading', text: 'Summary' });
    params.tldr.forEach(text => blocks.push({ type: 'bullet', text }));
  }
  if (params.whatChanged.length) {
    blocks.push({ type: 'heading', text: 'What changed' });
    params.whatChanged.forEach(text => blocks.push({ type: 'bullet', text }));
  }
  if (params.decisions.length) {
    blocks.push({ type: 'heading', text: 'Decisions' });
    params.decisions.forEach(item => blocks.push({ type: 'decision', item }));
  }
  if (params.actionItems.length) {
    blocks.push({ type: 'heading', text: 'Action Items' });
    params.actionItems.forEach(item => blocks.push({ type: 'action', item }));
  }
  if (params.openQuestions.length) {
    blocks.push({ type: 'heading', text: 'Open Questions' });
    params.openQuestions.forEach(item => blocks.push({ type: 'question', item }));
  }
  if (params.risks.length) {
    blocks.push({ type: 'heading', text: 'Risks / Blockers' });
    params.risks.forEach(item => blocks.push({ type: 'risk', item }));
  }
  for (const section of params.sections) {
    blocks.push({ type: 'heading', text: section.title });
    section.bullets.forEach(bullet => blocks.push({ type: 'bullet', text: bullet.text, evidence: bullet.evidence }));
  }
  return blocks;
}

function mergeSimilar<T extends { text: string; evidence?: any[] }>(items: T[], kind: string): T[] {
  const merged: T[] = [];
  for (const item of items) {
    const existing = merged.find(other => similar(other.text, item.text));
    if (!existing) {
      merged.push({ ...item });
      continue;
    }
    // Keep the RICHER text. The old code kept whichever arrived first, so a terse
    // restatement could never be improved by a later, more specific one — and a terse
    // EARLY bullet permanently shadowed the specific later version.
    if ((item.text || '').trim().length > (existing.text || '').trim().length) {
      existing.text = item.text;
    }
    existing.evidence = [...(existing.evidence || []), ...(item.evidence || [])].slice(0, 3);
    if (kind === 'action') {
      const e = existing as any;
      const i = item as any;
      if (!e.owner && i.owner) e.owner = i.owner;
      if (!e.deadline && i.deadline) e.deadline = i.deadline;
      if (e.explicitness !== 'explicit' && i.explicitness === 'explicit') e.explicitness = 'explicit';
      if (confidenceRank(i.confidence) > confidenceRank(e.confidence)) e.confidence = i.confidence;
    }
  }
  return merged;
}

function assignIds<T extends { id?: string; text: string }>(items: T[]): T[] {
  return items.map(item => ({ ...item, id: item.id || `${slugify(item.text).slice(0, 24)}_${crypto.randomUUID().slice(0, 8)}` }));
}

function mergePeople(people: PersonMention[]): PersonMention[] {
  const byName = new Map<string, PersonMention>();
  for (const person of people) {
    const name = (person.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) byName.set(key, { ...person, mentions: person.mentions || 1 });
    else existing.mentions = (existing.mentions || 1) + (person.mentions || 1);
  }
  return [...byName.values()].sort((a, b) => (b.mentions || 0) - (a.mentions || 0));
}

function deriveActionConfidence(actions: ActionItem[]): 'high' | 'medium' | 'low' {
  if (actions.length === 0) return 'low';
  const explicit = actions.filter(a => a.explicitness === 'explicit').length;
  const withEvidence = actions.filter(a => a.evidence?.length).length;
  if (explicit / actions.length >= 0.75 && withEvidence / actions.length >= 0.75) return 'high';
  if (explicit / actions.length >= 0.4 || withEvidence / actions.length >= 0.4) return 'medium';
  return 'low';
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values.map(v => (v || '').trim()).filter(Boolean)) {
    if (!out.some(existing => similar(existing, value))) out.push(value);
  }
  return out;
}

// Two bullets are "the same point" only when they overlap SYMMETRICALLY and are of
// comparable length.
//
// The previous rule was `shared / Math.min(aWords.size, bWords.size) >= 0.8` — pure subset
// containment. Any short generic bullet whose words appear inside a longer specific one
// scored 1.0, and because mergeSimilar keeps the FIRST-seen item, the specific text was
// discarded outright. Reproduced 2026-08-24: "Ari will send the packet" swallowed "Ari will
// send the SOC2 packet to procurement on Friday". That one function explained both "notes
// are too thin" and "notes miss what mattered".
//
// Dice coefficient (2·shared / (|A|+|B|)) is symmetric, so containment alone cannot reach
// 1.0. The length-ratio floor is the second guard: a bullet under 60% the length of another
// is a DIFFERENT, less specific point however well its words are contained.
//
// THRESHOLD FLOOR — do not lower SIMILARITY_DICE_THRESHOLD below 0.8: for two word sets of
// EQUAL size, Dice is algebraically identical to the old containment formula
// (shared / min(|A|,|B|)), so on same-length pairs this rule is only as strict as the number
// you pick here. Three chunk-scoped decisions that differ by a single distinguishing word —
// "Decision from early meeting segment" / "...middle..." / "...late..." — score Dice 0.750.
// They must NOT merge (merging them silently destroys chunk coverage, which is worse than
// leaving a near-duplicate bullet — see the note on MUST_MERGE below), so the threshold must
// sit above 0.75. This is locked at 0.8 by
// `NotesQuality2026_08_24.test.mjs` → `MUST_STAY_DISTINCT` (the early/middle/late row) and by
// `MeetingSummaryPipeline.test.mjs` → "long transcript chunker preserves early middle and late
// coverage". Both thresholds below are otherwise locked by the tables in
// NotesQuality2026_08_24.test.mjs — change one, run that suite.
const SIMILARITY_DICE_THRESHOLD = 0.8;
const SIMILARITY_LENGTH_RATIO_FLOOR = 0.6;

export function similar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aWords = new Set(na.split(' ').filter(Boolean));
  const bWords = new Set(nb.split(' ').filter(Boolean));
  if (aWords.size === 0 || bWords.size === 0) return false;

  const lengthRatio = Math.min(aWords.size, bWords.size) / Math.max(aWords.size, bWords.size);
  if (lengthRatio < SIMILARITY_LENGTH_RATIO_FLOOR) return false;

  let shared = 0;
  for (const word of aWords) if (bWords.has(word)) shared++;
  const dice = (2 * shared) / (aWords.size + bWords.size);
  return dice >= SIMILARITY_DICE_THRESHOLD;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\b(the|a|an|to|for|and|or|of|in|on|by|with|from)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return (value || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
}

function confidenceRank(value: string): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}
