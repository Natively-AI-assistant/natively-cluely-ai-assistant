// tests/intelligence-fixtures/fixture-set.mjs
// Helper to create structured fixture sets for Natively intelligence evaluation

/**
 * Create a fixture set for a given role profile.
 * Used by eval harness to test Natively's intelligence pipeline.
 */
export function createFixtureSet(fixtures) {
  return fixtures.map(f => ({
    id: f.id,
    role: f.role,
    candidate: f.candidate,
    resume: f.resume,
    jd: f.jd,
    customContext: f.customContext,
    persona: f.persona,
    negotiation: f.negotiation,
    tests: f.tests,
  }));
}

// Fixture 1: Backend Engineer — Aarav Menon
export const backendEngineer = {
  id: 'backend-eng-001',
  role: 'Backend Engineer',
  candidate: {
    name: 'Aarav Menon',
    currentRole: 'Backend Engineer',
    currentCompany: 'Stripe',
    yearsExperience: 5,
    education: 'MS Computer Science, Carnegie Mellon University',
    location: 'San Francisco, CA',
  },
  resume: {
    identity: { name: 'Aarav Menon', email: 'aarav.menon@gmail.com', phone: '415-555-0142', location: 'San Francisco, CA' },
    summary: 'Backend engineer with 5 years building scalable payment systems at high-growth fintech companies. Strong in distributed systems, Go, and Python.',
    experience: [
      { company: 'Stripe', role: 'Backend Engineer', start: '2021-03', end: 'present', highlights: ['Built payment reconciliation pipeline processing $2B+ daily', 'Designed real-time fraud detection system reducing chargebacks 40%', 'Migrated monolith to microservices, improved p99 latency from 800ms to 120ms'] },
      { company: 'Twilio', role: 'Software Engineer', start: '2019-06', end: '2021-02', highlights: ['Developed SMS routing engine handling 50M messages/day', 'Built programmable video signaling infrastructure'] },
    ],
    projects: [
      { name: 'OpenRate', description: 'Open-source Go rate limiting library with token bucket and sliding window algorithms. 2k GitHub stars.', technologies: ['Go', 'Redis', 'gRPC'] },
      { name: 'LedgerSync', description: 'CLI tool for personal finance tracking with bank API integration. Used by 500+ engineers.', technologies: ['Python', 'Plaid', 'SQLite'] },
    ],
    skills: ['Go', 'Python', 'PostgreSQL', 'Redis', 'Kubernetes', 'gRPC', 'Kafka', 'Terraform'],
    education: [{ school: 'Carnegie Mellon University', degree: 'MS Computer Science', year: '2019' }, { school: ' IIT Bombay', degree: 'BTech Computer Science', year: '2017' }],
  },
  jd: {
    title: 'Senior Backend Engineer',
    company: 'Datadog',
    level: 'senior',
    location: 'Remote (US)',
    requirements: ['5+ years backend development', 'Go or Python expertise', 'Distributed systems experience', 'AWS/GCP', 'Database optimization'],
    technologies: ['Go', 'Kafka', 'PostgreSQL', 'Redis', 'Kubernetes'],
    description_summary: 'Building observability infrastructure at scale. Help engineers understand systems processing trillions of data points daily.',
    compensation_hint: '$180k-$220k',
    min_years_experience: 5,
  },
  customContext: 'Give me concise, technical answers. I prefer bullet points when possible. Focus on concrete examples from my experience.',
  persona: 'Calm senior engineering mentor — precise, technical, no fluff.',
  negotiation: {
    targetSalary: 195000,
    minimumSalary: 175000,
    currentSalary: 185000,
    signingBonus: 25000,
    equity: '0.05% with 4 year vest, 1 year cliff',
    priorities: ['target salary', 'equity vesting acceleration', 'remote-first'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Aarav Menon', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Senior Backend Engineer', category: 'identity' },
    { q: 'Which company is this interview for?', expected: 'Datadog', category: 'identity' },
    { q: 'How many years of experience do I have?', expected: '5', category: 'identity' },
    { q: 'What is my current role?', expected: 'Backend Engineer at Stripe', category: 'identity' },
    { q: 'Summarize my experience', expected: 'Stripe + Twilio, distributed systems, Go/Python', category: 'resume_recall' },
    { q: 'What projects should I mention?', expected: 'OpenRate (rate limiting lib), LedgerSync (finance CLI)', category: 'resume_recall' },
    { q: 'What are my strongest skills for this role?', expected: 'Go, distributed systems, Kafka, PostgreSQL', category: 'jd_alignment' },
    { q: 'Why am I a good fit for this role?', expected: 'stripe payments experience + Go expertise + observability context', category: 'jd_alignment' },
    { q: 'Give concise answers', expected: 'bullet-point style', category: 'custom_context' },
  ],
};

