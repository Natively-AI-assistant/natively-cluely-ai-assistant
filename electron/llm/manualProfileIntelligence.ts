import { createHash } from 'crypto';
import type { AnswerType } from './AnswerPlanner';

export type ManualProfileSource = 'manual_input' | 'what_to_answer' | 'transcript' | 'system';

type MaybeStructured<T> = T | null | undefined;

type SkillItem = string | { name?: unknown; skill?: unknown };

interface ProfileIdentity {
  name?: unknown;
}

interface ProfileExperience {
  role?: unknown;
  title?: unknown;
  position?: unknown;
  company?: unknown;
  organization?: unknown;
  employer?: unknown;
  bullets?: unknown;
  highlights?: unknown;
  responsibilities?: unknown;
}

interface ProfileProject {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  summary?: unknown;
  technologies?: unknown;
  tech_stack?: unknown;
  tools?: unknown;
}

interface ProfileEducation {
  degree?: unknown;
  field?: unknown;
  major?: unknown;
  institution?: unknown;
  school?: unknown;
  university?: unknown;
}

export interface StructuredProfileFacts {
  identity?: ProfileIdentity;
  name?: unknown;
  personal?: ProfileIdentity;
  skills?: unknown;
  experience?: unknown;
  projects?: unknown;
  education?: unknown;
}

export interface StructuredJobFacts {
  title?: unknown;
  role?: unknown;
  position?: unknown;
  jobTitle?: unknown;
  company?: unknown;
  requirements?: unknown;
  nice_to_haves?: unknown;
  responsibilities?: unknown;
  technologies?: unknown;
  keywords?: unknown;
}

export interface ManualProfileFastPathInput {
  question: string;
  profile: MaybeStructured<StructuredProfileFacts>;
  jobDescription?: MaybeStructured<StructuredJobFacts>;
  source?: ManualProfileSource;
}

export interface ManualProfileRouteResult {
  answer: string;
  answerType: AnswerType;
  selectedContextLayers: string[];
  excludedContextLayers: string[];
  profileFactsReady: boolean;
  usedDeterministicFastPath: boolean;
  providerUsed: boolean;
  promptContainsProfileContext?: boolean;
}

export interface ManualProfileRouteLogInput {
  source: ManualProfileSource;
  question: string;
  route: ManualProfileRouteResult | null;
  profileFactsReady: boolean;
}

export interface ManualProfileRouteLog {
  source: ManualProfileSource;
  questionHash: string;
  answerType: AnswerType | 'unknown_answer';
  selectedContextLayers: string[];
  excludedContextLayers: string[];
  profileFactsReady: boolean;
  usedDeterministicFastPath: boolean;
  providerUsed: boolean;
  promptContainsProfileContext?: boolean;
}

const normalize = (question: string): string => question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const hasAny = (text: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(text));
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const firstNonEmpty = (...values: unknown[]): string => values.map(clean).find(Boolean) || '';

// GENUINE assistant-meta questions — these legitimately address Natively (the
// app), so the fast path bails to the LLM/assistant identity. Release 2026-06-06b:
// narrowed so "who are you" / "what is your name" NO LONGER count as assistant-meta
// when a candidate profile is loaded — in an interview-prep product those are the
// candidate's identity questions and must be answered AS the candidate (the real
// manual-chat log showed them leaking "I'm Natively, an AI assistant"). Only
// explicit AI/bot/model/who-built-you/what-is-Natively asks remain assistant-meta.
// Leading discourse fillers ("so", "wait", "ok", "hey", "um", "but") tolerated so
// "so are you an AI" / "wait, are you a bot" still classify as assistant-meta
// (code-review 2026-06-06b MEDIUM — the ^ anchors broke on prefixes).
const FILLER = '(?:so|wait|ok(?:ay)?|um|hmm|hey|but|and|actually|just|like)?[\\s,]*';
const ASSISTANT_IDENTITY_PATTERNS = [
  new RegExp(`^${FILLER}are\\s+you\\s+(an?\\s+)?(actually\\s+)?(ai|assistant|bot|llm|model|chatbot|language model)\\b`),
  /\bare\s+you\s+(an?\s+)?(actually\s+)?(human|real|robot|machine|program)\b/,
  new RegExp(`^${FILLER}what\\s+(is|s)\\s+natively\\b`),
  /\bwhat\s+(is|s)\s+this\s+(app|tool|product|assistant)\b/,
  new RegExp(`^${FILLER}who\\s+(made|built|created|developed|trained|designed)\\s+(you|this|natively|the app)\\b`),
  /\bwhat\s+(ai\s+)?model\s+(are\s+you|do\s+you\s+(use|run))\b|\bwhich\s+(llm|model)\b/,
  /\bare\s+you\s+(chatgpt|gpt|claude|gemini|natively)\b/,
];

const NAME_PATTERNS = [
  /\bwhat\s+is\s+my\s+name\b/,
  /\bwhat\s+s\s+my\s+name\b/,
  /\bwho\s+am\s+i\b/,
  /\bstate\s+my\s+name\b/,
  // Interviewer→candidate identity asks (benchmark 2026-06-05). These are a
  // single deterministic fact (the loaded name) and MUST be answered by the
  // fast path in every mode so they can never reach the LLM and leak "I'm
  // Natively, an AI assistant" / a false refusal.
  /\bwhat\s+(is|s)\s+your\s+(full\s+)?name\b/,
  /\bwhats\s+your\s+name\b/,
  /\bwhat\s+should\s+(i|we)\s+call\s+you\b/,
  /\bwho\s+are\s+you\b/,
  /\bwho\s+u\s*r\b|\bwho\s+r\s+u\b/,                      // SMS spelling "who u r"
  /\btell\s+me\s+who\s+you\s+are\b/,
  /\bstate\s+your\s+name\b/,
  /\bcan\s+you\s+(tell\s+me\s+)?your\s+name\b/,
];

