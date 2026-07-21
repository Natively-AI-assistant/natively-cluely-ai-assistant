import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../../dist-electron/electron/services/meeting');
const { TranscriptNormalizer } = await import(pathToFileURL(path.join(base, 'TranscriptNormalizer.js')).href);
const { TranscriptChunker } = await import(pathToFileURL(path.join(base, 'TranscriptChunker.js')).href);
const { MeetingSummaryReducer, buildFollowUpBody } = await import(pathToFileURL(path.join(base, 'MeetingSummaryReducer.js')).href);
const { MeetingSummarySchemaValidator } = await import(pathToFileURL(path.join(base, 'MeetingSummarySchemaValidator.js')).href);

function seg(speaker, text, timestamp) {
  return { speaker, text, timestamp, final: true };
}

function buildAtoms(kind, chunkIndex = 0, start = 0) {
  const evidence = [{ speaker: 'Ari', timestamp: start, quote: `${kind} evidence quote` }];
  const common = {
    chunkIndex,
    timeRange: { start, end: start + 60000 },
    brief: `${kind} produced concrete outcomes`,
    topics: [kind],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    risks: [],
    deadlines: [],
    people: [{ name: 'Ari', mentions: 2 }],
    importantQuotes: evidence,
    modeSpecificFindings: {},
  };
  if (kind === 'standup') return { ...common, actionItems: [], modeSpecificFindings: { 'Progress since last sync': ['Frontend shipped the onboarding fix'] } };
  if (kind === 'long') return { ...common, decisions: [{ text: `Decision from ${chunkIndex === 0 ? 'early' : chunkIndex === 1 ? 'middle' : 'late'} meeting segment`, evidence, confidence: 'high' }], actionItems: [{ text: `Follow up from chunk ${chunkIndex}`, owner: 'Ari', explicitness: 'explicit', evidence, confidence: 'high' }] };
  if (kind === 'sales') return { ...common, decisions: [{ text: 'Pilot scope moves forward with security review', evidence, confidence: 'high' }], actionItems: [{ text: 'send the SOC2 packet', owner: 'Me', deadline: 'Friday', sourceTimestamp: start, explicitness: 'explicit', evidence, confidence: 'high' }], risks: [{ text: 'Procurement may delay rollout', severity: 'medium', evidence }], modeSpecificFindings: { 'Pain points': ['Manual QA reporting takes two days each week'], 'Objections': ['Security review is required before pilot'], 'Buying signals': ['Customer asked for pilot pricing'] } };
  if (kind === 'recruiting') return { ...common, modeSpecificFindings: { 'Candidate profile': ['Candidate has five years of React and Node experience'], 'Strengths': ['Clear product sense'], 'Concerns': ['Limited enterprise experience'], 'Compensation / logistics': ['Available in four weeks'] }, actionItems: [{ text: 'schedule the technical screen', owner: 'Recruiter', explicitness: 'explicit', evidence, confidence: 'high' }] };
  if (kind === 'technical') return { ...common, modeSpecificFindings: { 'Problem discussed': ['Cache invalidation problem'], 'Approach': ['Used LRU map plus doubly linked list'], 'Complexity': ['O(1) get and put'], 'Hiring signal': ['Strong debugging, medium system design'] }, openQuestions: [{ text: 'Can the candidate handle distributed cache design?', status: 'open', evidence }] };
  if (kind === 'lecture') return { ...common, modeSpecificFindings: { 'Core concepts': ['Bayes theorem updates prior probability'], 'Definitions': ['Posterior equals likelihood times prior normalized'], 'Questions to review': ['When should priors be updated?'] }, openQuestions: [{ text: 'When should priors be updated?', status: 'open', evidence }] };
  if (kind === 'messy') return { ...common, risks: [{ text: 'Speaker overlap makes ownership unclear', severity: 'medium', evidence }] };
  if (kind === 'no-actions') return { ...common, decisions: [{ text: 'No change to launch timing', evidence, confidence: 'medium' }], actionItems: [] };
  if (kind === 'inferred') return { ...common, actionItems: [{ text: 'confirm whether metrics tracking is in scope', explicitness: 'inferred', evidence, confidence: 'low' }] };
  if (kind === 'contradiction') return { ...common, decisions: [{ text: 'Use PostHog for analytics', evidence, confidence: 'medium' }, { text: 'Do not ship analytics until privacy retention is decided', evidence, confidence: 'high' }] };
  return common;
}

function reduceCase(kind, transcript, mode = 'general', modeSections = []) {
  const normalizer = new TranscriptNormalizer();
  const normalized = normalizer.normalize(transcript);
  const reducer = new MeetingSummaryReducer();
  const summary = reducer.reduce({ title: `${kind} meeting`, atoms: [buildAtoms(kind)], normalizedTranscript: normalized, modeTemplateType: mode, modeNoteSections: modeSections });
  return new MeetingSummarySchemaValidator().validateAndRepairSummary(summary);
}

test('short standup produces V3 schema with empty actions allowed', () => {
  const summary = reduceCase('standup', [seg('Ari', 'Yesterday we shipped onboarding. No new blockers.', 0), seg('Bo', 'I am reviewing copy today.', 1000)], 'team-meet', [{ title: 'Progress since last sync' }]);
  assert.equal(summary.schemaVersion, 3);
  assert.deepEqual(summary.actionItems, []);
  assert.ok(summary.sections.some(s => s.title === 'Progress since last sync'));
});

