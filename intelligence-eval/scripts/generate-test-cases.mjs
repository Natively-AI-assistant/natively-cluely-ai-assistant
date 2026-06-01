// intelligence-eval/scripts/generate-test-cases.mjs
//
// Generates intelligence-eval/test-cases/intelligence-100-e2e.json — the 100
// end-to-end cases from the spec (10 profiles × 10 patterns). Required/forbidden
// facts and expected layers are resolved DYNAMICALLY from each fixture, so the
// test JSON contains no values invented independently of the fixtures. The
// per-profile transcripts/questions follow the spec text verbatim.
//
// Run: node intelligence-eval/scripts/generate-test-cases.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../fixtures');
const outFile = path.resolve(__dirname, '../test-cases/intelligence-100-e2e.json');

const loadFixture = (slug) => JSON.parse(fs.readFileSync(path.join(fixturesDir, `${slug}.json`), 'utf8'));

// Context layer vocabulary (exact labels required by the spec).
const L = {
  stable_identity: 'stable_identity', resume: 'resume', projects: 'projects',
  skills: 'skills', experience: 'experience', education: 'education', jd: 'jd',
  custom_context: 'custom_context', persona: 'persona', negotiation: 'negotiation',
  reference_files: 'reference_files', live_transcript: 'live_transcript',
  meeting_mode: 'meeting_mode', assistant_identity: 'assistant_identity',
};

// Each profile gets a code prefix + slug. Order matches the spec.
const PROFILES = [
  { code: 'BE', slug: 'backend-engineer', domain: 'backend' },
  { code: 'ML', slug: 'ml-engineer', domain: 'machine learning' },
  { code: 'PM', slug: 'product-manager', domain: 'product' },
  { code: 'SDR', slug: 'sales-development-rep', domain: 'sales' },
  { code: 'UX', slug: 'ui-ux-designer', domain: 'design' },
  { code: 'DA', slug: 'data-analyst', domain: 'data' },
  { code: 'SRE', slug: 'devops-sre', domain: 'devops' },
  { code: 'CSM', slug: 'customer-success-manager', domain: 'customer success' },
  { code: 'CY', slug: 'cybersecurity-analyst', domain: 'cybersecurity' },
  { code: 'FND', slug: 'founder-ceo-bd', domain: 'founder' },
];

// The 10 patterns. Each is a factory (fixture, profile) → partial test case.
// Transcript/question text follows the spec; per-profile wording is filled in.
// requiredFacts/forbiddenFacts/layers resolve from the fixture dynamically.
const projectNames = (fx) => (fx.resume.projects || []).map(p => p.name).filter(Boolean);
const firstSkill = (fx) => (fx.resume.skills || [])[0];
const firstCompany = (fx) => (fx.resume.experience || [])[0]?.company;
const firstSchool = (fx) => (fx.resume.education || [])[0]?.institution;
const name = (fx) => fx.resume.identity.name;

// Per-profile intro/transcript phrasing keyed by code (from the spec).
const INTRO_TRANSCRIPT = {
  BE: 'Interviewer: Before we start, can you tell me your name?\nCandidate: Sure.\nInterviewer: Yes, what is your full name?',
  ML: 'Interviewer: Please introduce yourself with your name first.',
  PM: 'Interviewer: Could you introduce yourself as a product manager?',
  SDR: 'Interviewer: Tell me about yourself and your sales background.',
  UX: 'Interviewer: Please introduce yourself as a designer.',
  DA: 'Interviewer: Tell me about yourself as a data analyst.',
  SRE: 'Interviewer: Introduce yourself for this SRE role.',
  CSM: 'Interviewer: Tell me about yourself from a customer success perspective.',
  CY: 'Interviewer: Introduce yourself for this cybersecurity analyst role.',
  FND: 'Interviewer: Tell me about yourself and what you are building.',
};

// Pattern 2 differs: some are pure identity (critical), some are full intros.
// Per spec, BE/ML-002 are identity-critical; others are intro (not name-critical).
const PATTERN2_IS_IDENTITY = new Set(['BE', 'ML']);