// Fixture 2: ML Engineer — Priya Sharma
export const mlEngineer = {
  id: 'ml-eng-002',
  role: 'Machine Learning Engineer',
  candidate: {
    name: 'Priya Sharma',
    currentRole: 'ML Engineer',
    currentCompany: 'Google DeepMind',
    yearsExperience: 4,
    education: 'PhD Machine Learning, Stanford University',
    location: 'Mountain View, CA',
  },
  resume: {
    identity: { name: 'Priya Sharma', email: 'priya.sharma@stanford.edu', phone: '650-555-0198', location: 'Mountain View, CA' },
    summary: 'ML engineer specializing in NLP and recommendation systems. Published 8 papers on transformer architectures. Building production ML systems at scale.',
    experience: [
      { company: 'Google DeepMind', role: 'ML Engineer', start: '2022-01', end: 'present', highlights: ['Led BERT fine-tuning pipeline for 500M-parameter model', 'Reduced training cost 35% via mixed precision + gradient checkpointing', 'Productionized 12 ML models serving Google News recommendations'] },
      { company: 'OpenAI', role: 'Research Engineer', start: '2020-08', end: '2021-12', highlights: ['Contributed to GPT-3 evaluation harness', 'Built RLHF data pipeline for InstructGPT'] },
    ],
    projects: [
      { name: 'LLM-Eval', description: 'Open-source framework for evaluating language model performance across 15 benchmarks. 1.5k stars.', technologies: ['Python', 'PyTorch', 'Hugging Face'] },
      { name: 'RecSys-Factory', description: 'Production recommendation system library with multi-armed bandit exploration strategies.', technologies: ['Python', 'TensorFlow', 'Redis'] },
    ],
    skills: ['Python', 'PyTorch', 'TensorFlow', 'Hugging Face', 'Spark', 'MLflow', 'Kubernetes'],
    education: [{ school: 'Stanford University', degree: 'PhD Machine Learning', year: '2020' }, { school: ' IIT Delhi', degree: 'BTech Computer Science', year: '2015' }],
  },
  jd: {
    title: 'Staff Machine Learning Engineer',
    company: 'Anthropic',
    level: 'staff',
    location: 'San Francisco, CA',
    requirements: ['PhD or equivalent experience', 'NLP expertise', 'Production ML systems', 'LLM experience preferred', 'Python + PyTorch'],
    technologies: ['Python', 'PyTorch', 'Hugging Face', 'Kubernetes', 'Weave'],
    description_summary: 'Build foundation model infrastructure. Help make AI systems safe and beneficial. Work on the core systems powering Claude.',
    compensation_hint: '$280k-$350k',
    min_years_experience: 5,
  },
  customContext: 'I prefer detailed explanations with technical depth. Include relevant papers or approaches when applicable.',
  persona: 'Research-minded technical lead — thoughtful, thorough, citation-rich.',
  negotiation: {
    targetSalary: 310000,
    minimumSalary: 280000,
    currentSalary: 275000,
    signingBonus: 50000,
    equity: '0.08% with 4 year vest, 1 year cliff',
    priorities: ['research freedom', 'equity', 'conference budget'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Priya Sharma', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Staff Machine Learning Engineer', category: 'identity' },
    { q: 'Which company is this interview for?', expected: 'Anthropic', category: 'identity' },
    { q: 'What should I emphasize from my background?', expected: 'NLP expertise, transformer architectures, production ML at scale', category: 'jd_alignment' },
  ],
};

