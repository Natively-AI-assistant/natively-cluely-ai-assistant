export enum DocType {
  RESUME = 'resume',
  JD = 'jd',
}

export interface KnowledgeStatus {
  hasResume: boolean;
  activeMode: boolean;
  resumeSummary?: { name?: string; role?: string; totalExperienceYears?: number };
}

export interface ResumeIdentity {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  links?: string[];
}

export interface ResumeExperience {
  title: string;
  organization: string;
  start_date?: string;
  end_date?: string;
  duration_months?: number;
  bullets: string[];
  technologies?: string[];
}

export interface ResumeProject {
  name: string;
  description: string;
  technologies?: string[];
  url?: string;
}

export interface ResumeEducation {
  degree: string;
  institution: string;
  start_date?: string;
  end_date?: string;
  details?: string;
}

export interface StructuredResume {
  identity: ResumeIdentity;
  summary?: string;
  current_role?: string;
  total_experience_years?: number;
  skills: string[];
  experiences: ResumeExperience[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  certifications?: string[];
}

export interface ActiveJD {
  title: string;
  company: string;
  location: string;
  level: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | string;
  technologies: string[];
  requirements: string[];
  nice_to_haves?: string[];
  keywords: string[];
  compensation_hint?: string;
  min_years_experience?: number;
  remote_policy?: 'remote' | 'hybrid' | 'onsite' | string;
  responsibilities?: string[];
}

export interface NegotiationScript {
  salary_range: {
    currency: string;
    min: number;
    max: number;
    confidence: 'high' | 'medium' | 'low';
  };
  opening_line: string;
  justification: string;
  counter_offer_fallback: string;
  sources?: string[];
}

export interface CompanySalaryEstimate {
  title: string;
  location: string;
  currency: string;
  min: number;
  max: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CompanyCultureRatings {
  overall: number;
  review_count?: number;
  data_sources?: string[];
  work_life_balance: number;
  career_growth: number;
  compensation: number;
  management: number;
  diversity: number;
}

export interface CompanyEmployeeReview {
  quote: string;
  sentiment: 'positive' | 'mixed' | 'negative';
  role?: string;
  source?: string;
}

export interface CompanyCritic {
  category: string;
  complaint: string;
  frequency: 'widespread' | 'frequently' | 'occasionally';
}

export interface CompanyDossier {
  hiring_strategy?: string;
  interview_focus?: string;
  interview_difficulty?: 'easy' | 'medium' | 'hard' | string;
  salary_estimates?: CompanySalaryEstimate[];
  culture_ratings?: CompanyCultureRatings;
  employee_reviews?: CompanyEmployeeReview[];
  critics?: CompanyCritic[];
  benefits?: string[];
  core_values?: string[];
  recent_news?: string;
  competitors?: string[];
  sources?: string[];
}

export interface ProfileData {
  identity?: { name: string; email: string };
  skills: string[];
  experienceCount: number;
  projectCount: number;
  nodeCount: number;
  hasActiveJD: boolean;
  activeJD?: ActiveJD;
  negotiationScript?: NegotiationScript;
}

export interface KnowledgeProcessResult {
  liveNegotiationResponse?: string;
  isIntroQuestion?: boolean;
  introResponse?: string;
  systemPromptInjection?: string;
  contextBlock?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface ISearchProvider {
  search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]>;
  quotaExhausted: boolean;
}

export type GenerateContentFn = (contents: Array<{ text: string }>) => Promise<string>;
export type EmbedFn = (text: string) => Promise<number[]>;