const EXPERIENCE_PATTERNS = [
  /\b(my|your)\s+experiences?\b/,
  /\bexperience\s+do\s+i\s+have\b/,
  // "How many years of experience do you have?" / "how much experience…" (A09 fix) —
  // ensures the years-count question routes through the candidate-voice experience path
  // and gets a first-person answer instead of a 2nd-person LLM aside ("You have…").
  /\bhow\s+(?:many\s+years?|much)\s+(?:of\s+)?experience\b/,
  /\byears?\s+of\s+experience\s+(?:do\s+)?(?:you|i)\b/,
  /\bwork\s+experience\b/,
  /\bwork\s+history\b/,
  /\bprevious\s+roles?\b/,
  /\b(?<!educational\s)(?<!education\s)background\b/,
  // "what do you currently do?", "what's your current role?", "what companies
  // have you worked with/at?", "where have you worked?" (Issue 7).
  /\bwhat\s+do\s+(you|i)\s+(currently|now)\s*do\b/,
  /\bwhat\s+(are|r)\s+(you|u)\s+(currently\s+)?working\s+on\b/,
  /\bwhat(?:'s| is)\s+(your|my)\s+current\s+(role|job|position|title)\b/,
  /\bwhat\s+companies?\s+have\s+(you|i)\s+worked\b/,
  /\bwhere\s+have\s+(you|i)\s+worked\b/,
];
// INTRO ("tell me about yourself", "give me a quick introduction", "describe
// yourself professionally", "introduce yourself") — answered deterministically
// with a grounded first-person intro so it never reaches the LLM (which was
// leaking "I'm Natively" / refusing). Distinct from a bare NAME ask.
const INTRO_PATTERNS = [
  /\btell\s+me\s+about\s+(yourself|your\s*self)\b/,
  /\b(give|tell)\s+(me\s+)?(a\s+)?(quick|brief|short)?\s*(introduction|intro|overview of yourself|rundown)\b/,
  // Typo / greeting / SMS-spelling tolerant intro (real manual-chat log 2026-06-06b:
  // "introduce yourseld", "introduce urself", "hey man introduce yourself"). The
  // verb "introduc(e)" followed by an optional self-pronoun token (yourself /
  // yourselD / yoursef / urself / urslf) — greetings and trailing typos no longer
  // drop it to the LLM (which leaked "I'm Natively").
  // Self-pronoun REQUIRED (code-review 2026-06-06b HIGH): "introduce a bug" / "how
  // would you introduce DI" must NOT fast-path to the candidate intro.
  /\bintroduce\s+(yo?u?r?se?l?[fd]|u?r?se?l?[fd]|me to (?:you|the team))\b/,
  /\b(quick|brief|short)\s+intro\b|\b(give|do)\s+(me\s+)?(a\s+|an\s+|your\s+)?intro\b|\bintro\s+(yourself|urself|please|pls|me)\b|^intro$/,
  /\bstart\s+with\s+(an?\s+)?intro\b/,
  /\bdescribe\s+yourself\b/,
  /\bhow\s+(would|do)\s+you\s+describe\s+yourself\b/,
  /\bsummari[sz]e\s+who\s+you\s+are\b/,
  /\b(walk\s+me\s+through|tell\s+me\s+about)\s+your\s+(background|journey|career|profile)\b/,
  /\bgive\s+(me\s+)?your\s+background\b/,
  /\bwho\s+are\s+you\s+as\s+a\s+(candidate|person|professional)\b/,
];

const PROJECT_PATTERNS = [
  /\b(my|your)\s+projects?\b/,
  /\bprojects?\s+have\s+(i|you)\s+(done|built|worked\s+on|shipped)\b/,
  /\bwhat\s+all\s+projects?\b/,
  /\bthings\s+(i|you)\s+(built|shipped)\b/,
];

const SKILL_PATTERNS = [
  /\b(my|your)\s+(main\s+|technical\s+|key\s+|core\s+)?skills?\b/,
  /\bskills?\s+do\s+i\s+have\b/,
  /\btech\s+stack\b/,
  /\btools?\s+(do\s+i|have\s+you)\b/,
  /\btechnologies?\b/,
  // "what programming/coding languages do you know/use?" (Issue 7).
  /\bwhat\s+(programming|coding)\s+languages?\s+do\s+(you|i)\b/,
  /\bwhat\s+languages?\s+do\s+(you|i)\s+(know|use)\b/,
];

const EDUCATION_PATTERNS = [
  /\b(my|your)\s+education(al)?\b/,
  /\bwhere\s+did\s+(i|you)\s+(go\s+to\s+school|study|graduate)\b/,
  /\bdegree\b/,
  /\bschool\b/,
  /\buniversity\b/,
  /\bwhat(?:'s| is)\s+(your|my)\s+educational?\s+background\b/,
];

const ROLE_PATTERNS = [
  /\brole\s+am\s+i\s+applying\s+for\b/,
  /\bwhat\s+(job|position|role)\b.*\b(applying|targeting)\b/,
  /\btarget\s+(role|job|position)\b/,
];

const JD_FIT_PATTERNS = [
  /\bhow\s+do\s+i\s+fit\s+(this\s+)?(jd|job|role|position)\b/,
  /\bhow\s+am\s+i\s+a\s+(fit|match)\b/,
  /\bwhy\s+am\s+i\s+a\s+(good\s+)?(fit|match)\b/,
  /\bfit\s+(this\s+)?(jd|job|role|position)\b/,
  /\bmatch\s+(this\s+)?(jd|job|role|position)\b/,
];

const profileName = (profile: MaybeStructured<StructuredProfileFacts>): string => firstNonEmpty(
  profile?.identity?.name,
  profile?.name,
  profile?.personal?.name,
);

const jdTitle = (jd: MaybeStructured<StructuredJobFacts>): string => firstNonEmpty(jd?.title, jd?.role, jd?.position, jd?.jobTitle);
const jdCompany = (jd: MaybeStructured<StructuredJobFacts>): string => firstNonEmpty(jd?.company);

const formatInlineList = (items: string[], max = 8): string => {
  const values = items.map(clean).filter(Boolean).slice(0, max);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  // Two items read "X and Y" — the Oxford comma ("SQL, and Python") only
  // belongs in 3+ item lists (real manual log 2026-06-12 grammar polish).
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const profileExperience = (profile: MaybeStructured<StructuredProfileFacts>): ProfileExperience[] =>
  asArray(profile?.experience) as ProfileExperience[];
const profileProjects = (profile: MaybeStructured<StructuredProfileFacts>): ProfileProject[] =>
  asArray(profile?.projects) as ProfileProject[];
const profileEducation = (profile: MaybeStructured<StructuredProfileFacts>): ProfileEducation[] =>
  asArray(profile?.education) as ProfileEducation[];
// Skills may be a flat array (legacy) OR a categorized object
// {languages:[], frameworks:[], cloud:[], ...} (v2). Flatten either shape, and
// prefer the derived skills_flat when present.
const profileSkills = (profile: MaybeStructured<StructuredProfileFacts>): SkillItem[] => {
  const flat = (profile as any)?.skills_flat ?? (profile as any)?.skillsFlat;
  if (Array.isArray(flat)) return flat.filter(Boolean) as SkillItem[];
  const raw = (profile as any)?.skills;
  if (Array.isArray(raw)) return raw.filter(Boolean) as SkillItem[];
  if (raw && typeof raw === 'object') {
    const out: SkillItem[] = [];
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) out.push(...(v.filter(Boolean) as SkillItem[]));
    }
    return out;
  }
  return [];
};

// Deterministic first-person INTRO from structured facts — "I'm <name>, a
// <role>. ..." with current role/company + a couple of grounded highlights.
// This is the safe fallback for "tell me about yourself" / "give me a quick
// introduction" so an intro NEVER has to reach the LLM (where it was leaking
// "I'm Natively" / refusing). Returns '' when the name is missing.
//
// VARIANT-AWARE (manual regression 2026-06-12): one fixed intro was reused for
// intro/background/style questions across a whole session — users read it as a
// canned bot. The QUESTION now selects among grounded variants (same facts,
// different emphasis/ordering), deterministically (same question → same intro).
const formatIntro = (profile: MaybeStructured<StructuredProfileFacts>, question?: string): string => {
  const name = profileName(profile);
  if (!name) return '';
  const exp = profileExperience(profile);
  const cur = exp[0];
  const role = cur ? firstNonEmpty(cur.role, cur.title, cur.position) : '';
  const company = cur ? firstNonEmpty(cur.company, cur.organization, cur.employer) : '';
  const skills = profileSkills(profile)
    .map((s) => (typeof s === 'string' ? s : firstNonEmpty(s.name, s.skill)))
    .filter(Boolean).slice(0, 4);
  const projects = profileProjects(profile)
    .map((p) => firstNonEmpty(p.name, p.title)).filter(Boolean).slice(0, 1);
  const prior = exp[1] ? firstNonEmpty(exp[1].role, exp[1].title, exp[1].position) : '';

  const article = role && /^[aeiou]/i.test(role.trim()) ? 'an' : 'a';
  const lead = role ? `I'm ${name}, ${article} ${role}${company ? ` at ${company}` : ''}.` : `I'm ${name}.`;
  const skillLine = skills.length ? `I work mainly with ${formatInlineList(skills, 4)}.` : '';
  const projectLine = projects.length ? `One project I'm proud of is ${projects[0]}.` : '';

  const q = normalize(question || '');
  // BACKGROUND/JOURNEY phrasing → walk the experience arc.
  if (/\b(background|journey|career|history|path|walk me through)\b/.test(q)) {
    const arc = prior
      ? `I started out as ${/^[aeiou]/i.test(prior) ? 'an' : 'a'} ${prior} and I'm now ${role ? `${article} ${role}` : 'working'}${company ? ` at ${company}` : ''}.`
      : lead;
    return [`I'm ${name}.`, arc, skillLine].filter(Boolean).join(' ');
  }
  // STYLE/DESCRIBE phrasing → lead with how they work, not the title.
  if (/\b(describe yourself|how (would|do) you describe|who you are as|summari[sz]e who)\b/.test(q)) {
    const styleLead = skills.length
      ? `I'd describe myself as ${article} ${role || 'hands-on engineer'} who works mostly with ${formatInlineList(skills, 3)}.`
      : lead;
    return [`I'm ${name}.`, styleLead, projectLine].filter(Boolean).join(' ');
  }
  // QUICK/SHORT intro → one tight sentence.
  if (/\b(quick|brief|short|one[- ]?lin)\b/.test(q)) {
    return skills.length ? `${lead.replace(/\.$/, '')} working mainly with ${formatInlineList(skills, 3)}.` : lead;
  }
  // Default full intro — hash-vary the ORDERING across distinct phrasings so
  // "introduce yourself" and "tell me about yourself" don't produce the exact
  // same string in one session (deterministic: same question → same intro).
  let h = 0;
  for (let i = 0; i < q.length; i++) h = ((h << 5) - h + q.charCodeAt(i)) | 0;
  const variants: string[][] = [
    [lead, skillLine, projectLine],
    [lead, projectLine, skillLine],
    [lead, skills.length ? `Day to day I work with ${formatInlineList(skills, 4)}.` : '', projectLine],
  ];
  return variants[Math.abs(h) % variants.length].filter(Boolean).join(' ');
};

const formatExperience = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const entries = profileExperience(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 5).map((entry) => {
    const role = firstNonEmpty(entry.role, entry.title, entry.position);
    const company = firstNonEmpty(entry.company, entry.organization, entry.employer);
    const bullets = asArray(entry.bullets || entry.highlights || entry.responsibilities).map(clean).filter(Boolean);
    const headline = [role, company ? `at ${company}` : ''].filter(Boolean).join(' ');
    const detail = bullets[0] ? ` — ${bullets[0]}` : '';
    return headline ? `${headline}${detail}` : clean(entry);
  }).filter(Boolean);
  return lines.length ? `Your experience includes ${lines.join('; ')}.` : '';
};

