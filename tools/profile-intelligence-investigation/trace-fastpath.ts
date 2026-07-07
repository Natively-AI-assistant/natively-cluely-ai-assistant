// tools/profile-intelligence-investigation/trace-fastpath.ts
//
// Read-only investigation harness for the deterministic fast path
// (electron/llm/manualProfileIntelligence.ts). Given a question and structured
// profile facts, this runs tryBuildManualProfileFastPathAnswer and reports
// whether the fast path matched, which regex class matched, and what canned
// answer would have been emitted.
//
// IMPORTANT: this file does NOT touch any provider or storage. It only
// exercises the pure deterministic module.
//
// Run with: npx tsx tools/profile-intelligence-investigation/trace-fastpath.ts

import { tryBuildManualProfileFastPathAnswer } from '../../electron/llm/manualProfileIntelligence';

const PROFILE = {
  identity: { name: 'Evin John' },
  experience: [
    {
      role: 'Product Engineer',
      company: 'Company X',
      bullets: [
        'Built Natively, a desktop AI interview assistant',
        'Gained 4,000+ users and 500+ stars in one week',
      ],
      start_date: '2024-06',
      end_date: null,
    },
    {
      role: 'ML Intern',
      company: 'EstroTech Robotics',
      bullets: ['Trained perception models on the production floor'],
      start_date: '2023-06',
      end_date: '2023-08',
    },
  ],
  projects: [
    {
      name: 'Natively – Open Source AI Meeting Copilot',
      description: 'A privacy-first desktop AI copilot that runs locally',
      technologies: ['Electron', 'TypeScript', 'React', 'SQLite'],
      highlights: ['Gained 4,000+ users and 500+ stars in one week'],
    },
    { name: 'RedisMart', description: 'A high-performance e-commerce engine', technologies: ['Redis', 'Node.js'] },
  ],
  skills: {
    languages: ['TypeScript', 'Python', 'Rust'],
    frameworks: ['React', 'Electron', 'FastAPI'],
    cloud: ['AWS', 'GCP'],
  },
  education: [{ degree: 'B.S. in Computer Science', institution: 'MIT' }],
};

const JD = {
  title: 'AI Product Engineer',
  company: 'Acme',
  requirements: ['RAG', 'LLM', 'Electron', 'infra experience'],
};

const CASES: Array<{ name: string; question: string; source: 'manual_input' | 'what_to_answer' }> = [
  { name: 'name_intro', question: 'What is your name?', source: 'manual_input' },
  { name: 'intro', question: 'Tell me about yourself', source: 'manual_input' },
  { name: 'project_named', question: 'Tell me about Natively', source: 'manual_input' },
  { name: 'project_list', question: 'What are your projects?', source: 'manual_input' },
  { name: 'skills_lang', question: 'What programming languages are you strongest in?', source: 'manual_input' },
  { name: 'skills_experience', question: 'Have you used Python?', source: 'manual_input' },
  { name: 'current_role', question: 'What are you currently working on?', source: 'manual_input' },
  { name: 'duration_at_company', question: 'How long were you at EstroTech Robotics?', source: 'manual_input' },
  { name: 'total_experience', question: "What's your total internship experience?", source: 'manual_input' },
  { name: 'gap_between_roles', question: 'What is the gap between your EstroTech and Company X roles?', source: 'manual_input' },
  { name: 'jd_fit', question: 'How do I fit this role?', source: 'manual_input' },
  { name: 'role_target', question: 'What role am I applying for?', source: 'manual_input' },
  { name: 'canonical_conflict_test', question: 'Are you currently working anywhere?', source: 'manual_input' },
  { name: 'qualified_should_skip', question: 'What projects use Python?', source: 'manual_input' },
];

const out = (line: string) => process.stdout.write(line + '\n');

for (const tc of CASES) {
  out('============================================================');
  out(`Case: ${tc.name}`);
  out(`Question: "${tc.question}" | Source: ${tc.source}`);
  out('------------------------------------------------------------');

  try {
    const result = tryBuildManualProfileFastPathAnswer({
      question: tc.question,
      profile: PROFILE as any,
      jobDescription: JD as any,
      source: tc.source,
    });
    if (!result) {
      out(`  → NO fast-path match. Will go to LLM.`);
    } else {
      out(`  answerType            : ${result.answerType}`);
      out(`  selectedContextLayers : ${result.selectedContextLayers.join(', ') || '(none)'}`);
      out(`  excludedContextLayers : ${result.excludedContextLayers.join(', ') || '(none)'}`);
      out(`  profileFactsReady     : ${result.profileFactsReady}`);
      out(`  usedDeterministicFastPath : ${result.usedDeterministicFastPath}`);
      out(`  providerUsed          : ${result.providerUsed}`);
      out(`  → Canned answer:`);
      out(`    ${result.answer}`);
    }
  } catch (e: any) {
    out(`  → ERROR: ${e?.message || e}`);
  }
  out('');
}

out('Done. Deterministic fast-path trace. No state changed.');