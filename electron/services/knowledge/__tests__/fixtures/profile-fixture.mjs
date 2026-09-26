// electron/services/knowledge/__tests__/fixtures/profile-fixture.mjs
//
// Deterministic, synthetic (NOT real personal data) resume + JD fixtures for the
// OKF Profile Intelligence benchmark and Phase 1/2 tests. Shaped exactly like the
// premium engine's StructuredResume / StructuredJD (electron/knowledge/types.ts).

export const FIXTURE_RESUME = {
  identity: {
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    location: 'Austin, TX',
    github: 'github.com/alexrivera',
    summary:
      'Backend-leaning full-stack engineer with 6 years building distributed systems and developer tools. Ships pragmatic, well-tested services and mentors junior engineers.',
  },
  skills: {
    languages: ['Python', 'TypeScript', 'Go', 'SQL'],
    frameworks: ['FastAPI', 'React', 'Next.js'],
    cloud: ['AWS', 'GCP'],
    databases: ['PostgreSQL', 'Redis'],
    ml: ['PyTorch', 'LangChain'],
    devops: ['Docker', 'Kubernetes', 'Terraform'],
    tools: ['Git', 'Datadog'],
  },
  skills_flat: [
    'Python', 'TypeScript', 'Go', 'SQL', 'FastAPI', 'React', 'Next.js', 'AWS', 'GCP',
    'PostgreSQL', 'Redis', 'PyTorch', 'LangChain', 'Docker', 'Kubernetes', 'Terraform', 'Git', 'Datadog',
  ],
  experience: [
    {
      company: 'Nimbus Data',
      role: 'Senior Software Engineer',
      start_date: '2022-03',
      end_date: null,
      bullets: [
        'Built a real-time ingestion pipeline that reduced event processing latency by 40%.',
        'Led migration of a monolith to 6 independent services, cutting deploy time from 45 to 8 minutes.',
        'Mentored 3 junior engineers and ran the team code-review guild.',
      ],
    },
    {
      company: 'Loop Analytics',
      role: 'Software Engineer',
      start_date: '2019-06',
      end_date: '2022-02',
      bullets: [
        'Designed a PostgreSQL-backed reporting API serving 2M requests/day.',
        'Cut cloud spend 25% by right-sizing Kubernetes workloads.',
      ],
    },
  ],
  projects: [
    {
      name: 'OpenTrace',
      description: 'An open-source distributed tracing sidecar for FastAPI services.',
      technologies: ['Python', 'FastAPI', 'OpenTelemetry'],
      url: 'github.com/alexrivera/opentrace',
    },
  ],
  education: [
    {
      institution: 'University of Texas at Austin',
      degree: 'B.S.',
      field: 'Computer Science',
      start_date: '2015-08',
      end_date: '2019-05',
      gpa: '3.7',
    },
  ],
  achievements: [
    { title: 'Internal Hackathon Winner', description: 'Built a log-anomaly detector adopted by the SRE team.' },
  ],
  certifications: [],
  leadership: [],
  _schema_version: 2,
  _extraction_mode: 'llm',
};

export const FIXTURE_JD = {
  title: 'Staff Backend Engineer',
  company: 'Meridian Robotics',
  location: 'Remote (US)',
  description_summary:
    'Own the reliability and scale of the fleet-coordination platform powering thousands of autonomous robots.',
  level: 'staff',
  employment_type: 'full_time',
  min_years_experience: 7,
  compensation_hint: '',
  requirements: [
    '7+ years building distributed backend systems',
    'Deep experience with Go or Python',
    'Production Kubernetes operations',
    'Event-driven architecture (Kafka or equivalent)',
  ],
  nice_to_haves: [
    'Experience with robotics or real-time control systems',
    'gRPC service design',
  ],
  responsibilities: [
    'Design fleet-coordination services',
    'Own SLOs and on-call for the platform',
  ],
  technologies: ['Go', 'Kubernetes', 'Kafka', 'gRPC', 'PostgreSQL'],
  keywords: ['distributed systems', 'reliability', 'scale', 'event-driven'],
};

// Optional AOT artifacts (as the premium engine would precompute them).
export const FIXTURE_ARTIFACTS = {
  gapAnalysis: {
    match_percentage: 78,
    matched_skills: ['Python', 'Go', 'Kubernetes', 'PostgreSQL', 'distributed systems'],
    gaps: [
      { skill: 'Kafka', gap_type: 'missing', pivot_script: 'Relate to real-time ingestion pipeline experience.', transferable_skills: ['event processing'] },
      { skill: 'gRPC', gap_type: 'weak', pivot_script: 'Highlight OpenTelemetry sidecar work.', transferable_skills: ['service design'] },
    ],
  },
  negotiationScript: {
    salary_range: { min: 210000, max: 260000, currency: 'USD' },
    anchor_script: 'Based on my distributed-systems track record and the staff scope here, I am targeting the upper end of the band.',
    rationale: 'Six years of relevant experience plus proven latency and cost wins.',
  },
  mockQuestions: [
    { question: 'How would you design a fleet-coordination service for 10k robots?', category: 'system_design', difficulty: 'hard' },
    { question: 'Describe a time you cut deploy time significantly.', category: 'behavioral', difficulty: 'medium' },
  ],
  cultureMappings: {
    values: ['ownership', 'reliability', 'pragmatism'],
    mappings: [
      { value: 'ownership', evidence: 'Led a full monolith-to-services migration end to end.' },
      { value: 'reliability', evidence: 'Owns SLOs and cut processing latency 40%.' },
    ],
  },
  intro: 'I am a backend-leaning engineer with six years shipping distributed systems and developer tools. Most recently at Nimbus Data I led a monolith-to-services migration and cut event latency by 40 percent. I am excited about the fleet-coordination scale challenges at Meridian Robotics.',
};