const formatProjects = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const entries = profileProjects(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 6).map((project) => {
    const name = firstNonEmpty(project.name, project.title);
    const description = firstNonEmpty(project.description, project.summary);
    const tech = formatInlineList(asArray(project.technologies || project.tech_stack || project.tools).map(clean).filter(Boolean), 4);
    if (!name) return clean(project);
    return `${name}${description ? ` — ${description}` : ''}${tech ? ` (${tech})` : ''}`;
  }).filter(Boolean);
  return lines.length ? `Your projects include ${lines.join('; ')}.` : '';
};

// Phase 10: a single-project deterministic answer for "tell me about <project>",
// "best project", "tech stack of <project>". Reads the matched project node from
// structured data (NOT hardcoded) and renders a concise first/second-person
// answer with NO provider round-trip. Returns '' when no project matches so the
// caller falls through to the grounded LLM (e.g. a narrative drill-in).
const findProjectByName = (profile: MaybeStructured<StructuredProfileFacts>, q: string): ProfileProject | null => {
  const entries = profileProjects(profile);
  if (!entries.length) return null;
  // Explicit name match: the project's primary name token appears in the
  // question. Project names are often "Natively – Open Source AI Meeting Copilot"
  // while the question just says "natively", so match on the FIRST significant
  // name token (split on space/dash/en-dash) rather than the full string.
  for (const p of entries) {
    const name = firstNonEmpty(p.name, p.title);
    if (!name) continue;
    const lowerName = name.toLowerCase();
    if (q.includes(lowerName)) return p;
    const head = lowerName.split(/[\s–—\-:|]+/).filter(Boolean)[0];
    if (head && head.length >= 4 && new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return p;
  }
  // "best / most important / strongest / main PROJECT" → the first listed project
  // (resumes lead with the flagship). REQUIRES a project noun so "best approach",
  // "main responsibilities", "biggest risk", "top priorities" do NOT wrongly
  // return the flagship project (code-review 2026-06-05, HIGH).
  if (/\b(best|most important|strongest|main|biggest|favou?rite|top)\b/.test(q)
      && /\b(project|projects|work|app|product|system|build|built)\b/.test(q)) {
    return entries[0];
  }
  return null;
};
// Joining "is" + a description that starts with a capitalized article produced
// "My project Natively is A privacy-first..." (real manual log 2026-06-12).
// Lowercase a leading article/pronoun when it follows the copula; also strip a
// trailing period so the sentence doesn't double-stop.
const afterCopula = (description: string): string => {
  const d = description.trim().replace(/\.+$/, '');
  return d.replace(/^(A|An|The|It|This|That)\b/, (m) => m.toLowerCase());
};

const formatSingleProject = (project: ProfileProject): string => {
  const name = firstNonEmpty(project.name, project.title);
  const description = firstNonEmpty(project.description, project.summary);
  const tech = formatInlineList(asArray(project.technologies || project.tech_stack || project.tools).map(clean).filter(Boolean), 6);
  if (!name) return '';
  const parts = [`Your project ${name}`];
  if (description) parts.push(`is ${afterCopula(description)}`);
  const head = parts.join(' ');
  return `${head}.${tech ? ` It was built with ${tech}.` : ''}`;
};

// Find a skill token in the question that the profile actually lists, and which
// projects use it. Returns null when the skill isn't recognised in the profile
// (so we defer to the LLM rather than guess). Grounded — never invented.
const SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|sql|nosql|mongodb|postgres(?:ql)?|redis|data analysis|analytics|machine learning|ml|statistics)\b/i;
const findProfileSkill = (profile: MaybeStructured<StructuredProfileFacts>, q: string): { skill: string; projects: string[] } | null => {
  const m = q.match(SKILL_TOKEN_RE);
  if (!m) return null;
  const skill = m[0];
  const all = profileSkills(profile)
    .map((s) => (typeof s === 'string' ? s : firstNonEmpty(s.name, s.skill)))
    .filter(Boolean).map((s) => s.toLowerCase());
  const projects = profileProjects(profile)
    .filter((p) => {
      const tech = asArray(p.technologies || p.tech_stack || p.tools).map((t) => clean(t).toLowerCase());
      const desc = firstNonEmpty(p.description, p.summary).toLowerCase();
      return tech.some((t) => t.includes(skill.toLowerCase())) || desc.includes(skill.toLowerCase());
    })
    .map((p) => firstNonEmpty(p.name, p.title)).filter(Boolean).slice(0, 2);
  // Only fast-path when the skill is genuinely in the profile (skill list OR a project).
  const inSkills = all.some((s) => s.includes(skill.toLowerCase()) || skill.toLowerCase().includes(s));
  if (!inSkills && projects.length === 0) return null;
  return { skill, projects };
};
const formatSkillExperience = (profile: MaybeStructured<StructuredProfileFacts>, q: string): string => {
  const found = findProfileSkill(profile, q);
  if (!found) return '';
  const { skill, projects } = found;
  // GROUNDED "where" ONLY (code-review 2026-06-08 HIGH: never assert the skill was
  // "central to what I built" at a role the resume doesn't link to the skill — that's
  // a falsifiable hallucination). "where" is the projects that actually use the skill,
  // OR an experience entry whose role/tech/description actually mentions the skill.
  const groundedRole = (() => {
    for (const e of profileExperience(profile)) {
      const ex = e as Record<string, unknown>;
      const hay = [firstNonEmpty(e.role, e.title, e.position), firstNonEmpty(e.company, e.organization, e.employer),
        firstNonEmpty(ex.description, ex.summary),
        ...asArray(e.bullets || e.highlights || e.responsibilities),
        ...asArray(ex.technologies || ex.tech_stack || ex.skills)]
        .map((x) => clean(x).toLowerCase()).join(' ');
      if (hay.includes(skill.toLowerCase())) {
        const company = firstNonEmpty(e.company, e.organization, e.employer);
        const role = firstNonEmpty(e.role, e.title, e.position);
        // Company-led phrasing (manual regression 2026-06-12): the full
        // "my work as an <Role> at <Company>" string shares its stem with the
        // intro answer, so several skill answers in one session read as the
        // same canned intro. "my work at <Company>" is just as grounded.
        return company ? `my work at ${company}` : (role ? `my ${role} role` : '');
      }
    }
    return '';
  })();
  const where = projects.length ? formatInlineList(projects, 2) : groundedRole;

  const isWhere = /\bwhere\b/.test(q);
  const isHow = /\bhow\s+(have|did|do)\b/.test(q);
  const isHypothetical = /\bhow\s+would\b/.test(q);

  if (isHypothetical) {
    // "how would you use X" — a brief grounded-but-forward answer (profile optional).
    return where
      ? `I'd apply ${skill} the way I have in ${projects.length ? formatInlineList(projects, 1) : where} — building the core logic and validating it against real data.`
      : `I'd use ${skill} for the core implementation and validate it against real data, the way I approach any tool in my stack.`;
  }
  if (where) {
    // Grounded use exists → concrete, but don't overclaim "central"; state it
    // plainly. Phrasing is hash-varied by SKILL so two "where have you used X?"
    // asks in one session don't share an identical stem (manual regression
    // 2026-06-12: "fastapi"/"python" both answered with the same role line and
    // read as a canned intro). Deterministic — same skill → same sentence.
    let sh = 0;
    for (let i = 0; i < skill.length; i++) sh = ((sh << 5) - sh + skill.charCodeAt(i)) | 0;
    const v = Math.abs(sh) % 3;
    if (isWhere) {
      return v === 0 ? `I've used ${skill} in ${where}.`
        : v === 1 ? `${skill.charAt(0).toUpperCase()}${skill.slice(1)} came up mainly in ${where}.`
          : `Mostly in ${where} — that's where I've worked with ${skill} day to day.`;
    }
    if (isHow) return `I've used ${skill} hands-on in ${where} — building real features with it, not just studying it.`;
    return v === 0 ? `Yes — I've used ${skill} in ${where}.`
      : `Yes, ${skill} has been part of ${where}.`;
  }
  // Skill is in the profile's skill LIST but no project/role grounds a concrete use
  // case → honest, never the weak "X is one of the skills I work with" and never a
  // fabricated role claim. Say it's part of the toolkit and a specific use isn't
  // highlighted, so the candidate isn't caught overclaiming.
  return `Yes, ${skill} is part of my toolkit, though a specific project using it isn't highlighted in my loaded profile.`;
};

