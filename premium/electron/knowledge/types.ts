// electron/knowledge/types.ts
// Generic type definitions for the Knowledge Engine

export enum DocType {
    RESUME = 'resume',
    JD = 'job_description',
    COMPANY_WIKI = 'company_wiki',
    GENERIC = 'generic'
}

/**
 * Represents a document stored in the knowledge base.
 */
export interface KnowledgeDocument {
    id?: number;
    type: DocType;
    source_uri: string;
    structured_data: any; // The JSON extracted from the LLM
    /**
     * The document's raw parsed text (2026-08-01, deep-test D1). Structured
     * extraction is inherently lossy — facts without a schema slot were
     * unrecoverable at answer time. Nullable: rows ingested before this column
     * existed carry NULL and consumers fall back to re-reading source_uri.
     */
    raw_text?: string | null;
    created_at?: string;
}

/**
 * A generalized node of knowledge with embeddings for vector search.
 */
export interface ContextNode {
    id?: number;
    document_id?: number;
    source_type: DocType;
    category: string; // e.g. 'experience', 'requirement', 'company_value'
    title: string;
    text_content: string;
    // Common metadata (optional, depends on source type)
    organization?: string;
    start_date?: string | null;
    end_date?: string | null;
    duration_months?: number; // useful for experience weighting
    tags: string[];
    embedding?: number[];
    /**
     * Composite embedding-space identity (`${name}:${model}:${dims}`) the embedding
     * was produced in. Mirrors meetings' embedding_space: lets a same-dimension model
     * swap (gemini-embedding-001 768d → gemini-embedding-2 768d) be detected as
     * incompatible and force a re-embed, instead of silently comparing v1 node vectors
     * against v2 query vectors. Undefined for legacy rows (pre-migration) → treated as
     * stale and re-embedded. See electron/rag/embeddingSpace.ts.
     */
    embedding_space?: string;
}

export interface ScoredNode {
    node: ContextNode;
    score: number;
}

export interface KnowledgeStatus {
    hasResume: boolean;
    hasActiveJD: boolean;
    activeMode: boolean; // Is knowledge engine active for chat
    resumeSummary?: {
        name: string;
        role: string;
        totalExperienceYears: number;
    };
    jdSummary?: {
        title: string;
        company: string;
    };
}

// ============================================
// Resume Specific Types
// ============================================

export interface IdentityInfo {
    name: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
    website?: string;
    summary?: string;
}

export interface ExperienceEntry {
    company: string;
    role: string;
    start_date: string; // YYYY-MM
    end_date: string | null; // null = ongoing
    bullets: string[];
}

export interface ProjectEntry {
    name: string;
    description: string;
    technologies: string[];
    url?: string;
    // Individual resume bullets for this project (metrics, architecture
    // notes, etc.) beyond the single summary `description`. A resume entry
    // with 3 distinct bullets (e.g. "gained 4,000+ users and 500+ stars",
    // "architected a local RAG system", "engineered a hybrid Electron+Rust
    // core") previously collapsed into ONE description sentence during LLM
    // extraction, silently dropping metrics/facts the model never saw again
    // (Profile Intelligence production-fix 2026-07-05, Confirmed Bug #4).
    // Optional — absent on profiles ingested before this field existed;
    // every consumer must treat a missing/empty array as "no extra bullets".
    highlights?: string[];
}

export interface EducationEntry {
    institution: string;
    degree: string;
    field: string;
    start_date: string;
    end_date: string | null;
    gpa?: string;
}

export interface AchievementEntry {
    title: string;
    description: string;
    date?: string;
}

export interface CertificationEntry {
    name: string;
    issuer: string;
    date?: string;
}

export interface LeadershipEntry {
    role: string;
    organization: string;
    description: string;
}

// ============================================
// Skills (sub-categorized)
// ============================================
// RC-3 fix: skills were a single flat string[] with no sub-structure, so
// "what cloud tools do I know?" could only return the entire skill list
// (languages included). Sub-categorizing into typed buckets makes each
// skill question answerable from the correct slot. "tools" is the catch-all
// so no skill is ever dropped.