// Fixture 3: Product Manager — Jordan Kim
export const productManager = {
  id: 'pm-003',
  role: 'Product Manager',
  candidate: {
    name: 'Jordan Kim',
    currentRole: 'Senior Product Manager',
    currentCompany: 'Airbnb',
    yearsExperience: 6,
    education: 'MBA, Wharton School of Business',
    location: 'Seattle, WA',
  },
  resume: {
    identity: { name: 'Jordan Kim', email: 'jordan.kim@wharton.upenn.edu', phone: '206-555-0173', location: 'Seattle, WA' },
    summary: 'PM with 6 years in consumer tech and fintech. Led products from 0→1 and scaled them to millions of users. Strong data-driven decision making.',
    experience: [
      { company: 'Airbnb', role: 'Senior Product Manager', start: '2020-09', end: 'present', highlights: ['Led Guest Checkout redesign increasing conversion 18% ($120M revenue impact)', 'Built host payout system serving 4M hosts globally', 'Manage $50M annual product roadmap'] },
      { company: 'Square (Block)', role: 'Product Manager', start: '2018-03', end: '2020-08', highlights: ['Launched Square for Restaurants POS, $80M ARR within 18 months', 'Grew Seller Dashboard DAU from 200k to 900k'] },
    ],
    projects: [
      { name: 'PaymentsUX Framework', description: 'Internal design system for payment flows. Adopted by 8 product teams at Airbnb.', technologies: ['Figma', 'Notion', 'SQL'] },
      { name: 'OKR-Tracker', description: 'Internal OKR dashboard for engineering teams. Used by 400+ PMs at Airbnb.', technologies: ['Looker', 'Python', 'BigQuery'] },
    ],
    skills: ['Product Strategy', 'SQL', 'A/B Testing', 'Figma', 'Looker', 'JIRA', 'Agile'],
    education: [{ school: 'Wharton School of Business', degree: 'MBA', year: '2018' }, { school: 'UC Berkeley', degree: 'BA Economics', year: '2014' }],
  },
  jd: {
    title: 'Director of Product Management',
    company: 'Figma',
    level: 'director',
    location: 'San Francisco, CA (Hybrid)',
    requirements: ['8+ years product management', 'Consumer or developer tools experience', 'B2B SaaS', 'Cross-functional leadership', 'Data-driven'],
    technologies: ['Figma', 'SQL', 'Amplitude', 'JIRA', 'Confluence'],
    description_summary: 'Lead the platform product organization. Shape how designers and developers collaborate. Drive the product strategy for Figma\'s most strategic bets.',
    compensation_hint: '$280k-$360k',
    min_years_experience: 8,
  },
  customContext: 'I want structured recommendations with clear trade-offs. Start with the most important point.',
  persona: 'Strategic business partner — clear, structured, trade-off focused.',
  negotiation: {
    targetSalary: 320000,
    minimumSalary: 290000,
    currentSalary: 265000,
    signingBonus: 40000,
    equity: '0.03% with 4 year vest, 1 year cliff',
    priorities: ['title (Director)', 'equity', 'hybrid flexibility'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Jordan Kim', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Director of Product Management', category: 'identity' },
    { q: 'What company is this for?', expected: 'Figma', category: 'identity' },
    { q: 'What achievement should I lead with?', expected: 'Guest Checkout redesign, 18% conversion improvement', category: 'resume_recall' },
  ],
};

// Fixture 4: Sales Development Rep — Marcus Williams
export const salesRep = {
  id: 'sales-sdr-004',
  role: 'Sales Development Representative',
  candidate: {
    name: 'Marcus Williams',
    currentRole: 'SDR',
    currentCompany: 'Salesforce',
    yearsExperience: 2,
    education: 'BS Business Administration, University of Michigan',
    location: 'Chicago, IL',
  },
  resume: {
    identity: { name: 'Marcus Williams', email: 'marcus.w@umich.edu', phone: '312-555-0156', location: 'Chicago, IL' },
    summary: 'Top-performing SDR with 2 years SaaS sales experience. Consistently exceeded quota 120%+ and transitioned 40+ opportunities to closed-won ARR.',
    experience: [
      { company: 'Salesforce', role: 'Sales Development Representative', start: '2023-01', end: 'present', highlights: ['#1 SDR globally for 3 consecutive quarters', 'Booked $4.2M in qualified pipeline for Financial Services team', 'Created SDR playbooks adopted firm-wide'] },
      { company: 'HubSpot', role: 'Marketing Coordinator', start: '2021-06', end: '2022-12', highlights: ['Managed inbound lead qualification process', 'Increased MQL-to-SQL conversion 25%'] },
    ],
    projects: [
      { name: 'SDR-CLI', description: 'Command-line prospecting tool with LinkedIn enrichment API integration. Used by my team of 15 SDRs.', technologies: ['Node.js', 'LinkedIn API', 'Apollo'] },
    ],
    skills: ['Salesforce', 'Outreach', 'LinkedIn Sales Navigator', 'Apollo.io', 'Cold calling', 'Demo delivery', 'Negotiation'],
    education: [{ school: 'University of Michigan', degree: 'BS Business Administration', year: '2021' }],
  },
  jd: {
    title: 'Enterprise SDR',
    company: 'Databricks',
    level: 'mid',
    location: 'Chicago, IL',
    requirements: ['1-3 years SDR experience', 'SaaS sales', 'Technical aptitude', 'Enterprise software sales preferred'],
    technologies: ['Salesforce', 'Outreach', 'LinkedIn', 'ZoomInfo'],
    description_summary: 'Drive the top of our enterprise sales funnel. Work with Fortune 500 technical buyers on our data intelligence platform.',
    compensation_hint: '$75k base + $50k OTE',
    min_years_experience: 1,
  },
  customContext: 'Give me practical scripts and talk tracks I can use immediately. Be specific.',
  persona: 'Energetic sales coach — tactical, practical, confidence-building.',
  negotiation: {
    targetSalary: 80000,
    minimumSalary: 72000,
    currentSalary: 65000,
    signingBonus: 5000,
    equity: 'None for SDR level',
    priorities: ['base salary', 'OTE structure', 'ramp period'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Marcus Williams', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Enterprise SDR', category: 'identity' },
    { q: 'What company is this for?', expected: 'Databricks', category: 'identity' },
    { q: 'How should I open a cold call?', expected: 'specific opening script/talk track', category: 'negotiation' },
  ],
};