const formatSkills = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const skills = profileSkills(profile).map((skill) => typeof skill === 'string' ? skill : firstNonEmpty(skill.name, skill.skill)).filter(Boolean);
  return skills.length ? `Your skills include ${formatInlineList(skills, 12)}.` : '';
};

const formatEducation = (profile: MaybeStructured<StructuredProfileFacts>): string => {
  const entries = profileEducation(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 3).map((edu) => {
    const degree = [firstNonEmpty(edu.degree), firstNonEmpty(edu.field, edu.major)].filter(Boolean).join(' in ');
    const institution = firstNonEmpty(edu.institution, edu.school, edu.university);
    return [degree, institution ? `from ${institution}` : ''].filter(Boolean).join(' ');
  }).filter(Boolean);
  return lines.length ? `Your education includes ${lines.join('; ')}.` : '';
};

const structuredJobTerms = (jd: MaybeStructured<StructuredJobFacts>): string[] => [
  ...asArray(jd?.requirements),
  ...asArray(jd?.nice_to_haves),
  ...asArray(jd?.responsibilities),
  ...asArray(jd?.technologies),
  ...asArray(jd?.keywords),
].map(clean).filter(Boolean);

const normalizedTermSet = (terms: string[]): Set<string> => new Set(
  terms
    .flatMap((term) => term.split(/[^a-zA-Z0-9+#.]+/g))
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2),
);

const profileSkillNames = (profile: MaybeStructured<StructuredProfileFacts>): string[] =>
  profileSkills(profile).map((skill) => typeof skill === 'string' ? skill : firstNonEmpty(skill.name, skill.skill)).filter(Boolean);

const matchingSkillsForJD = (
  profile: MaybeStructured<StructuredProfileFacts>,
  jd: MaybeStructured<StructuredJobFacts>,
): string[] => {
  const jdTerms = normalizedTermSet(structuredJobTerms(jd));
  return profileSkillNames(profile).filter((skill) => {
    const normalizedSkill = skill.toLowerCase();
    return jdTerms.has(normalizedSkill) || normalizedSkill.split(/[^a-z0-9+#.]+/g).some((part) => jdTerms.has(part));
  });
};

const formatJDFit = (
  profile: MaybeStructured<StructuredProfileFacts>,
  jd: MaybeStructured<StructuredJobFacts>,
): string => {
  const title = jdTitle(jd);
  const company = jdCompany(jd);
  const matchedSkills = matchingSkillsForJD(profile, jd);
  const skills = matchedSkills.length ? matchedSkills : profileSkillNames(profile).slice(0, 3);
  const experience = profileExperience(profile);
  const projects = profileProjects(profile);
  const anchors = [
    skills.length ? `${formatInlineList(skills, 6)} ${matchedSkills.length ? 'match the role requirements' : 'are relevant resume skills'}` : '',
    experience[0] ? `${firstNonEmpty(experience[0].role, experience[0].title, experience[0].position)} experience${firstNonEmpty(experience[0].company, experience[0].organization, experience[0].employer) ? ` at ${firstNonEmpty(experience[0].company, experience[0].organization, experience[0].employer)}` : ''}` : '',
    projects[0] ? `${firstNonEmpty(projects[0].name, projects[0].title)} project work` : '',
  ].filter(Boolean);

  if (!title || !company || anchors.length === 0) return '';
  return `You fit the ${title} role at ${company} because ${anchors.join('; ')}.`;
};

export const isAssistantIdentityQuestion = (question: string): boolean => {
  const q = normalize(question);
  return hasAny(q, ASSISTANT_IDENTITY_PATTERNS);
};

export const isCandidateProfileQuestion = (question: string): boolean => {
  if (isAssistantIdentityQuestion(question)) return false;
  const q = normalize(question);
  return hasAny(q, [
    ...NAME_PATTERNS,
    ...EXPERIENCE_PATTERNS,
    ...PROJECT_PATTERNS,
    ...SKILL_PATTERNS,
    ...EDUCATION_PATTERNS,
    ...ROLE_PATTERNS,
    ...JD_FIT_PATTERNS,
  ]);
};

export const profileFactsReady = (profile: MaybeStructured<StructuredProfileFacts>): boolean => Boolean(
  profile && (
    profileName(profile) ||
    profileExperience(profile).length > 0 ||
    profileProjects(profile).length > 0 ||
    profileSkills(profile).length > 0 ||
    profileEducation(profile).length > 0
  ),
);

const makeRoute = (
  answer: string,
  answerType: AnswerType,
  selectedContextLayers: string[],
): ManualProfileRouteResult => ({
  answer,
  answerType,
  selectedContextLayers,
  excludedContextLayers: ['assistant_identity'],
  profileFactsReady: true,
  usedDeterministicFastPath: true,
  providerUsed: false,
});

// The deterministic fast-path answers SIMPLE, UNFILTERED listing questions
// ("what are my projects?", "what are my skills?") with a canned template. But a
// question that carries a QUALIFIER the template can't honor — a filter ("...that
// use REST API"), a constraint ("...related to ML"), a selection ("which one
// used GraphQL"), a comparison, or a "how/why" — must NOT get the canned dump;
// it has to go to the grounded LLM which sees the full profile and can actually
// reason. This regex detects such qualifiers so the fast path DEFERS (returns
// null) instead of dumping every item verbatim and ignoring the filter.
const QUALIFIER_PATTERNS = [
  /\b(that|which|where|whose|who)\b.*\b(use[ds]?|using|used|built|made|involve[ds]?|with|related|based|for|require[ds]?|need[s]?)\b/,
  /\b(use[ds]?|using|used|involv\w+|relat\w+|based\s+on|about|regarding|with)\b\s+\w/,
  /\bwhich\s+(one|project|skill|role|job|experience)\b/,
  /\bany\s+(project|experience|skill)s?\b.*\b(with|using|in|for|that)\b/,
  /\b(only|just|specifically|particular|specific)\b/,
  /\b(more|most|best|top|strongest|relevant|fit)\b/,
  /\bhow\s+(did|do|have|does)\b|\bwhy\b/,
  /\bcompare|versus|vs\.?\b|\bdifference\b/,
  /\bin\s+(python|java|javascript|typescript|go|rust|c\+\+|sql|react|node|aws|gcp|azure)\b/,
];

// "How do I fit this role/JD?" is the CANONICAL jd-fit phrasing — the JD-fit
// template already performs skill/experience matching, so the "how" here is not
// an unhandled filter. Exempt it so jd-fit keeps fast-pathing.
const JD_FIT_CANONICAL = /\b(how|why)\s+(do\s+i|am\s+i|are\s+you|would\s+i)\b.*\bfit\b/;

/**
 * True when the question carries a qualifier/filter/selection/constraint that the
 * canned listing template cannot honor — meaning the fast path must defer to the
 * grounded LLM. e.g. "projects that used REST API", "which project used GraphQL".
 * Exempts the canonical "how do I fit this role" jd-fit phrasing.
 */
export const hasUnhandledQualifier = (normalizedQuestion: string): boolean => {
  if (JD_FIT_CANONICAL.test(normalizedQuestion)) return false;
  return hasAny(normalizedQuestion, QUALIFIER_PATTERNS);
};

export const tryBuildManualProfileFastPathAnswer = ({
  question,
  profile,
  jobDescription,
  source = 'manual_input',
}: ManualProfileFastPathInput): ManualProfileRouteResult | null => {
  const qNorm = normalize(question);
  // ── CANDIDATE VOICE (release 2026-06-08 manual regression fix) ──────────────
  // The manual-send path must answer candidate identity/profile questions in FIRST
  // PERSON AS the candidate ("I'm Evin John, …" / "My name is …"), NOT in second
  // person ("Your name is …") and NOT as the assistant ("I'm Natively, an AI
  // assistant"). The prior code keyed first-person voice off `source` alone, so
  // manual_input answered everything 2nd-person — the real bug the user hit.
  //
  // Voice is now CANDIDATE first-person whenever a candidate PROFILE is loaded and
  // the question is NOT an explicit assistant-meta ask. WTA/transcript stay
  // first-person as before. An assistant-meta question ("are you an AI?", "what is
  // Natively?", "who made you?") always bails to the assistant path (returns null),
  // in every mode, so those still answer about the app — never as the candidate.
  if (isAssistantIdentityQuestion(question)) return null;
  const profileLoaded = profileFactsReady(profile);
  // Voice: FIRST PERSON ("My name is…", "I've used…") when WTA/transcript, OR when a
  // profile is loaded AND the question addresses the candidate as "you" / is an intro
  // ("who are you?", "what is YOUR name?", "introduce yourself", "why should we hire
  // you?", "rate YOUR Python"). SECOND PERSON ("Your name is…") only when the user
  // asks about THEMSELVES in first person ("what is MY name?", "what are MY skills?")
  // — there the user wants to be told their own fact. This is the manual regression
  // fix (release 2026-06-08): "who are you?" in profile mode → "My name is Evin John",
  // never "Your name is…" or "I'm Natively".
  const lc = qNorm;
  // SELF-query (user asking about THEMSELVES → second-person "Your name is…"): a
  // first-person "my"/"I" signal AND no second-person ADDRESS of the candidate. The
  // `you` exclusion is scoped to genuine candidate-address ("your X", "are you",
  // "have you", "did you", "yourself") so a stray "can you tell me my skills" still
  // reads as a self-query (code-review 2026-06-08 MEDIUM: align with the planner).
  const selfSignal = /\bmy\b|\bwho\s+am\s+i\b|\b(have|do)\s+i\b|\bi\s+have\b/.test(lc);
  const candidateAddress = /\byour\b|\byourself\b|\b(are|have|did|do|were|can|could|would|will|should)\s+you\b|\babout\s+you\b/.test(lc);
  const asksAboutSelf = selfSignal && !candidateAddress;
  const firstPerson = source === 'what_to_answer' || source === 'transcript'
    || (profileLoaded && !asksAboutSelf);

  const q = qNorm;

  // A qualified/filtered question must reach the grounded LLM, not the canned
  // template. Identity (name) and the JD role lookup are exact single-fact
  // answers with no list to filter, so they're allowed through below; everything
  // that returns a LIST (experience/projects/skills/education/jd-fit) defers when
  // a qualifier is present.
  const qualified = hasUnhandledQualifier(q);

  // JD-fit is itself a "reasoning" answer; if the user adds a further qualifier,
  // let the grounded LLM handle it rather than the deterministic anchor template.
  if (hasAny(q, JD_FIT_PATTERNS) && !qualified) {
    if (!profileFactsReady(profile)) return null;
    const answer = formatJDFit(profile, jobDescription);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^You fit/i, 'I fit') : answer, 'jd_fit_answer', ['resume', 'jd']);
  }

  if (hasAny(q, ROLE_PATTERNS)) {
    const title = jdTitle(jobDescription);
    if (!title) return null;
    return makeRoute(
      firstPerson ? `I am applying for the ${title} role.` : `You are applying for the ${title} role.`,
      'jd_fit_answer',
      ['jd'],
    );
  }

  if (!profileFactsReady(profile)) return null;

  const isNameQuestion = hasAny(q, NAME_PATTERNS)
    || (firstPerson && /\bwhat\s+(is|s)\s+your\s+name\b/.test(q));
  if (isNameQuestion) {
    const name = profileName(profile);
    if (!name) return null;
    return makeRoute(
      firstPerson ? `My name is ${name}.` : `Your name is ${name}.`,
      'identity_answer',
      ['stable_identity', 'resume'],
    );
  }

  // INTRO: a grounded first-person introduction built from structured facts.
  // Release 2026-06-06b: this now fires in MANUAL mode too (not just WTA). The
  // real manual-chat log showed plain "introduce yourself" / "introduce yourseld"
  // reaching the LLM and answering "I'm Natively, an AI assistant" — wrong when a
  // candidate profile is loaded. An intro ask is an INTERVIEW-style question
  // ("introduce yourself", "tell me about yourself"), distinct from the
  // assistant-meta "who are you / what is Natively" (those still bail above via
  // isAssistantIdentityQuestion). With a profile loaded, the deterministic
  // first-person candidate intro is always the right answer — it can never leak
  // the assistant identity or refuse. NOTE: does NOT gate on `qualified` —
  // "tell me ABOUT yourself" trips the generic about-qualifier, but INTRO_PATTERNS
  // is already precise.
  if (hasAny(q, INTRO_PATTERNS)) {
    const intro = formatIntro(profile, question);
    if (intro) return makeRoute(intro, 'identity_answer', ['stable_identity', 'resume']);
  }

  // List-returning answers: a canned dump can't honor a filter/qualifier, so
  // defer to the grounded LLM when one is present (e.g. "projects that use REST
  // API", "skills in Python", "experience related to ML").
  if (hasAny(q, EXPERIENCE_PATTERNS) && !qualified) {
    const answer = formatExperience(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your experience includes/i, 'My experience includes') : answer, 'experience_answer', ['resume']);
  }

  // Phase 10: single-project FAST PATH — "tell me about Natively", "best
  // project", "tech stack of Natively". Deterministic from the matched project
  // node (zero provider latency). Narrative drill-ins ("how was it developed?",
  // "hardest part?", "what did you learn?", "your role?") are NOT handled here —
  // they deserve a richer grounded answer, so we only fast-path the factual
  // "what is it / what stack" shape and defer everything else to the LLM.
  // NOTE: this branch does NOT gate on `qualified` — "tell me ABOUT Natively"
  // trips the generic `about`-qualifier, but findProjectByName already scopes the
  // answer to the named project, so the qualifier guard would wrongly suppress a
  // perfectly answerable direct project ask. Narrative drill-ins are excluded
  // explicitly below so they still reach the richer grounded LLM.
  const isNarrativeDrillIn = /\b(how (was|is|did)|hardest|challenge|learn|your role|why did you|proud|improve|optimi[sz]e|architecture|coordinat)\b/.test(q);
  const isProjectFactAsk = /\b(tell me about|talk about|explain|describe|what(?:'s| is)?|tech ?stack|technolog|stack of|built with|made with)\b/.test(q);
  if (isProjectFactAsk && !isNarrativeDrillIn) {
    const project = findProjectByName(profile, q);
    if (project) {
      const answer = formatSingleProject(project);
      if (answer) {
        return makeRoute(
          firstPerson ? answer.replace(/^Your project/i, 'My project') : answer,
          'project_answer', ['resume', 'projects'],
        );
      }
    }
  }

  if (hasAny(q, PROJECT_PATTERNS) && !qualified) {
    const answer = formatProjects(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your projects include/i, 'My projects include') : answer, 'project_answer', ['resume', 'projects']);
  }

  // SKILL-EXPERIENCE fast path: "what is your experience with Python?", "have you
  // used SQL?", "your data analysis experience" — grounded confirmation + where
  // it's used. NOT skill RATINGS ("rate your Python 8/10") — a number is a
  // judgment we leave to the grounded LLM. Returns '' (→ LLM) if the skill isn't
  // genuinely in the profile.
  const isSkillExperienceQ = /\b(experience\s+(with|in|using)|have\s+(you|i)\s+(used|worked\s+with)|worked\s+with|familiar\s+with)\b/.test(q)
    && !/\brate|out of (?:10|ten)|scale\b/.test(q);
  if (isSkillExperienceQ) {
    const answer = formatSkillExperience(profile, q);
    if (answer) return makeRoute(firstPerson ? answer : answer.replace(/^Yes, I've/i, "Yes, you've"), 'skill_experience_answer', ['resume']);
  }

  if (hasAny(q, SKILL_PATTERNS) && !qualified) {
    const answer = formatSkills(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your skills include/i, 'My skills include') : answer, 'skills_answer', ['resume']);
  }

  if (hasAny(q, EDUCATION_PATTERNS) && !qualified) {
    const answer = formatEducation(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your education includes/i, 'My education includes') : answer, 'profile_fact_answer', ['resume']);
  }

  return null;
};

/**
 * LIVE LATENCY FALLBACK (Phase 9). When the provider stalls past the live-copilot
 * budget on a profile-grounded answer, we must still say SOMETHING grounded — never
 * an empty answer or a 10s+ wait. This always returns a first-person answer for a
 * profile route by trying, in order: the exact deterministic fast-path, then a
 * grounded intro, then an experience/skills summary. Returns null only when the
 * route is not profile-grounded (coding/meeting handle their own fallback) or no
 * profile is loaded — the caller then keeps whatever partial text streamed.
 */
export const buildLiveFallbackAnswer = ({
  question,
  answerType,
  profile,
  jobDescription,
}: {
  question: string;
  answerType: string;
  profile: MaybeStructured<StructuredProfileFacts>;
  jobDescription?: MaybeStructured<StructuredJobFacts>;
}): string | null => {
  if (!profileFactsReady(profile)) return null;
  const profileRoutes = new Set([
    'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
    'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
    'behavioral_interview_answer',
  ]);
  if (!profileRoutes.has(answerType)) return null;

  // 1. Exact deterministic fast-path (handles name/intro/role/jd-fit/projects/etc.).
  try {
    const fp = tryBuildManualProfileFastPathAnswer({ question, profile, jobDescription, source: 'what_to_answer' });
    if (fp?.answer) return fp.answer;
  } catch { /* fall through */ }

  // 2. JD-fit specific summary.
  if (answerType === 'jd_fit_answer') {
    const fit = formatJDFit(profile, jobDescription);
    if (fit) return fit.replace(/^You fit/i, 'I fit');
  }

  // 3. A grounded intro is a safe, on-topic answer for any "about me" route.
  const intro = formatIntro(profile, question);
  if (intro) return intro;

  // 4. Last resort: an experience or skills line.
  const exp = formatExperience(profile);
  if (exp) return exp.replace(/^Your experience includes/i, 'My experience includes');
  const skills = formatSkills(profile);
  if (skills) return skills.replace(/^Your skills include/i, 'My skills include');
  return null;
};

export const logManualProfileRoute = ({
  source,
  question,
  route,
  profileFactsReady,
}: ManualProfileRouteLogInput): ManualProfileRouteLog => ({
  source,
  questionHash: createHash('sha256').update(question).digest('hex').slice(0, 12),
  answerType: route?.answerType ?? 'unknown_answer',
  selectedContextLayers: route?.selectedContextLayers ?? [],
  excludedContextLayers: route?.excludedContextLayers ?? [],
  profileFactsReady,
  usedDeterministicFastPath: route?.usedDeterministicFastPath ?? false,
  providerUsed: route?.providerUsed ?? false,
  promptContainsProfileContext: route?.promptContainsProfileContext,
});

// ── PI v3 (W6b): graceful retry — no more dead-end canned reply ─────────────
//
// "Could you repeat that? I want to make sure I address your question
// properly." was a single fixed string returned from THREE failure sites
// (empty stream, error catch, speculative empty). Users read it as a canned
// non-answer — especially when the same sentence appears twice in a session.
// buildGracefulRetry keeps the same safety contract (deterministic, no LLM, no
// profile content, never fabricates) but:
//   - references the detected TOPIC when one is safely extractable, so the
//     retry reads as engaged ("…about the database design…") instead of deaf,
//   - varies phrasing deterministically (hash of question; not random — same
//     input → same output for testability),
//   - never echoes a question longer than a few words (no transcript dumping).

const RETRY_TEMPLATES: ReadonlyArray<(topic: string) => string> = [
  (t) => t
    ? `Could you say a bit more about ${t}? I want to make sure I answer the right thing.`
    : 'Could you repeat that? I want to make sure I address your question properly.',
  (t) => t
    ? `I didn't fully catch the question about ${t} — could you rephrase it?`
    : "I didn't fully catch that — could you rephrase the question?",
  (t) => t
    ? `Just to make sure I get this right — what specifically about ${t} would you like me to cover?`
    : 'Just to make sure I get this right — could you ask that once more?',
];

// Topic = a short noun-ish tail of the question. Conservative: strip leading
// question scaffolding, keep ≤5 words, drop if anything sensitive/odd remains.
const TOPIC_STOP_RE = /\b(salary|compensation|pay|offer|equity)\b/i;
const extractRetryTopic = (question: string): string => {
  const q = (question || '').trim().replace(/\?+$/, '');
  if (!q || q.length < 8 || q.length > 160) return '';
  if (TOPIC_STOP_RE.test(q)) return ''; // never echo comp topics back
  const stripped = q
    .replace(/^(so|well|okay|ok|now|and|but|um|uh)[,\s]+/i, '')
    .replace(/^(can|could|would|will|do|does|did|are|is|was|were|have|has|had)\s+you\s+/i, '')
    .replace(/^(tell me|talk|walk me through|explain|describe)( (about|to me about|through))?\s*/i, '')
    .replace(/^(what|how|why|when|where|who)('s| is| are| was| were| do| does| did| about)?\s*/i, '')
    .trim();
  if (!stripped) return '';
  const words = stripped.split(/\s+/).slice(0, 5);
  if (words.length < 1) return '';
  const topic = words.join(' ').replace(/[.,;:!]+$/, '');
  // Reject anything that isn't a clean short noun phrase (review 2026-06-12):
  //  - pronouns ("you think we should…"),
  //  - internal punctuation (a comma means we sliced mid-clause — "John, given
  //    everything, what does" must never be echoed back),
  //  - residual question scaffolding ("…what does", "who/when/why …"),
  //  - a leading capitalized name-like token mid-question (don't echo people).
  if (/\b(you|your|we|our|i|my)\b/i.test(topic)) return '';
  if (/[,;:()]/.test(topic)) return '';
  if (/\b(what|how|why|who|when|where|which|does|do|did|think|say|said)\b/i.test(topic)) return '';
  if (/^[A-Z][a-z]+$/.test(words[0]) && !q.startsWith(words[0])) return '';
  return topic.toLowerCase();
};

/**
 * A deterministic, speakable retry line for when no answer could be produced.
 * Same input → same output (template chosen by question hash, not random).
 */
export const buildGracefulRetry = (questionHint?: string | null): string => {
  const q = (questionHint || '').trim();
  const topic = extractRetryTopic(q);
  let h = 0;
  for (let i = 0; i < q.length; i++) h = ((h << 5) - h + q.charCodeAt(i)) | 0;
  const template = RETRY_TEMPLATES[Math.abs(h) % RETRY_TEMPLATES.length];
  return template(topic);
};