export const SKILL_CATEGORIES = [
    'languages',   // Python, TypeScript, Go, SQL, Java...
    'frameworks',  // React, Next.js, Django, Spring, FastAPI...
    'cloud',       // AWS, GCP, Azure, Vercel, Cloudflare...
    'databases',   // PostgreSQL, Redis, MongoDB, pgvector...
    'ml',          // PyTorch, TensorFlow, LangChain, RAG, LLMs...
    'devops',      // Docker, Kubernetes, Terraform, CI/CD, Jenkins...
    'tools',       // Git, Jira, Figma, Datadog... (catch-all)
] as const;

export type SkillCategory = typeof SKILL_CATEGORIES[number];

export type CategorizedSkills = {
    [K in SkillCategory]: string[];
};

/** Bumped when the persisted structured_data shape changes. v2 = categorized skills. */
export const PROFILE_SCHEMA_VERSION = 2 as const;

export const EMPTY_SKILLS: CategorizedSkills = {
    languages: [], frameworks: [], cloud: [], databases: [], ml: [], devops: [], tools: [],
};

export interface StructuredResume {
    identity: IdentityInfo;
    skills: CategorizedSkills;
    /**
     * Derived flat list of every skill across all categories (deduped).
     * Always recomputed wherever `skills` is set — never authoritative.
     * Exists so the many consumers that just want "all skills as a list"
     * (skill→experience mapping, negotiation/mock prompts, membership tests)
     * don't each re-flatten. Read via `resume.skills_flat ?? flattenSkills(resume.skills)`.
     */
    skills_flat?: string[];
    experience: ExperienceEntry[];
    projects: ProjectEntry[];
    education: EducationEntry[];
    achievements: AchievementEntry[];
    certifications: CertificationEntry[];
    leadership: LeadershipEntry[];
}

export interface SkillExperienceMap {
    [skill: string]: number; // months
}

export interface ProcessedResumeData {
    structured: StructuredResume;
    totalExperienceYears: number;
    skillExperienceMap: SkillExperienceMap;
}

// ============================================
// JD Specific Types
// ============================================

export type JDLevel = 'intern' | 'entry' | 'mid' | 'senior' | 'staff' | 'principal';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship';

/** Runtime-checkable mirrors of JDLevel/EmploymentType — the single source
 *  for both StructuredExtractor's LLM-output validation and
 *  StructuredJDNormalizer's defense-in-depth coercion, so the two can't
 *  silently drift apart. */
export const VALID_JD_LEVELS: JDLevel[] = ['intern', 'entry', 'mid', 'senior', 'staff', 'principal'];
export const VALID_JD_EMPLOYMENT_TYPES: EmploymentType[] = ['full_time', 'part_time', 'contract', 'internship'];

export interface StructuredJD {
    title: string;
    company: string;
    location: string;
    description_summary: string;
    level: JDLevel;
    employment_type: EmploymentType;
    min_years_experience: number;
    compensation_hint: string;
    requirements: string[];
    nice_to_haves: string[];
    responsibilities: string[];
    technologies: string[];
    keywords: string[];
}

// ============================================
// Company Research Types
// ============================================

export interface SalaryEstimate {
    title: string;
    location: string;
    min: number;
    max: number;
    currency: string;
    source: string;
    confidence: 'low' | 'medium' | 'high';
}

/** Star ratings aggregated from employee review platforms (Glassdoor, Indeed, Blind, etc.) */
export interface CultureRatings {
    overall: number;           // 0.0–5.0
    work_life_balance: number; // 0.0–5.0
    career_growth: number;     // 0.0–5.0
    compensation: number;      // 0.0–5.0
    management: number;        // 0.0–5.0
    diversity: number;         // 0.0–5.0
    review_count?: string;     // e.g. "~3,200 reviews"
    data_sources: string[];    // ["Glassdoor", "Indeed", "Blind"]
}

/** Representative employee quote extracted from review platforms */
export interface EmployeeReview {
    quote: string;
    sentiment: 'positive' | 'mixed' | 'negative';
    source: string;  // e.g. "Glassdoor", "Indeed", "Blind"
    role?: string;   // e.g. "Software Engineer"
}

/** Recurring complaint pattern found in employee reviews */
export interface CriticInsight {
    category: string;   // e.g. "Work-Life Balance", "Management", "Pay"
    complaint: string;  // 1–2 sentence summary of the issue
    frequency: 'occasionally' | 'frequently' | 'widespread';
}