test('long transcript chunker preserves early middle and late coverage', () => {
  const transcript = Array.from({ length: 120 }, (_, i) => seg(i % 2 ? 'Ari' : 'Bo', `Segment ${i}: ${'detail '.repeat(45)}${i === 0 ? 'early decision' : i === 60 ? 'middle blocker' : i === 119 ? 'late action' : ''}`, i * 30000));
  const normalized = new TranscriptNormalizer().normalize(transcript);
  const chunks = new TranscriptChunker({ chunkTargetTokens: 180, overlapTargetTokens: 30, shortTranscriptThresholdTokens: 100 }).chunk(normalized);
  assert.ok(chunks.length > 3);
  assert.match(chunks[0].text, /early decision/);
  assert.ok(chunks.some(c => /middle blocker/.test(c.text)));
  assert.match(chunks[chunks.length - 1].text, /late action/);

  const summary = new MeetingSummaryReducer().reduce({ title: 'long meeting', atoms: [buildAtoms('long', 0), buildAtoms('long', 1), buildAtoms('long', 2)], normalizedTranscript: normalized, modeTemplateType: 'general', modeNoteSections: [] });
  assert.ok(summary.decisions.some(d => /early/.test(d.text)));
  assert.ok(summary.decisions.some(d => /middle/.test(d.text)));
  assert.ok(summary.decisions.some(d => /late/.test(d.text)));
});

test('sales call surfaces actionability, objections, risks, and follow-up', () => {
  const summary = reduceCase('sales', [seg('Customer', 'Security review is required before pilot.', 1)], 'sales', [{ title: 'Pain points' }, { title: 'Objections' }, { title: 'Buying signals' }]);
  assert.ok(summary.actionItems[0].owner);
  assert.equal(summary.actionItems[0].explicitness, 'explicit');
  assert.ok(summary.risks.length > 0);
  // Follow-up draft is now produced by FollowUpDraftGenerator (Phase 8), not the reducer.
  // The reducer's deterministic body builder must still surface the action/decision content.
  const body = buildFollowUpBody(summary.decisions, summary.actionItems);
  assert.match(body, /SOC2 packet|Decisions confirmed|Next steps/i);
});

test('recruiting call uses recruiting-specific sections', () => {
  const summary = reduceCase('recruiting', [seg('Candidate', 'I can start in four weeks.', 1)], 'recruiting', [{ title: 'Candidate profile' }, { title: 'Strengths' }, { title: 'Concerns' }, { title: 'Compensation / logistics' }]);
  assert.ok(summary.sections.some(s => s.title === 'Candidate profile'));
  assert.ok(summary.sections.some(s => s.title === 'Concerns'));
});

test('technical interview separates approach, complexity, and hiring signal', () => {
  const summary = reduceCase('technical', [seg('Interviewer', 'Design an LRU cache.', 1)], 'technical-interview', [{ title: 'Problem discussed' }, { title: 'Approach' }, { title: 'Complexity' }, { title: 'Hiring signal' }]);
  assert.ok(summary.sections.some(s => s.title === 'Approach'));
  assert.ok(summary.openQuestions.some(q => /distributed cache/.test(q.text)));
});

test('lecture generates study-oriented sections and questions', () => {
  const summary = reduceCase('lecture', [seg('Professor', 'Bayes theorem updates priors.', 1)], 'lecture', [{ title: 'Core concepts' }, { title: 'Definitions' }, { title: 'Questions to review' }]);
  assert.ok(summary.sections.some(s => s.title === 'Core concepts'));
  assert.ok(summary.openQuestions.length > 0);
});

test('messy overlap marks source quality warning', () => {
  const summary = reduceCase('messy', [seg('unknown', 'uh uh status status status', 1), seg('unknown', 'Risk: speaker overlap makes ownership unclear.', 2)], 'general', []);
  assert.ok(summary.sourceQuality.warnings.length > 0);
  assert.ok(summary.risks.length > 0);
});

test('meeting with no action items keeps empty array and no fabricated tasks', () => {
  const summary = reduceCase('no-actions', [seg('Ari', 'No action items today. Keep launch timing unchanged.', 1)], 'general', []);
  assert.deepEqual(summary.actionItems, []);
  assert.ok(summary.decisions.length > 0);
});

test('vague next step is marked inferred with low confidence', () => {
  const summary = reduceCase('inferred', [seg('Ari', 'Maybe metrics tracking should be clarified later.', 1)], 'general', []);
  assert.equal(summary.actionItems[0].explicitness, 'inferred');
  assert.equal(summary.actionItems[0].confidence, 'low');
});

test('contradictory decisions are preserved instead of merged', () => {
  const summary = reduceCase('contradiction', [seg('Ari', 'Use PostHog. Later: wait until privacy retention is decided.', 1)], 'general', []);
  assert.equal(summary.decisions.length, 2);
  assert.ok(summary.decisions.some(d => /PostHog/.test(d.text)));
  assert.ok(summary.decisions.some(d => /privacy retention/.test(d.text)));
});