// Fixture 5: UI/UX Designer — Sofia Rodriguez
export const uxDesigner = {
  id: 'ux-designer-005',
  role: 'UI/UX Designer',
  candidate: {
    name: 'Sofia Rodriguez',
    currentRole: 'Senior Product Designer',
    currentCompany: 'Spotify',
    yearsExperience: 5,
    education: 'BFA Design, Rhode Island School of Design',
    location: 'Brooklyn, NY',
  },
  resume: {
    identity: { name: 'Sofia Rodriguez', email: 'sofia.r@risd.edu', phone: '718-555-0139', location: 'Brooklyn, NY' },
    summary: 'Senior product designer with 5 years in music streaming and consumer apps. Crafted experiences for 50M+ monthly active users. Expert in design systems and user research.',
    experience: [
      { company: 'Spotify', role: 'Senior Product Designer', start: '2021-05', end: 'present', highlights: ['Led redesign of Discover Weekly experience (50M users impacted)', 'Built Spotify Design System across 6 product teams', 'Conducted 200+ user research sessions informing product direction'] },
      { company: 'Adobe', role: 'Product Designer', start: '2019-03', end: '2021-04', highlights: ['Designed Creative Cloud mobile companion app (4.5 stars, 2M downloads)', 'Established design token architecture used across Adobe products'] },
    ],
    projects: [
      { name: 'DesignToken.io', description: 'Open-source tool for managing design tokens across platforms. 800+ designers use it weekly.', technologies: ['Figma API', 'React', 'Style Dictionary'] },
      { name: 'PodcastPlayer', description: 'Redesigned podcast listening experience for Spotify. In production for 30M users.', technologies: ['Figma', 'SwiftUI', 'Spotify API'] },
    ],
    skills: ['Figma', 'Sketch', 'Principle', 'Framer', 'User Research', 'Design Systems', 'Prototyping', 'HTML/CSS'],
    education: [{ school: 'Rhode Island School of Design', degree: 'BFA Design', year: '2019' }],
  },
  jd: {
    title: 'Lead Product Designer',
    company: 'Canva',
    level: 'lead',
    location: 'Remote (US)',
    requirements: ['5+ years product design', 'Design systems expertise', 'Consumer or creative tools', 'Portfolio required', 'Figma expert'],
    technologies: ['Figma', 'Design Systems', 'Prototyping', 'User Testing'],
    description_summary: 'Lead design for Canva\'s collaborative whiteboarding product. Shape how millions design together. Work across product, research, and engineering.',
    compensation_hint: '$150k-$190k',
    min_years_experience: 5,
  },
  customContext: 'I respond well to visual examples and portfolio references. Show me what great looks like.',
  persona: 'Visual design leader — portfolio-focused, references concrete work.',
  negotiation: {
    targetSalary: 175000,
    minimumSalary: 160000,
    currentSalary: 155000,
    signingBonus: 15000,
    equity: '0.02% with 4 year vest, 1 year cliff',
    priorities: ['design autonomy', 'portfolio showcase opportunity', 'equity'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Sofia Rodriguez', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Lead Product Designer', category: 'identity' },
    { q: 'What company is this for?', expected: 'Canva', category: 'identity' },
    { q: 'What should my portfolio showcase?', expected: 'Discover Weekly redesign, Design System work', category: 'resume_recall' },
  ],
};

