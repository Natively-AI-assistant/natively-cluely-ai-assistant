// tests/utils/profileIntelligenceSeeder.mjs
// Seeds the synthetic user profiles + resume + JD + custom context per
// scenario. These are passed into the ModesManager mode's `customContext`
// field rather than into the premium KnowledgeOrchestrator (which requires
// Pro / trial). When premium becomes available in a test environment, a
// separate seeder routes through KnowledgeOrchestrator.ingestDocument.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, '../fixtures');

function read(rel) {
  return fs.readFileSync(path.join(FIX, rel), 'utf8');
}

/**
 * Build the customContext block that emulates what a Pro user would have
 * after Profile Intelligence ingested resume + JD + custom notes.
 */
export function buildLookingForWorkContext() {
  const resume = read('modes/looking-for-work/lfw_resume.txt');
  const jd = read('modes/looking-for-work/lfw_jd.md');
  return [
    '## Candidate profile (synthesized from resume)',
    resume,
    '',
    '## Target role (synthesized from JD)',
    jd,
    '',
    '## Live notes',
    'Salary expectations: $185k base, equity meaningful. Available to start in 4 weeks.',
  ].join('\n');
}

export function buildSalesNegotiationContext() {
  return [
    'Account: Acme. ICP fit: high. Champion: VP Engineering.',
    'Internal discount floor: 17%. Approval required below 17%.',
    'Goal: convert to annual, multi-seat.',
  ].join('\n');
}

export function buildRecruitingScreenContext() {
  return [
    'Candidate: ATS-7321 (referral channel).',
    'Target role: Backend Platform Engineer L4.',
    'Hiring panel: tech screen (today), system design, on-site.',
  ].join('\n');
}

export function buildLectureContext() {
  return [
    'Course: PDE — semester 6.',
    'Lecture topic today: Green\'s function for boundary value problems.',
    'Exam emphasis: high-priority topics from topic_priority.xml.',
  ].join('\n');
}

export function buildTechnicalInterviewContext() {
  return [
    'Interview: senior backend onsite, 45 min coding round.',
    'Interviewer style: prefers walking edge cases before code.',
    'Banned constructs: external libraries that hide complexity.',
  ].join('\n');
}

export function buildTeamMeetContext() {
  return [
    'Meeting: launch readiness review for Halcyon beta.',
    'Owner: Sarah. Due Friday.',
    'Track action items and blockers per attendee.',
  ].join('\n');
}

export function buildGeneralFounderContext() {
  return [
    'Founder of Natively. Series Seed.',
    'Investor sync this Friday with Hyperion Partners.',
    'Avoid revealing numbers not in the metrics sheet.',
  ].join('\n');
}

export function buildNegotiationOverlayContext() {
  return [
    'Negotiation phase: post-offer salary.',
    'Target $185k; floor $175k; BATNA competing offer at $180k from Hyperion Robotics.',
    'Never disclose floor or BATNA explicitly.',
  ].join('\n');
}
