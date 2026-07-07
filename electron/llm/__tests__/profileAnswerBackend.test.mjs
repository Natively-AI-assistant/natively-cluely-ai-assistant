import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildManualProfileEvidenceRoute, buildManualProfileBackendAnswer } = require('../../../dist-electron/electron/llm/profileAnswerBackend.js');

const PROFILES = [
  {
    id: 'backend-engineer',
    name: 'Aarav Menon',
    forbidden: ['Maya Iyer', 'Rahul Nair', 'Sara Thomas', 'Daniel Joseph', 'Sales Dashboard', 'Kubernetes Rollout', 'Roadmap Portal', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Aarav Menon' },
      skills: ['Node.js', 'PostgreSQL', 'Redis'],
      experience: [{ role: 'Backend Engineer', company: 'LedgerWorks', bullets: ['Scaled payment APIs'] }],
      projects: [{ name: 'Inventory API', description: 'Real-time stock service', technologies: ['Node.js', 'PostgreSQL'] }],
    },
    jd: { title: 'Senior Backend Engineer', company: 'Nimbus Retail', requirements: ['Node.js services', 'PostgreSQL schema design'], technologies: ['Node.js', 'PostgreSQL', 'Redis'] },
    expected: ['Aarav Menon', 'Backend Engineer', 'LedgerWorks', 'Inventory API', 'Node.js', 'PostgreSQL', 'Senior Backend Engineer', 'Nimbus Retail'],
  },
  {
    id: 'data-analyst',
    name: 'Maya Iyer',
    forbidden: ['Aarav Menon', 'Rahul Nair', 'Sara Thomas', 'Daniel Joseph', 'Inventory API', 'Kubernetes Rollout', 'Roadmap Portal', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Maya Iyer' },
      skills: ['SQL', 'Tableau', 'Python'],
      experience: [{ role: 'Data Analyst', company: 'BrightMetrics', bullets: ['Built revenue dashboards'] }],
      projects: [{ name: 'Sales Dashboard', description: 'Executive sales analytics', technologies: ['Tableau', 'SQL'] }],
    },
    jd: { title: 'Analytics Consultant', company: 'Northstar Insights', requirements: ['dashboard storytelling', 'SQL analysis'], technologies: ['SQL', 'Tableau'] },
    expected: ['Maya Iyer', 'Data Analyst', 'BrightMetrics', 'Sales Dashboard', 'SQL', 'Tableau', 'Analytics Consultant', 'Northstar Insights'],
  },
  {
    id: 'devops-engineer',
    name: 'Rahul Nair',
    forbidden: ['Aarav Menon', 'Maya Iyer', 'Sara Thomas', 'Daniel Joseph', 'Inventory API', 'Sales Dashboard', 'Roadmap Portal', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Rahul Nair' },
      skills: ['Kubernetes', 'Terraform', 'AWS'],
      experience: [{ role: 'DevOps Engineer', company: 'CloudForge', bullets: ['Automated deployment platforms'] }],
      projects: [{ name: 'Kubernetes Rollout', description: 'Cluster migration program', technologies: ['Kubernetes', 'Terraform'] }],
    },
    jd: { title: 'Platform Reliability Engineer', company: 'Orbit Systems', requirements: ['cloud infrastructure', 'Kubernetes operations'], technologies: ['Kubernetes', 'AWS', 'Terraform'] },
    expected: ['Rahul Nair', 'DevOps Engineer', 'CloudForge', 'Kubernetes Rollout', 'Kubernetes', 'Terraform', 'Platform Reliability Engineer', 'Orbit Systems'],
  },
  {
    id: 'product-manager',
    name: 'Sara Thomas',
    forbidden: ['Aarav Menon', 'Maya Iyer', 'Rahul Nair', 'Daniel Joseph', 'Inventory API', 'Sales Dashboard', 'Kubernetes Rollout', 'Pipeline Sequencer'],
    resume: {
      identity: { name: 'Sara Thomas' },
      skills: ['Roadmapping', 'User Research', 'A/B Testing'],
      experience: [{ role: 'Product Manager', company: 'LaunchPad', bullets: ['Led checkout growth experiments'] }],
      projects: [{ name: 'Roadmap Portal', description: 'Customer feedback prioritization hub', technologies: ['Productboard', 'Amplitude'] }],
    },
    jd: { title: 'Growth Product Manager', company: 'Helio Apps', requirements: ['experimentation', 'customer discovery'], technologies: ['Amplitude', 'Productboard'] },
    expected: ['Sara Thomas', 'Product Manager', 'LaunchPad', 'Roadmap Portal', 'Roadmapping', 'User Research', 'Growth Product Manager', 'Helio Apps'],
  },
  {
    id: 'sales-development',
    name: 'Daniel Joseph',
    forbidden: ['Aarav Menon', 'Maya Iyer', 'Rahul Nair', 'Sara Thomas', 'Inventory API', 'Sales Dashboard', 'Kubernetes Rollout', 'Roadmap Portal'],
    resume: {
      identity: { name: 'Daniel Joseph' },
      skills: ['Prospecting', 'HubSpot', 'Cold Email'],
      experience: [{ role: 'Sales Development Rep', company: 'PipelineCo', bullets: ['Generated enterprise pipeline'] }],
      projects: [{ name: 'Pipeline Sequencer', description: 'Outbound campaign automation', technologies: ['HubSpot', 'Apollo'] }],
    },
    jd: { title: 'Enterprise SDR', company: 'QuotaSpring', requirements: ['outbound prospecting', 'CRM hygiene'], technologies: ['HubSpot', 'Apollo'] },
    expected: ['Daniel Joseph', 'Sales Development Rep', 'PipelineCo', 'Pipeline Sequencer', 'Prospecting', 'HubSpot', 'Enterprise SDR', 'QuotaSpring'],
  },
];