// Fixture 6: Data Analyst — Chen Wei
export const dataAnalyst = {
  id: 'data-analyst-006',
  role: 'Data Analyst',
  candidate: {
    name: 'Chen Wei',
    currentRole: 'Data Analyst',
    currentCompany: 'Amazon',
    yearsExperience: 3,
    education: 'BS Statistics, UC Berkeley',
    location: 'Seattle, WA',
  },
  resume: {
    identity: { name: 'Chen Wei', email: 'chen.wei@berkeley.edu', phone: '206-555-0184', location: 'Seattle, WA' },
    summary: 'Data analyst with 3 years in e-commerce and logistics. Built dashboards powering $500M+ business decisions. Expert in SQL, Python, andTableau.',
    experience: [
      { company: 'Amazon', role: 'Data Analyst', start: '2022-06', end: 'present', highlights: ['Built inventory forecasting dashboard saving $12M/year in overstocking', 'Developed seller performance scoring ML model (87% accuracy)', 'Automate weekly reporting for 50+ stakeholders via Looker'] },
      { company: 'Zara', role: 'Business Intelligence Analyst', start: '2021-01', end: '2022-05', highlights: ['Created customer segmentation model increasing email CTR 34%', 'Built real-time sales看板 for 200 store managers'] },
    ],
    projects: [
      { name: 'ABTest-Framework', description: 'Python framework for A/B test analysis with bootstrap confidence intervals. Used by 20 analysts at Amazon.', technologies: ['Python', 'pandas', 'SciPy', 'SQL'] },
      { name: 'SQL-Copilot', description: 'VS Code extension for SQL query optimization suggestions. 500+ daily active users.', technologies: ['TypeScript', 'OpenAI API', 'PostgreSQL'] },
    ],
    skills: ['SQL', 'Python', 'Tableau', 'Looker', 'A/B Testing', 'Statistical Analysis', 'Excel', 'Spark'],
    education: [{ school: 'UC Berkeley', degree: 'BS Statistics', year: '2021' }],
  },
  jd: {
    title: 'Senior Data Analyst',
    company: 'Coinbase',
    level: 'senior',
    location: 'San Francisco, CA (Hybrid)',
    requirements: ['3+ years data analysis', 'SQL expertise', 'Crypto/Web3 interest', 'Tableau or Looker', 'Python'],
    technologies: ['SQL', 'Python', 'Tableau', 'dbt', 'Snowflake'],
    description_summary: 'Drive data-informed product decisions for our retail trading platform. Work with trading, growth, and compliance teams to understand our 80M users.',
    compensation_hint: '$130k-$165k',
    min_years_experience: 3,
  },
  customContext: 'Include specific numbers and metrics in your answers. Quantify whenever possible.',
  persona: 'Analytical partner — data-first, metric-focused, precise.',
  negotiation: {
    targetSalary: 155000,
    minimumSalary: 140000,
    currentSalary: 135000,
    signingBonus: 10000,
    equity: '0.01% with 4 year vest, 1 year cliff',
    priorities: ['crypto exposure', 'equity upside', 'hybrid schedule'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Chen Wei', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Senior Data Analyst', category: 'identity' },
    { q: 'What company is this for?', expected: 'Coinbase', category: 'identity' },
  ],
};