export interface CompanyDossier {
    company: string;
    hiring_strategy: string;
    interview_focus: string;
    interview_difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard';
    core_values?: string[];
    salary_estimates: SalaryEstimate[];
    culture_ratings?: CultureRatings;
    employee_reviews?: EmployeeReview[];
    critics?: CriticInsight[];
    benefits?: string[];
    competitors: string[];
    recent_news: string;
    sources: string[];
    fetched_at: string;
    /** True when built WITHOUT live search (LLM-only training-data guesswork).
     *  A cached degraded dossier is re-researched as soon as search is available. */
    degraded?: boolean;
}

// ============================================
// Resume-Only Salary Estimation
// ============================================

export interface ResumeSalaryEstimate {
    role: string;
    location: string;
    currency: string;
    min: number;
    max: number;
    confidence: 'low' | 'medium' | 'high';
    justification_factors: string[];
    estimated_at: string;
}

// ============================================
// Advanced Knowledge Pipeline Types
// ============================================

export interface AOTStatus {
    companyResearch: 'pending' | 'running' | 'done' | 'failed';
    negotiationScript: 'pending' | 'running' | 'done' | 'failed';
    gapAnalysis: 'pending' | 'running' | 'done' | 'failed';
    starMapping: 'pending' | 'running' | 'done' | 'failed';
}

export interface SkillGap {
    skill: string;
    gap_type: 'missing' | 'weak';
    pivot_script: string;
    transferable_skills: string[];
}

export interface GapAnalysisResult {
    matched_skills: string[];
    gaps: SkillGap[];
    match_percentage: number;
}

export interface MockQuestion {
    question: string;
    category: 'technical' | 'behavioral' | 'system_design' | 'culture_fit';
    difficulty: 'easy' | 'medium' | 'hard';
    rationale: string;
    suggested_answer_key: string;
}

export interface StarStory {
    original_bullet: string;
    situation: string;
    task: string;
    action: string;
    result: string;
    full_narrative: string;
    parent_role: string;
    parent_company: string;
    timeline: string;
    /** LLM-expanded, or a source-bullet fallback after bounded STAR recovery fails. */
    generation_mode?: 'llm' | 'fallback';
}

export type ToneDirective = 'high_level_business' | 'deep_technical' | 'balanced';

// ============================================
// Intent Classification
// ============================================

export enum IntentType {
    TECHNICAL = 'technical',
    INTRO = 'intro',
    COMPANY_RESEARCH = 'company_research',
    NEGOTIATION = 'negotiation',
    PROFILE_DETAIL = 'profile_detail',
    GENERAL = 'general'
}

// ── Live Negotiation Coaching ────────────────────────────────

export type NegotiationPhase =
  | 'INACTIVE'
  | 'PROBE'
  | 'ANCHOR'
  | 'COUNTER'
  | 'HOLD'
  | 'PIVOT_BENEFITS'
  | 'CLOSE';

export interface OfferEvent {
  speaker: 'recruiter' | 'user';
  amount: number;
  currency: string;
  offerType: 'base' | 'total' | 'range_min' | 'range_max' | 'ceiling' | 'unknown';
  raw: string;
  timestamp: number;
  isVague: boolean;
}

export interface OfferState {
  latestRecruiterAmount: number | null;
  latestRecruiterCurrency: string;
  trajectory: 'rising' | 'flat' | 'falling' | 'first';
  allEvents: OfferEvent[];
}

export interface NegotiationState {
  phase: NegotiationPhase;
  offers: OfferState;
  userTarget: number | null;
  pushbackCount: number;
  benefitsMentioned: string[];
  vagueOfferDetected: boolean;
  silenceTimerActive: boolean;
  lastRecruiterSignal: 'offer' | 'pushback' | 'rejection' | 'acceptance' | 'vague' | 'benefits' | null;
}

export interface LiveCoachingResponse {
  tacticalNote: string;
  exactScript: string;
  showSilenceTimer: boolean;
  phase: NegotiationPhase;
  theirOffer: number | null;
  yourTarget: number | null;
  currency: string;
  isNegotiationCoaching: true;
}
