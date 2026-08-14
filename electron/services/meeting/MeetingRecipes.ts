import type { MeetingSummaryV3 } from './types';
import { buildFollowUpBody } from './MeetingSummaryReducer';

export type RecipeType =
  | 'follow-up-email'
  | 'slack-update'
  | 'project-update'
  | 'crm-note'
  | 'investor-update'
  | 'recruiting-scorecard'
  | 'lecture-study-notes'
  | 'technical-interview-feedback'
  | 'sales-meddic'
  | 'customer-feedback';

export const BUILT_IN_RECIPES: Array<{ id: RecipeType; label: string; modes?: string[] }> = [
  { id: 'follow-up-email', label: 'Follow-up email' },
  { id: 'slack-update', label: 'Slack update' },
  { id: 'project-update', label: 'Project update', modes: ['general', 'team-meet'] },
  { id: 'crm-note', label: 'CRM note', modes: ['sales'] },
  { id: 'investor-update', label: 'Investor update' },
  { id: 'recruiting-scorecard', label: 'Recruiting scorecard', modes: ['recruiting'] },
  { id: 'lecture-study-notes', label: 'Lecture study notes', modes: ['lecture'] },
  { id: 'technical-interview-feedback', label: 'Technical interview feedback', modes: ['technical-interview'] },
  { id: 'sales-meddic', label: 'Sales MEDDIC summary', modes: ['sales'] },
  { id: 'customer-feedback', label: 'Customer feedback', modes: ['sales', 'general'] },
];

export function generateRecipe(summary: MeetingSummaryV3, recipe: RecipeType): string {
  switch (recipe) {
    case 'follow-up-email': return summary.followUpDraft?.body || buildFollowUpBody(summary.decisions, summary.actionItems, summary.mode?.summaryModeUsed || summary.mode?.selectedModeId);
    case 'slack-update': return slackUpdate(summary);
    case 'project-update': return projectUpdate(summary);
    case 'crm-note': return crmNote(summary);
    case 'investor-update': return investorUpdate(summary);
    case 'recruiting-scorecard': return recruitingScorecard(summary);
    case 'lecture-study-notes': return lectureStudyNotes(summary);
    case 'technical-interview-feedback': return technicalInterviewFeedback(summary);
    case 'sales-meddic': return salesMeddic(summary);
    case 'customer-feedback': return customerFeedback(summary);
  }
}

export function generateBuiltInRecipes(summary: MeetingSummaryV3, mode?: string | null): Record<string, string> {
  const selected = BUILT_IN_RECIPES.filter(recipe => !recipe.modes || (mode && recipe.modes.includes(mode)) || recipe.id === 'follow-up-email' || recipe.id === 'slack-update');
  const out: Record<string, string> = {};
  for (const recipe of selected) {
    const value = generateRecipe(summary, recipe.id).trim();
    if (value) out[recipe.id] = value;
  }
  return out;
}

function list(items: string[], empty = 'None captured'): string {
  return items.length ? items.map(item => `- ${item}`).join('\n') : `- ${empty}`;
}

function slackUpdate(summary: MeetingSummaryV3): string {
  return [
    `*${summary.title || 'Meeting update'}*`,
    '',
    '*TLDR*',
    list(summary.tldr),
    '',
    '*Decisions*',
    list(summary.decisions.map(d => d.text)),
    '',
    '*Next steps*',
    list(summary.actionItems.map(a => `${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` — ${a.deadline}` : ''}`)),
  ].join('\n');
}

function projectUpdate(summary: MeetingSummaryV3): string {
  return [
    '# Project Update',
    '',
    '## What changed',
    list(summary.tldr),
    '',
    '## Decisions',
    list(summary.decisions.map(d => d.text)),
    '',
    '## Owners / next steps',
    list(summary.actionItems.map(a => `${a.owner || 'Unassigned'} — ${a.text}${a.deadline ? ` (${a.deadline})` : ''}`)),
    '',
    '## Risks / blockers',
    list(summary.risks.map(r => `[${r.severity}] ${r.text}`)),
    '',
    '## Open questions',
    list(summary.openQuestions.map(q => q.text)),
  ].join('\n');
}