// Fixture 7: DevOps/SRE Engineer — Kwame Osei
export const devopsEngineer = {
  id: 'devops-sre-007',
  role: 'DevOps/SRE Engineer',
  candidate: {
    name: 'Kwame Osei',
    currentRole: 'Site Reliability Engineer',
    currentCompany: 'Netflix',
    yearsExperience: 7,
    education: 'BS Computer Engineering, Georgia Tech',
    location: 'Los Angeles, CA',
  },
  resume: {
    identity: { name: 'Kwame Osei', email: 'kwame.osei@gmail.com', phone: '310-555-0167', location: 'Los Angeles, CA' },
    summary: 'SRE with 7 years building and operating large-scale distributed systems. Deep expertise in Kubernetes, observability, and incident response. Reduced outage time 60% at Netflix.',
    experience: [
      { company: 'Netflix', role: 'Site Reliability Engineer', start: '2020-08', end: 'present', highlights: ['Built automated chaos engineering system (400+ experiments/month)', 'Reduced P1 incident MTTR from 45min to 12min via runbook automation', 'Designed multi-region failover reducing regional outage impact 80%'] },
      { company: 'Twitter (X)', role: 'Senior DevOps Engineer', start: '2017-03', end: '2020-07', highlights: ['Migrated 500-service monolith to Kubernetes in 18 months', 'Built real-time monitoring for 300M daily active users'] },
    ],
    projects: [
      { name: 'ChaosMonkey-Pro', description: 'Enhanced chaos engineering tool with fault injection campaigns and 自动化recovery. 2k stars.', technologies: ['Go', 'Kubernetes', 'Prometheus', 'Grafana'] },
      { name: 'SRE-Dashboard', description: 'Real-time SRE metrics dashboard for Netflix internal use. Tracks 1000+ services.', technologies: ['React', 'Grafana', 'PromQL', 'Tempo'] },
    ],
    skills: ['Kubernetes', 'Terraform', 'Go', 'Python', 'Prometheus', 'Grafana', 'AWS', 'Chaos Engineering'],
    education: [{ school: 'Georgia Tech', degree: 'BS Computer Engineering', year: '2017' }],
  },
  jd: {
    title: 'Staff SRE',
    company: 'Stripe',
    level: 'staff',
    location: 'Remote (US)',
    requirements: ['7+ years SRE/DevOps', 'Kubernetes at scale', 'Observability expertise', 'Payment systems experience preferred', 'Go/Python'],
    technologies: ['Kubernetes', 'Go', 'Prometheus', 'Terraform', 'AWS'],
    description_summary: 'Build the reliability foundations for Stripe\'s payment infrastructure. Our systems process billions daily with 99.999% uptime requirements.',
    compensation_hint: '$240k-$300k',
    min_years_experience: 7,
  },
  customContext: 'Include specific reliability metrics and SLAs when relevant. Technical depth preferred.',
  persona: 'Reliability expert — metrics-driven, incident-hardened, systematic.',
  negotiation: {
    targetSalary: 280000,
    minimumSalary: 255000,
    currentSalary: 245000,
    signingBonus: 30000,
    equity: '0.06% with 4 year vest, 1 year cliff',
    priorities: ['technical challenge', 'payment infra scale', 'equity'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Kwame Osei', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Staff SRE', category: 'identity' },
    { q: 'What company is this for?', expected: 'Stripe', category: 'identity' },
    { q: 'What SLOs should I target?', expected: '99.999% uptime for payment processing', category: 'jd_alignment' },
  ],
};

// Fixture 8: Customer Success Manager — Aisha Patel
export const csm = {
  id: 'csm-008',
  role: 'Customer Success Manager',
  candidate: {
    name: 'Aisha Patel',
    currentRole: 'Senior Customer Success Manager',
    currentCompany: 'Slack',
    yearsExperience: 5,
    education: 'MS Technology Management, MIT Sloan',
    location: 'Boston, MA',
  },
  resume: {
    identity: { name: 'Aisha Patel', email: 'aisha.patel@mit.edu', phone: '617-555-0128', location: 'Boston, MA' },
    summary: 'Customer success leader with 5 years managing enterprise accounts in SaaS. Grew net revenue retention 115% and reduced churn to 8% at Slack.',
    experience: [
      { company: 'Slack', role: 'Senior Customer Success Manager', start: '2021-03', end: 'present', highlights: ['Manage 45 enterprise accounts ($5M ARR)', 'Achieved 115% net revenue retention across portfolio', 'Created CS playbooks reducing onboarding time 40%'] },
      { company: 'Salesforce', role: 'Customer Success Manager', start: '2019-01', end: '2021-02', highlights: ['Managed Fortune 500 accounts in Financial Services vertical', '98% customer satisfaction score'] },
    ],
    projects: [
      { name: 'CS-Scorecard', description: 'Customer health scoring model using product usage, support tickets, and NPS. Adopted by 80 CSMs at Slack.', technologies: ['SQL', 'Looker', 'Python'] },
    ],
    skills: ['Gainsight', 'Salesforce', 'Churn.io', 'Executive presentation', 'QBR', 'Renewal negotiation', 'Technical aptitude'],
    education: [{ school: 'MIT Sloan School of Management', degree: 'MS Technology Management', year: '2018' }, { school: 'Boston University', degree: 'BA Economics', year: '2016' }],
  },
  jd: {
    title: 'Enterprise Customer Success Manager',
    company: 'Notion',
    level: 'senior',
    location: 'New York, NY',
    requirements: ['5+ years CS or account management', 'Enterprise SaaS', 'Technical product understanding', 'Renewals and expansion', 'Gainsight preferred'],
    technologies: ['Gainsight', 'Salesforce', 'Churn.io', 'Looker'],
    description_summary: 'Own the success of our largest enterprise customers. Drive adoption, renewal, and expansion across a portfolio of Fortune 500 accounts.',
    compensation_hint: '$120k-$150k + OTE',
    min_years_experience: 5,
  },
  customContext: 'Give me concrete talk tracks and frameworks I can use with executive stakeholders.',
  persona: 'Trusted advisor — executive presence, consultative, outcome-focused.',
  negotiation: {
    targetSalary: 135000,
    minimumSalary: 120000,
    currentSalary: 115000,
    signingBonus: 10000,
    equity: '0.01% with 4 year vest',
    priorities: ['enterprise portfolio quality', 'OTE uncapped', 'career development path'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Aisha Patel', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Enterprise Customer Success Manager', category: 'identity' },
    { q: 'What company is this for?', expected: 'Notion', category: 'identity' },
    { q: 'How should I prepare for a QBR?', expected: 'specific agenda/framework', category: 'negotiation' },
  ],
};