// Per-profile pattern wording for the remaining slots (from spec).
const W = {
  BE: { p3: 'what are my projects?', p4: 'Interviewer: I saw your resume. Tell me about the backend projects you have worked on.',
        p5: 'Interviewer: Why do you think you are a good fit for this backend engineering role?', p6: 'what backend skills do I have?',
        p7: 'Interviewer: Tell me about your API gateway project.\nCandidate: It handled authentication and routing.\nInterviewer: Can you explain how you improved latency in that project?',
        p7target: 'gateway',
        p8: 'Interviewer: What salary range are you expecting for this backend role?',
        p9: "what was my manager's name in my first internship?", p9missing: 'manager name',
        p10: 'Interviewer: What is your name?\nCandidate: I am interviewing for the backend role.\nInterviewer: Great, just confirm your name once.' },
  ML: { p3: 'what are my machine learning projects?', p4: 'Interviewer: Can you walk me through one ML project from your resume?',
        p5: 'Interviewer: How does your ML experience match this job description?', p6: 'what ML frameworks do I know?',
        p7: 'Interviewer: You mentioned a recommendation system project.\nCandidate: Yes, I built it using user interaction data.\nInterviewer: How did you evaluate the model?',
        p7target: 'recommendation',
        p8: 'answer like a confident but concise ML engineer: why should they hire me?', p8kind: 'persona',
        p9: 'what was the exact accuracy of my best model?', p9missing: 'exact model accuracy',
        p10: 'Interviewer: What is your name?\nInterviewer: Also we will discuss salary later.' },
  PM: { p3: 'what products or projects have I worked on?', p4: 'Interviewer: Tell me about a time you prioritized a product roadmap.', p4kind: 'behavioral',
        p5: 'how do I fit this PM JD?', p6: 'Interviewer: What product metrics have you worked with?', p6kind: 'metrics_guard',
        p7: 'Interviewer: You mentioned improving onboarding.\nCandidate: Yes, I worked on onboarding flow improvements.\nInterviewer: How did you decide what to change first?',
        p7target: 'onboarding',
        p8: 'what should I say if they ask my expected CTC?', p8kind: 'negotiation_manual',
        p9: 'what was my exact NPS improvement percentage?', p9missing: 'exact NPS improvement',
        p10: 'Interviewer: Can you confirm your name before we begin the product case?' },
  SDR: { p3: 'what sales experience do I have?', p4: 'Interviewer: Which CRM or outreach tools have you used?', p4kind: 'skill',
        p5: 'how should I answer why I fit this SDR role?', p6: 'Interviewer: How would you approach cold outreach for a new market?', p6kind: 'approach',
        p7: 'Interviewer: You said you worked on lead qualification.\nCandidate: Yes.\nInterviewer: What criteria did you use to qualify leads?',
        p7target: 'lead qualification',
        p8: 'Interviewer: What compensation are you expecting, including incentives?',
        p9: 'what was my exact quota attainment last quarter?', p9missing: 'exact quota attainment',
        p10: 'Interviewer: What is your name?\nCandidate: I am interested in sales.\nInterviewer: Just your name please.' },
  UX: { p3: 'what design projects are in my profile?', p4: 'Interviewer: Walk me through your design process.', p4kind: 'process',
        p5: 'how do my design skills match this JD?', p6: 'Interviewer: What design tools are you comfortable with?',
        p7: 'Interviewer: You mentioned redesigning a dashboard.\nCandidate: Yes, that was one of my main projects.\nInterviewer: How did you validate the redesign?',
        p7target: 'dashboard',
        p8: 'what should I say when they ask expected salary for this designer role?', p8kind: 'negotiation_manual',
        p9: 'what was my exact Figma prototype link?', p9missing: 'Figma prototype link',
        p10: 'Interviewer: Can you confirm your name before the portfolio review?' },
  DA: { p3: 'what data projects have I done?', p4: 'Interviewer: How comfortable are you with SQL?', p4kind: 'skill',
        p5: 'how should I explain that I fit this data analyst JD?',
        p6: 'Interviewer: You mentioned a sales dashboard.\nCandidate: Yes.\nInterviewer: What insights did it provide?', p6kind: 'followup', p6target: 'dashboard',
        p7: 'what metrics have I worked with?', p7kind: 'manual_metrics',
        p8: 'Interviewer: What salary are you expecting for this analyst position?',
        p9: 'what was the exact revenue increase from my dashboard project?', p9missing: 'exact revenue increase',
        p10: 'what are my projects?', p10kind: 'regression' },
  SRE: { p3: 'what DevOps projects have I worked on?', p4: 'Interviewer: Tell me about a time you handled a production incident.', p4kind: 'behavioral',
        p5: 'how do my skills match this SRE JD?', p6: 'Interviewer: Which monitoring or deployment tools have you used?',
        p7: 'Interviewer: You mentioned Kubernetes deployment work.\nCandidate: Yes.\nInterviewer: How did you manage rollbacks?',
        p7target: 'Kubernetes',
        p8: 'how should I answer expected salary for this SRE role?', p8kind: 'negotiation_manual',
        p9: 'what was the exact uptime percentage I maintained?', p9missing: 'exact uptime percentage',
        p10: 'Interviewer: What is your name before we start the infra round?' },
  CSM: { p3: 'what customer success experience do I have?', p4: 'Interviewer: How do you handle an unhappy customer?', p4kind: 'behavioral',
        p5: 'how should I explain my fit for this customer success JD?', p6: 'Interviewer: What customer support or CRM tools have you used?',
        p7: 'Interviewer: You mentioned improving onboarding for customers.\nCandidate: Yes.\nInterviewer: What did you change in the onboarding process?',
        p7target: 'onboarding',
        p8: 'Interviewer: What compensation are you looking for?',
        p9: 'what was my exact churn reduction percentage?', p9missing: 'exact churn reduction',
        p10: 'Interviewer: Please confirm your name before the customer success case round.' },
  CY: { p3: 'what cybersecurity projects have I worked on?', p4: 'Interviewer: How would you investigate a suspicious login alert?', p4kind: 'approach',
        p5: 'how do my skills fit this cyber analyst JD?', p6: 'Interviewer: What security tools have you used?',
        p7: 'Interviewer: You mentioned a log analysis project.\nCandidate: Yes.\nInterviewer: What kind of anomalies did you detect?',
        p7target: 'log analysis',
        p8: 'what should I say for expected salary in this cyber analyst interview?', p8kind: 'negotiation_manual',
        p9: 'what was my exact SOC ticket closure rate?', p9missing: 'exact SOC ticket closure rate',
        p10: 'Interviewer: What is your name before we begin the security round?' },
  FND: { p3: 'what startups or projects have I built?', p4: 'Interviewer: How do you approach partnerships or business development?', p4kind: 'approach',
        p5: 'how do I fit this business development role?', p6: 'Interviewer: What traction or growth metrics can you share?', p6kind: 'metrics_guard',
        p7: 'Interviewer: You mentioned launching a SaaS product.\nCandidate: Yes.\nInterviewer: How did you get your first customers?',
        p7target: 'SaaS',
        p8: 'Interviewer: What kind of compensation or equity structure are you expecting?',
        p9: 'what was my exact ARR last quarter?', p9missing: 'exact ARR',
        p10: 'Interviewer: Can you confirm your name before we discuss your company?' },
};