function crmNote(summary: MeetingSummaryV3): string {
  return [
    '## CRM Note',
    '',
    `Summary: ${summary.overview}`,
    '',
    'Pain / needs:',
    list(sectionBullets(summary, /pain|discovery|need/i)),
    '',
    'Objections:',
    list(sectionBullets(summary, /objection/i)),
    '',
    'Buying signals:',
    list(sectionBullets(summary, /buying|signal/i)),
    '',
    'Next steps:',
    list(summary.actionItems.map(a => `${a.owner || 'Unassigned'} — ${a.text}${a.deadline ? ` (${a.deadline})` : ''}`)),
  ].join('\n');
}

function investorUpdate(summary: MeetingSummaryV3): string {
  return [
    '# Investor Update',
    '',
    '## Highlights',
    list(summary.tldr),
    '',
    '## Key decisions',
    list(summary.decisions.map(d => d.text)),
    '',
    '## Risks',
    list(summary.risks.map(r => `[${r.severity}] ${r.text}`)),
    '',
    '## Asks / next steps',
    list(summary.actionItems.map(a => a.text)),
  ].join('\n');
}

function recruitingScorecard(summary: MeetingSummaryV3): string {
  return [
    '# Recruiting Scorecard',
    '',
    '## Candidate profile',
    list(sectionBullets(summary, /candidate|profile|experience/i)),
    '',
    '## Strengths',
    list(sectionBullets(summary, /strength|what went well|role fit/i)),
    '',
    '## Concerns',
    list([...sectionBullets(summary, /concern|weakness|areas/i), ...summary.risks.map(r => r.text)]),
    '',
    '## Logistics',
    list(sectionBullets(summary, /compensation|logistics|availability|timeline/i)),
    '',
    '## Next steps',
    list(summary.actionItems.map(a => a.text)),
  ].join('\n');
}

function lectureStudyNotes(summary: MeetingSummaryV3): string {
  return [
    '# Lecture Study Notes',
    '',
    '## Core concepts',
    list(sectionBullets(summary, /core|concept|definition/i)),
    '',
    '## Examples / steps',
    list(sectionBullets(summary, /example|formula|steps/i)),
    '',
    '## Questions to review',
    list(summary.openQuestions.map(q => q.text)),
    '',
    '## Study summary',
    list(summary.tldr),
  ].join('\n');
}

function technicalInterviewFeedback(summary: MeetingSummaryV3): string {
  return [
    '# Technical Interview Feedback',
    '',
    '## Problem / approach',
    list(sectionBullets(summary, /problem|approach/i)),
    '',
    '## Correctness / complexity',
    list(sectionBullets(summary, /correctness|complexity/i)),
    '',
    '## Communication / code quality',
    list(sectionBullets(summary, /communication|code quality/i)),
    '',
    '## Hiring signal',
    list(sectionBullets(summary, /hiring|signal|strength|weakness/i)),
    '',
    '## Follow-up',
    list(summary.actionItems.map(a => a.text)),
  ].join('\n');
}

function salesMeddic(summary: MeetingSummaryV3): string {
  return [
    '# MEDDIC Summary',
    '',
    '## Metrics', list(sectionBullets(summary, /metric|budget|roi|cost/i)),
    '',
    '## Economic buyer / authority', list(sectionBullets(summary, /authority|buyer|budget/i)),
    '',
    '## Decision criteria / process', list([...sectionBullets(summary, /decision|criteria|process/i), ...summary.decisions.map(d => d.text)]),
    '',
    '## Identify pain', list(sectionBullets(summary, /pain|need|problem|discovery/i)),
    '',
    '## Champion / next steps', list(summary.actionItems.map(a => `${a.owner || 'Unassigned'} — ${a.text}`)),
  ].join('\n');
}

function customerFeedback(summary: MeetingSummaryV3): string {
  return [
    '# Customer Feedback',
    '',
    '## Feature requests / needs',
    list(sectionBullets(summary, /feature|request|need|pain/i)),
    '',
    '## Objections / risks',
    list([...sectionBullets(summary, /objection|concern/i), ...summary.risks.map(r => r.text)]),
    '',
    '## Follow-up',
    list(summary.actionItems.map(a => a.text)),
  ].join('\n');
}

function sectionBullets(summary: MeetingSummaryV3, re: RegExp): string[] {
  return summary.sections
    .filter(section => re.test(section.title))
    .flatMap(section => section.bullets.map(b => b.text));
}