// Fixture 9: Cybersecurity Analyst — David Okonkwo
export const securityAnalyst = {
  id: 'security-009',
  role: 'Cybersecurity Analyst',
  candidate: {
    name: 'David Okonkwo',
    currentRole: 'Security Analyst',
    currentCompany: 'CrowdStrike',
    yearsExperience: 4,
    education: 'BS Cybersecurity, Purdue University',
    location: 'Austin, TX',
  },
  resume: {
    identity: { name: 'David Okonkwo', email: 'd.okonkwo@purdue.edu', phone: '512-555-0147', location: 'Austin, TX' },
    summary: 'Cybersecurity analyst with 4 years in endpoint protection and threat hunting. OSCP and AWS Security certified. Detected and remediated APT campaigns targeting financial services.',
    experience: [
      { company: 'CrowdStrike', role: 'Security Analyst', start: '2022-03', end: 'present', highlights: ['Detected and remediated APT41 campaign in customer environment (CIR $2M)', 'Built automated threat hunting playbook library (50+ playbooks)', 'Reduced false positive rate 60% via ML-based alert triage'] },
      { company: 'Mandiant', role: 'Consultant', start: '2020-06', end: '2022-02', highlights: ['Led incident response for 15+ breaches across healthcare and finance', 'Developed persistence mechanism detection methodology'] },
    ],
    projects: [
      { name: 'ThreatHunter-Playbook', description: 'Sigma rule library for detecting MITRE ATT&CK techniques. 500+ rules, community contribution.', technologies: ['Sigma', 'Splunk', 'YARA'] },
      { name: 'PhishDetect', description: 'Email phishing detection using ML. 94% precision, used by 3 MSSPs.', technologies: ['Python', 'TensorFlow', 'DMARC', 'SPF'] },
    ],
    skills: ['SIEM', 'EDR', 'Threat Hunting', 'Incident Response', 'Splunk', 'CrowdStrike', 'Python', 'YARA', 'MITRE ATT&CK'],
    education: [{ school: 'Purdue University', degree: 'BS Cybersecurity', year: '2020' }],
    certifications: ['OSCP', 'AWS Security Specialty', 'GCIH'],
  },
  jd: {
    title: 'Senior Security Operations Engineer',
    company: 'Cloudflare',
    level: 'senior',
    location: 'Austin, TX (Hybrid)',
    requirements: ['4+ years security operations', 'SIEM expertise', 'Threat hunting experience', 'Cloud security (AWS/GCP)', 'Scripting (Python/Go)'],
    technologies: ['Splunk', 'CrowdStrike', 'Python', 'AWS Security', 'MITRE ATT&CK'],
    description_summary: 'Defend Cloudflare\'s global network. Build detection and response capabilities for the backbone of the internet. Work on problems at terabit scale.',
    compensation_hint: '$160k-$200k',
    min_years_experience: 4,
  },
  customContext: 'Include specific ATT&CK framework mappings when discussing detection strategies.',
  persona: 'Technical security expert — framework-driven, incident-experienced, methodical.',
  negotiation: {
    targetSalary: 185000,
    minimumSalary: 168000,
    currentSalary: 158000,
    signingBonus: 20000,
    equity: '0.02% with 4 year vest',
    priorities: ['technical mission', 'scale of problems', 'equity'],
  },
  tests: [
    { q: 'What is my name?', expected: 'David Okonkwo', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Senior Security Operations Engineer', category: 'identity' },
    { q: 'What company is this for?', expected: 'Cloudflare', category: 'identity' },
    { q: 'How should I discuss my detection experience?', expected: 'MITRE ATT&CK framework', category: 'jd_alignment' },
  ],
};

// Fixture 10: Founder/CEO — Michael Zhang
export const founderCEO = {
  id: 'founder-010',
  role: 'Founder / CEO (Business Development)',
  candidate: {
    name: 'Michael Zhang',
    currentRole: 'Founder & CEO',
    currentCompany: 'Nexus AI (Series A Startup)',
    yearsExperience: 8,
    education: 'BS Computer Science + MBA, MIT',
    location: 'Boston, MA',
  },
  resume: {
    identity: { name: 'Michael Zhang', email: 'mzhang@mit.edu', phone: '617-555-0193', location: 'Boston, MA' },
    summary: 'Serial founder with 2 successful exits. Building Nexus AI (Series A, $18M raised). Looking for co-founder or founding team role at a hard-tech startup.',
    experience: [
      { company: 'Nexus AI', role: 'Founder & CEO', start: '2022-01', end: 'present', highlights: ['Raised $18M Series A for AI-powered code review platform', 'Grew to 120 paying customers and $2.4M ARR', 'Built 12-person technical team from scratch'] },
      { company: 'StackIQ (Acquired by PagerDuty)', role: 'Co-founder & CTO', start: '2019-03', end: '2021-12', highlights: ['Built infrastructure automation tool, $40M acquisition', 'Scaled engineering team from 3 to 25'] },
    ],
    projects: [
      { name: 'Nexus AI', description: 'AI-powered code review platform. 120 customers, $2.4M ARR. Raised $18M Series A.', technologies: ['Go', 'Python', 'GPT-4', 'PostgreSQL'] },
      { name: 'StackIQ', description: 'Infrastructure automation for cloud deployments. Acquired for $40M by PagerDuty.', technologies: ['Terraform', 'AWS', 'Go'] },
    ],
    skills: ['Fundraising', 'Team Building', 'Go', 'Python', 'SQL', 'Product Strategy', 'Enterprise Sales', 'M&A'],
    education: [{ school: 'MIT', degree: 'BS Computer Science + MBA', year: '2015' }],
  },
  jd: {
    title: 'Co-founder / Founding Engineer',
    company: 'Cognition AI',
    level: 'founder',
    location: 'San Francisco, CA',
    requirements: ['Strong technical background (CS/engineering)', 'Startup experience', 'AI/ML interest', 'Business development capability', 'San Francisco based'],
    technologies: ['Python', 'Go', 'AI/ML', 'AWS'],
    description_summary: 'Building the future of AI-native software development. Join as founding team member with significant equity. We\'re rethinking how software is built.',
    compensation_hint: '$150k base + significant equity (founder level)',
    min_years_experience: 6,
  },
  customContext: 'I respond to vision and market opportunity framing. Connect technical decisions to business outcomes.',
  persona: 'Visionary technical founder — strategic, business-minded, outcome-driven.',
  negotiation: {
    targetSalary: 160000,
    minimumSalary: 140000,
    currentSalary: 200000,
    equity: '3% with 4 year vest, 1 year cliff',
    priorities: ['founder equity', 'technical role', 'board seat'],
  },
  tests: [
    { q: 'What is my name?', expected: 'Michael Zhang', category: 'identity' },
    { q: 'What role am I applying for?', expected: 'Co-founder / Founding Engineer', category: 'identity' },
    { q: 'What company is this for?', expected: 'Cognition AI', category: 'identity' },
    { q: 'How should I frame my startup experience?', expected: '2 exits, $18M raise, 12-person team', category: 'resume_recall' },
  ],
};

// Export all fixtures as an array
export const allFixtures = [
  backendEngineer,
  mlEngineer,
  productManager,
  salesRep,
  uxDesigner,
  dataAnalyst,
  devopsEngineer,
  csm,
  securityAnalyst,
  founderCEO,
];

export default allFixtures;