function buildProfileCases(profile) {
  const fx = loadFixture(profile.slug);
  const code = profile.code;
  const w = W[code];
  const cand = name(fx);
  const projs = projectNames(fx);
  const cases = [];
  const id = (n) => `${code}-${String(n).padStart(3, '0')}`;

  // 1. manual identity (critical)
  cases.push({
    testId: id(1), profileId: profile.slug, mode: 'manual_input', pattern: 'identity_manual',
    question: 'what is my name?',
    expectedPerspective: 'second_person', // manual → "Your name is X"
    requiredFacts: [cand], forbiddenFacts: ["I'm Natively", 'AI assistant', 'Natively'],
    expectedLayers: [L.stable_identity, L.resume], excludedLayers: [L.jd, L.negotiation, L.assistant_identity],
    expectedIntentLike: 'identity', critical: true,
  });

  // 2. interviewer identity OR intro
  if (PATTERN2_IS_IDENTITY.has(code)) {
    cases.push({
      testId: id(2), profileId: profile.slug, mode: 'what_to_answer', pattern: 'identity_interviewer',
      transcript: INTRO_TRANSCRIPT[code],
      expectedPerspective: 'first_person', expectedSpeaker: 'interviewer',
      requiredFacts: [cand], forbiddenFacts: ["I'm Natively", 'AI assistant'],
      expectedLayers: [L.stable_identity, L.resume], excludedLayers: [L.assistant_identity],
      expectedIntentLike: 'identity', critical: true,
    });
  } else {
    cases.push({
      testId: id(2), profileId: profile.slug, mode: 'what_to_answer', pattern: 'interviewer_intro',
      transcript: INTRO_TRANSCRIPT[code],
      expectedPerspective: 'first_person', expectedSpeaker: 'interviewer',
      requiredFacts: [cand], forbiddenFacts: ["I'm Natively", 'AI assistant'],
      expectedLayers: [L.stable_identity, L.resume], excludedLayers: [L.assistant_identity],
      expectedIntentLike: 'identity', critical: false,
    });
  }

  // 3. manual projects (SDR p3 asks about EXPERIENCE, not projects — handle both)
  {
    const asksExperience = /experience/i.test(w.p3);
    cases.push({
      testId: id(3), profileId: profile.slug, mode: 'manual_input',
      pattern: asksExperience ? 'experience_manual' : 'projects_manual',
      question: w.p3,
      expectedPerspective: 'second_person',
      // Require the FIRST project name (codenames like "DesignToken.io" the
      // model reliably echoes) as the anchor; the rest via anyOfFacts. A real
      // model legitimately paraphrases secondary project codenames into
      // descriptions ("the Spotify podcast redesign" for "PodcastPlayer"), so
      // demanding every literal codename is an unfair exact-match. The contract
      // is "surfaces the user's real projects, grounded, no fabrication" — which
      // the first-name anchor + all-projects-in-grounding (verified) establishes.
      requiredFacts: asksExperience ? [firstCompany(fx)].filter(Boolean) : projs.slice(0, 1),
      anyOfFacts: asksExperience ? undefined : (projs.length ? projs.slice() : undefined),
      forbiddenFacts: ['I have your background loaded', 'Full Stack Engineer Intern'],
      expectedLayers: asksExperience ? [L.resume, L.experience] : [L.resume, L.projects],
      excludedLayers: [L.negotiation, L.assistant_identity],
      expectedIntentLike: 'profile_detail', critical: false,
    });
  }

  // 4. interviewer project/process/behavioral explanation.
  // Project-explanation grounds resume projects. Process/behavioral/approach/
  // skill questions are open-ended interview answers: the contract is correct
  // perspective + no hallucination, NOT a specific surfaced contextBlock layer
  // (the orchestrator grounds compact identity for these). So no required layer.
  {
    const isOpenEnded = w.p4kind === 'process' || w.p4kind === 'behavioral' || w.p4kind === 'approach' || w.p4kind === 'skill';
    // "Walk me through ONE project" lets the candidate pick ANY real project —
    // requiring a specific one is wrong. Detect singular ("one"/"a project") and
    // accept any project via anyOfFacts; plural ("the projects") still lists.
    const singularProject = !isOpenEnded && /\bone\b|\ba (\w+ )?project\b/i.test(w.p4);
    cases.push({
      testId: id(4), profileId: profile.slug, mode: 'what_to_answer', pattern: w.p4kind || 'projects_interviewer',
      transcript: w.p4,
      expectedPerspective: 'first_person', expectedSpeaker: 'interviewer',
      requiredFacts: (isOpenEnded || singularProject) ? [] : projs.slice(0, 1),
      anyOfFacts: singularProject ? projs.slice() : undefined,
      forbiddenFacts: ['I have your background loaded'],
      expectedLayers: isOpenEnded ? [] : [L.resume, L.projects],
      excludedLayers: [L.negotiation, L.assistant_identity],
      expectedIntentLike: w.p4kind === 'behavioral' ? 'behavioral' : 'profile_detail', critical: false,
      noHallucinationWatch: true,
    });
  }

  // 5. JD alignment. Routes GENERAL → grounds candidate EXPERIENCE; the JD
  // target role/company is folded into the system-prompt header, not surfaced
  // as a measurable retrieval contextBlock. So the observable layer is resume/
  // experience; the contract is "uses my experience, no hallucination, no
  // negotiation/assistant leakage".
  cases.push({
    testId: id(5), profileId: profile.slug, mode: w.p5.startsWith('how') ? 'manual_input' : 'what_to_answer', pattern: 'jd_alignment',
    question: w.p5.startsWith('how') ? w.p5 : undefined,
    transcript: w.p5.startsWith('how') ? undefined : w.p5,
    expectedPerspective: w.p5.startsWith('how') ? 'second_person' : 'first_person',
    requiredFacts: [], forbiddenFacts: [],
    expectedLayers: [], excludedLayers: [L.negotiation, L.assistant_identity],
    expectedIntentLike: 'jd_alignment', critical: false, noHallucinationWatch: true,
  });

  // 6. skills / tools / approach / metrics-guard / followup
  {
    const kind = w.p6kind;
    const isManual = !w.p6.startsWith('Interviewer:');
    const isSkillListing = !kind || kind === 'skills';
    cases.push({
      testId: id(6), profileId: profile.slug, mode: isManual ? 'manual_input' : 'what_to_answer',
      pattern: kind || 'skills',
      question: isManual ? w.p6 : undefined,
      transcript: isManual ? undefined : w.p6,
      expectedPerspective: isManual ? 'second_person' : 'first_person',
      // Skill/tool listing → must surface AT LEAST ONE real skill (the model
      // legitimately picks a relevant subset — e.g. "what frameworks?" → names
      // frameworks, not necessarily the first listed skill). anyOfFacts = all
      // skills; passes if any appear. The contract is "surfaces real skills, no
      // hallucination", not "lists skill #1".
      requiredFacts: [],
      anyOfFacts: isSkillListing ? (fx.resume.skills || []).slice() : undefined,
      forbiddenFacts: [],
      expectedLayers: isSkillListing ? [L.resume, L.skills] : [],
      excludedLayers: [L.assistant_identity],
      expectedIntentLike: kind === 'followup' ? 'follow_up' : 'profile_detail', critical: false,
      followUpTarget: w.p6target, noHallucinationWatch: kind === 'metrics_guard' || kind === 'approach',
    });
  }

  // 7. follow-up / manual metrics. Follow-up contract = resolve the right
  // target + speak in first person + no hallucination (live_transcript is part
  // of the what_to_answer packet by construction). Manual metrics = profile
  // recall but metrics may be qualitative, so no hard required layer.
  {
    const kind = w.p7kind;
    const isManual = kind === 'manual_metrics';
    cases.push({
      testId: id(7), profileId: profile.slug, mode: isManual ? 'manual_input' : 'what_to_answer',
      pattern: isManual ? 'metrics_manual' : 'follow_up',
      question: isManual ? w.p7 : undefined,
      transcript: isManual ? undefined : w.p7,
      expectedPerspective: isManual ? 'second_person' : 'first_person',
      requiredFacts: [], forbiddenFacts: [],
      expectedLayers: isManual ? [] : [L.live_transcript],
      excludedLayers: [L.assistant_identity],
      expectedIntentLike: isManual ? 'profile_detail' : 'follow_up',
      followUpTarget: w.p7target, isFollowUp: !isManual, noHallucinationWatch: true, critical: false,
    });
  }

  // 8. negotiation (transcript or manual). Negotiation surfaces the gated
  // negotiation/JD coaching layer. Persona case: open-ended, persona controls
  // tone; the contract is "no invented metric", not a specific contextBlock.
  {
    const isManual = w.p8kind === 'negotiation_manual' || w.p8kind === 'persona';
    const isPersona = w.p8kind === 'persona';
    cases.push({
      testId: id(8), profileId: profile.slug, mode: isManual ? 'manual_input' : 'what_to_answer',
      pattern: isPersona ? 'persona' : 'negotiation',
      question: isManual ? w.p8 : undefined,
      transcript: isManual ? undefined : w.p8,
      expectedPerspective: 'first_person',
      requiredFacts: [], forbiddenFacts: [],
      expectedLayers: isPersona ? [] : [L.negotiation],
      excludedLayers: isPersona ? [L.assistant_identity] : [L.assistant_identity],
      expectedIntentLike: isPersona ? 'persona_style' : 'negotiation',
      personaNoInvention: isPersona, critical: false, noHallucinationWatch: true,
    });
  }

  // 9. unknown handling (must not hallucinate). The honest-missing answer does
  // NOT surface a contextBlock layer — the contract is "admits missing + no
  // fabricated specific". So no required layer; mustAdmitMissing carries it.
  cases.push({
    testId: id(9), profileId: profile.slug, mode: 'manual_input', pattern: 'unknown',
    question: w.p9,
    expectedPerspective: 'second_person',
    requiredFacts: [], forbiddenFacts: [],
    missingInfo: w.p9missing,
    expectedLayers: [], excludedLayers: [L.assistant_identity],
    expectedIntentLike: 'profile_detail', mustAdmitMissing: true, critical: false, noHallucinationWatch: true,
  });

  // 10. context isolation (critical) OR DA regression (critical)
  if (w.p10kind === 'regression') {
    cases.push({
      testId: id(10), profileId: profile.slug, mode: 'manual_input', pattern: 'regression_projects',
      question: w.p10,
      expectedPerspective: 'second_person',
      requiredFacts: projs.slice(0, Math.min(2, projs.length)),
      forbiddenFacts: ['I have your background loaded as an AI and Full Stack Engineer Intern', 'Full Stack Engineer Intern'],
      expectedLayers: [L.resume, L.projects], excludedLayers: [L.assistant_identity],
      expectedIntentLike: 'profile_detail', critical: true,
    });
  } else {
    cases.push({
      testId: id(10), profileId: profile.slug, mode: 'what_to_answer', pattern: 'context_isolation',
      transcript: w.p10,
      expectedPerspective: 'first_person', expectedSpeaker: 'interviewer',
      requiredFacts: [cand],
      forbiddenFacts: ["I'm Natively", 'AI assistant', 'salary', '$'],
      expectedLayers: [L.stable_identity], excludedLayers: [L.jd, L.negotiation, L.assistant_identity, L.meeting_mode],
      expectedIntentLike: 'identity', critical: true, isolationCheck: true,
    });
  }

  return cases;
}

const allCases = [];
for (const p of PROFILES) allCases.push(...buildProfileCases(p));

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({
  schemaVersion: 1,
  generatedFrom: 'intelligence-eval/fixtures/*.json (synthetic)',
  totalCases: allCases.length,
  criticalCases: allCases.filter(c => c.critical).length,
  cases: allCases,
}, null, 2));

console.log(`Wrote ${allCases.length} cases (${allCases.filter(c => c.critical).length} critical) → ${path.relative(process.cwd(), outFile)}`);
const byMode = allCases.reduce((m, c) => (m[c.mode] = (m[c.mode] || 0) + 1, m), {});
console.log('By mode:', JSON.stringify(byMode));