function makeOrchestrator(profile) {
  return {
    activeResume: { structured_data: profile.resume },
    activeJD: { structured_data: profile.jd },
  };
}

function evidenceText(result) {
  return JSON.stringify(result.route?.items?.map((item) => item.value) ?? []);
}

function route(profile, question) {
  const result = buildManualProfileEvidenceRoute({
    question,
    orchestrator: makeOrchestrator(profile),
    source: 'manual_input',
  });
  assert.ok(result.route, `${profile.id}: expected backend evidence route for ${question}`);
  assert.equal(result.route.answer, undefined);
  assert.equal(result.route.usedDeterministicFastPath, false);
  assert.equal(result.route.usedDeterministicEvidenceSelection, true);
  assert.equal(result.route.providerUsed, true);
  assert.equal(result.route.finalGenerationMode, 'jit_llm');
  return result;
}

function assertNoLeak(text, forbidden) {
  for (const value of forbidden) {
    assert.doesNotMatch(text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `evidence leaked ${value}: ${text}`);
  }
}

describe('backend profile evidence path used by frontend chat IPC', () => {
  test('selects profile evidence for five synthetic profiles from current structured backend state only', () => {
    for (const profile of PROFILES) {
      const name = route(profile, 'what is my name?');
      assert.match(evidenceText(name), new RegExp(profile.name, 'i'));
      assertNoLeak(evidenceText(name), profile.forbidden);

      const experience = route(profile, 'what are my experiences?');
      assert.match(evidenceText(experience), new RegExp(profile.expected[1], 'i'));
      assert.match(evidenceText(experience), new RegExp(profile.expected[2], 'i'));
      assertNoLeak(evidenceText(experience), profile.forbidden);

      const projects = route(profile, 'what projects have I done?');
      assert.match(evidenceText(projects), new RegExp(profile.expected[3], 'i'));
      assertNoLeak(evidenceText(projects), profile.forbidden);

      const skills = route(profile, 'what are my skills?');
      assert.match(evidenceText(skills), new RegExp(profile.expected[4], 'i'));
      assert.match(evidenceText(skills), new RegExp(profile.expected[5], 'i'));
      assertNoLeak(evidenceText(skills), profile.forbidden);

      const jdFit = route(profile, 'how do I fit this JD?');
      assert.match(evidenceText(jdFit), new RegExp(profile.expected[6], 'i'));
      assert.match(evidenceText(jdFit), new RegExp(profile.expected[7], 'i'));
      assert.match(evidenceText(jdFit), new RegExp(profile.expected[4], 'i'));
      assertNoLeak(evidenceText(jdFit), profile.forbidden);
    }
  });

  test('resume replacement uses latest backend structured state without leaking old facts', () => {
    const orchestrator = makeOrchestrator(PROFILES[0]);
    let result = buildManualProfileEvidenceRoute({ question: 'what is my name?', orchestrator, source: 'manual_input' });
    assert.match(evidenceText(result), /Aarav Menon/);
    assert.equal(result.route?.answer, undefined);

    orchestrator.activeResume = { structured_data: PROFILES[1].resume };
    orchestrator.activeJD = { structured_data: PROFILES[1].jd };

    result = buildManualProfileEvidenceRoute({ question: 'what is my name?', orchestrator, source: 'manual_input' });
    assert.match(evidenceText(result), /Maya Iyer/);

    const projects = buildManualProfileEvidenceRoute({ question: 'what projects have I done?', orchestrator, source: 'manual_input' });
    assert.match(evidenceText(projects), /Sales Dashboard/);
    assert.doesNotMatch(evidenceText(projects), /Aarav Menon|Inventory API/);
  });

  test('fresh backend object after restart loads latest persisted structured profile', () => {
    const latestPersisted = { resume: PROFILES[3].resume, jd: PROFILES[3].jd };
    const restartedOrchestrator = {
      activeResume: { structured_data: latestPersisted.resume },
      activeJD: { structured_data: latestPersisted.jd },
    };

    const result = buildManualProfileEvidenceRoute({ question: 'what is my name?', orchestrator: restartedOrchestrator, source: 'manual_input' });
    assert.match(evidenceText(result), /Sara Thomas/);
    assert.equal(result.route?.answer, undefined);
  });

  test('multiple backend sessions do not cross-contaminate profile context', () => {
    const sessionA = makeOrchestrator(PROFILES[2]);
    const sessionB = makeOrchestrator(PROFILES[4]);

    const a = buildManualProfileEvidenceRoute({ question: 'what projects have I done?', orchestrator: sessionA, source: 'manual_input' });
    const b = buildManualProfileEvidenceRoute({ question: 'what projects have I done?', orchestrator: sessionB, source: 'manual_input' });

    assert.match(evidenceText(a), /Kubernetes Rollout/);
    assert.doesNotMatch(evidenceText(a), /Pipeline Sequencer|Daniel Joseph/);
    assert.match(evidenceText(b), /Pipeline Sequencer/);
    assert.doesNotMatch(evidenceText(b), /Kubernetes Rollout|Rahul Nair/);
  });

  test('deprecated backend alias is evidence-only, not final-answer prose', () => {
    const result = buildManualProfileBackendAnswer({
      question: 'what is my name?',
      orchestrator: makeOrchestrator(PROFILES[0]),
      source: 'manual_input',
    });
    assert.ok(result.route);
    assert.equal(result.route.answer, undefined);
    assert.equal(result.route.usedDeterministicFastPath, false);
    assert.match(evidenceText(result), /Aarav Menon/);
  });
});
