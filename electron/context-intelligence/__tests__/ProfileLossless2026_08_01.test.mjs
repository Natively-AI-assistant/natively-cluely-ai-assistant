// Deep-test defect D1 (2026-08-01) — Profile Intelligence completeness.
//
// The V3 profile corpus was ONLY the deterministic renders of structured_data:
// projects[].highlights were never rendered (metrics fabricated), leadership
// had zero readers, and anything without a schema slot (canary lines, a 7-stage
// interview list) was unrecoverable forever. The port now renders highlights +
// leadership and carries chunked RAW document text as a lossless floor.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createProfileRetrievalPort, renderProfileSections } =
  await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const structuredResume = {
  identity: { name: 'Rohan Varma', summary: 'Software engineer', location: 'Kochi, India' },
  skills: { languages: ['TypeScript', 'Python', 'Rust'], frameworks: ['React', 'FastAPI'] },
  experience: [{
    role: 'Backend Engineering Intern', company: 'NovaWorks',
    start_date: 'July 2025', end_date: 'October 2025',
    bullets: ['Reduced median API latency to 92 ms.'],
  }],
  projects: [{
    name: 'SignalNest', description: 'Desktop AI workflow assistant.',
    highlights: ['Reached 27,450 registered users.', 'Earned 2,140 GitHub stars.', 'Generated USD 38,600 in cumulative revenue.'],
    technologies: ['Electron', 'React', 'TypeScript', 'SQLite'],
  }],
  education: [{ degree: 'B.Tech', field: 'CSE', institution: 'Cochin Institute of Technology', gpa: '8.37/10' }],
  leadership: [{ title: 'Technical lead', description: 'QR event check-in system used by 680 attendees' }],
};

const rawResumeText = [
  '# Rohan Varma - Test Resume',
  '## Projects',
  '### SignalNest',
  '- Reached 27,450 registered users.',
  '## Explicit Boundaries',
  'This resume does not claim Kubernetes experience.',
  '**Resume canary:** PROFILE-RESUME-CANARY-837',
].join('\n');

const structuredJd = {
  title: 'Software Engineer II', company: 'Nimbus Labs', location: 'Bengaluru, India',
  compensation_hint: 'INR 38-52 LPA', min_years_experience: 2,
  requirements: ['2+ years of professional software-development experience', 'Hands-on Kubernetes experience'],
  nice_to_haves: ['gRPC', 'Kafka'],
  responsibilities: ['Build reliable backend services'],
  technologies: ['Java', 'Go', 'Python'], keywords: ['Kubernetes'],
};

const rawJdText = [
  '# Nimbus Labs - Software Engineer II',
  '## Interview Process',
  'The process has 7 stages:',
  '1. Application review',
  '2. Recruiter screen',
  '3. Online coding assessment',
  '4. Technical phone interview',
  '5. Two coding interviews',
  '6. Systems-design interview',
  '7. Hiring committee and offer discussion',
  '**JD canary:** PROFILE-JD-CANARY-752',
].join('\n');

const mkPort = () => createProfileRetrievalPort({
  docs: [
    { kind: 'resume', sourceId: 'psrc_res', versionId: 'v1', fileName: 'Resume (PI)', structured: structuredResume, rawText: rawResumeText },
    { kind: 'jd', sourceId: 'psrc_jd', versionId: 'v1', fileName: 'JD (PI)', structured: structuredJd, rawText: rawJdText },
  ],
  allowedSourceTypes: MODE_POLICIES['looking-for-work'].allowedSourceTypes,
  profileSources: MODE_POLICIES['looking-for-work'].profileSources,
  userId: 'u1',
});

const ask = async (q) => {
  const port = mkPort();
  assert.ok(port, 'port must construct');
  const decision = decide({
    requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'looking-for-work',
    scope: { userId: 'u1', modeId: 'looking-for-work' }, sessionId: 's',
    manualQuestion: q, hasAttachedDocuments: true,
  });
  const { evidence } = await port.retrieve({ decision });
  return { decision, evidence, joined: evidence.map((e) => e.content).join('\n') };
};

describe('D1: structured renders carry project metrics and leadership', () => {
  test('renderProfileSections includes highlights verbatim', () => {
    const sections = renderProfileSections('resume', structuredResume);
    const project = sections.find((s) => s.section.startsWith('Project: SignalNest'));
    assert.ok(project, 'project section missing');
    assert.match(project.text, /27,450 registered users/);
    assert.match(project.text, /2,140 GitHub stars/);
  });

  test('renderProfileSections includes leadership', () => {
    const sections = renderProfileSections('resume', structuredResume);
    const lead = sections.find((s) => s.section === 'Leadership');
    assert.ok(lead, 'leadership section missing');
    assert.match(lead.text, /680 attendees/);
  });
});

describe('D1: end-to-end port retrieval of the failing facts', () => {
  test('SignalNest registered users retrieves 27,450', async () => {
    const { evidence, joined } = await ask('How many registered users does SignalNest have?');
    assert.ok(evidence.length > 0, 'no evidence retrieved');
    assert.match(joined, /27,450 registered users/);
  });

  test('the résumé canary is retrievable', async () => {
    const { joined } = await ask('What is the resume canary?');
    assert.match(joined, /PROFILE-RESUME-CANARY-837/);
  });

  test('the JD canary is retrievable', async () => {
    const { joined } = await ask('What is the JD canary?');
    assert.match(joined, /PROFILE-JD-CANARY-752/);
  });

  test('the seven-stage interview process is retrievable in full', async () => {
    const { joined } = await ask('What is the seven-stage interview process?');
    for (const stage of ['Application review', 'Recruiter screen', 'Online coding assessment',
      'Technical phone interview', 'Two coding interviews', 'Systems-design interview',
      'Hiring committee']) {
      assert.match(joined, new RegExp(stage), `stage missing: ${stage}`);
    }
  });

  test('NON-REGRESSION: CGPA still retrieves from the structured education record', async () => {
    const { joined } = await ask('What is my CGPA?');
    assert.match(joined, /8\.37\/10/);
  });

  test('NON-REGRESSION: base salary still retrieves from the JD compensation section', async () => {
    const { joined } = await ask('What is the base salary for this role?');
    assert.match(joined, /INR 38-52 LPA/);
  });
});
