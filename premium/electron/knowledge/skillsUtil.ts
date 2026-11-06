// electron/knowledge/skillsUtil.ts
//
// Helpers for the sub-categorized skills model (RC-3).
//
// Three jobs:
//   1. coerceSkills      — accept any historical shape (undefined | string[] |
//                          partial object | full object) and return a complete,
//                          deduped CategorizedSkills. Never throws, never drops a
//                          skill. This is the back-compat safety net that lets old
//                          flat-skills profiles load without crashing.
//   2. flattenSkills     — derive the flat string[] (deduped, category order) used
//                          by the many consumers that just want "all skills".
//   3. categorizeFlatSkills — DETERMINISTIC keyword→bucket classifier. Used to
//                          backfill stored v1 profiles (flat list → categories)
//                          WITHOUT an LLM call, and as the offline fallback when
//                          the extractor regresses to a flat array.

import { CategorizedSkills, SkillCategory, SKILL_CATEGORIES, EMPTY_SKILLS } from './types';

/** Fresh empty CategorizedSkills (never share the EMPTY_SKILLS reference). */
export function emptySkills(): CategorizedSkills {
    return { languages: [], frameworks: [], cloud: [], databases: [], ml: [], devops: [], tools: [] };
}

function dedupePreserveOrder(items: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
        if (typeof raw !== 'string') continue;
        const v = raw.trim();
        if (!v) continue;
        const key = v.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
    }
    return out;
}

/**
 * Flatten CategorizedSkills into a deduped flat list, in category order
 * (languages → frameworks → cloud → databases → ml → devops → tools).
 */
export function flattenSkills(skills: CategorizedSkills | undefined | null): string[] {
    if (!skills) return [];
    const all: string[] = [];
    for (const cat of SKILL_CATEGORIES) {
        const arr = (skills as any)[cat];
        if (Array.isArray(arr)) all.push(...arr);
    }
    return dedupePreserveOrder(all);
}

/**
 * Coerce any historical/legacy skills value into a complete CategorizedSkills.
 *   - undefined / null            → all-empty
 *   - string[]                    → deterministically categorized (keyword map)
 *   - partial/full object         → missing keys filled, each array deduped,
 *                                    unknown keys folded into `tools`
 * Never drops a skill; unknowns land in `tools`.
 */
export function coerceSkills(raw: any): CategorizedSkills {
    if (!raw) return emptySkills();

    // Legacy flat array (v1 profiles, or an extractor regression).
    if (Array.isArray(raw)) {
        return categorizeFlatSkills(raw as string[]);
    }

    if (typeof raw === 'object') {
        const out = emptySkills();
        const leftover: string[] = [];
        for (const [key, val] of Object.entries(raw)) {
            if (!Array.isArray(val)) continue;
            const arr = (val as any[]).filter((x) => typeof x === 'string') as string[];
            if ((SKILL_CATEGORIES as readonly string[]).includes(key)) {
                out[key as SkillCategory].push(...arr);
            } else {
                // Unknown category key → don't lose the skills, fold into tools.
                leftover.push(...arr);
            }
        }
        if (leftover.length) out.tools.push(...leftover);
        for (const cat of SKILL_CATEGORIES) {
            out[cat] = dedupePreserveOrder(out[cat]);
        }
        return out;
    }

    // Anything else (string, number) — nothing usable.
    return emptySkills();
}

// ---------------------------------------------------------------------------
// Deterministic keyword → category classification.
// Order matters: the FIRST category whose matcher hits wins. ml is checked
// before frameworks (PyTorch is ml, not a framework); databases before tools.
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');

// Built from lowercased, separator-stripped tokens so "Node.js" == "nodejs".
const CATEGORY_RULES: Array<{ cat: SkillCategory; exact: Set<string>; includes: string[] }> = [
    {
        cat: 'languages',
        exact: new Set([
            'python', 'typescript', 'javascript', 'js', 'ts', 'java', 'go', 'golang', 'rust',
            'c', 'cpp', 'c++', 'csharp', 'c#', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r',
            'sql', 'bash', 'shell', 'perl', 'haskell', 'elixir', 'dart', 'objectivec', 'lua',
            'matlab', 'solidity', 'clojure', 'erlang', 'fsharp', 'groovy', 'html', 'css',
        ].map(norm)),
        includes: [],
    },
    {
        cat: 'ml',
        exact: new Set([
            'pytorch', 'tensorflow', 'keras', 'scikitlearn', 'sklearn', 'xgboost', 'lightgbm',
            'huggingface', 'transformers', 'langchain', 'llamaindex', 'rag', 'llm', 'llms',
            'opencv', 'spacy', 'nltk', 'pandas', 'numpy', 'jupyter', 'mlflow', 'onnx', 'cuda',
            'ollama', 'diffusers', 'finetuning', 'embeddings', 'vectorsearch',
        ].map(norm)),
        includes: ['machinelearning', 'deeplearning', 'neuralnet', 'nlp', 'computervision',
            'genai', 'generativeai', 'gpt', 'bert', 'diffusion'],
    },
    {
        cat: 'cloud',
        exact: new Set([
            'aws', 'gcp', 'azure', 'vercel', 'netlify', 'cloudflare', 'heroku', 'digitalocean',
            'lambda', 's3', 'ec2', 'cloudfront', 'firebase', 'supabase', 'render', 'fly',
            'cloudrun', 'gke', 'eks', 'aks', 'route53',
        ].map(norm)),
        includes: ['amazonwebservices', 'googlecloud', 'azurecloud'],
    },
    {
        cat: 'databases',
        exact: new Set([
            'postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'mongo', 'redis', 'cassandra',
            'dynamodb', 'elasticsearch', 'neo4j', 'mariadb', 'oracle', 'mssql', 'cockroachdb',
            'pgvector', 'pinecone', 'weaviate', 'qdrant', 'chroma', 'snowflake', 'bigquery',
            'clickhouse', 'influxdb', 'couchbase', 'firestore',
        ].map(norm)),
        includes: ['database'],
    },
    {
        cat: 'devops',
        exact: new Set([
            'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'jenkins', 'githubactions',
            'gitlabci', 'circleci', 'travisci', 'helm', 'prometheus', 'grafana', 'datadog',
            'nginx', 'apache', 'kafka', 'rabbitmq', 'airflow', 'argocd', 'vault', 'consul',
            'packer', 'pulumi', 'cicd',
        ].map(norm)),
        includes: ['cicd', 'continuousintegration', 'continuousdeployment', 'infrastructure'],
    },
    {
        cat: 'frameworks',
        exact: new Set([
            'react', 'reactjs', 'nextjs', 'next', 'vue', 'vuejs', 'nuxt', 'angular', 'svelte',
            'sveltekit', 'django', 'flask', 'fastapi', 'express', 'expressjs', 'nestjs', 'spring',
            'springboot', 'rails', 'rubyonrails', 'laravel', 'symfony', 'dotnet', 'aspnet',
            'nodejs', 'node', 'deno', 'bun', 'electron', 'flutter', 'reactnative', 'tailwind',
            'tailwindcss', 'bootstrap', 'graphql', 'redux', 'jquery', 'gatsby', 'remix', 'astro',
            'vite', 'webpack', 'pytest', 'jest', 'vitest', 'playwright', 'cypress', 'selenium',
        ].map(norm)),
        includes: [],
    },
];

/** Classify a single skill string into a category. Unknown → 'tools'. */
export function classifySkill(skill: string): SkillCategory {
    const n = norm(skill);
    if (!n) return 'tools';
    for (const rule of CATEGORY_RULES) {
        if (rule.exact.has(n)) return rule.cat;
    }
    for (const rule of CATEGORY_RULES) {
        for (const sub of rule.includes) {
            if (n.includes(sub)) return rule.cat;
        }
    }
    return 'tools';
}

/**
 * Deterministically bucket a flat skill list into CategorizedSkills.
 * No LLM call — pure keyword mapping. Unknown skills land in `tools` so
 * nothing is lost. Used for v1→v2 backfill and offline coercion.
 */
export function categorizeFlatSkills(flat: string[] | undefined | null): CategorizedSkills {
    const out = emptySkills();
    if (!Array.isArray(flat)) return out;
    for (const skill of flat) {
        if (typeof skill !== 'string' || !skill.trim()) continue;
        out[classifySkill(skill)].push(skill.trim());
    }
    for (const cat of SKILL_CATEGORIES) {
        out[cat] = dedupePreserveOrder(out[cat]);
    }
    return out;
}

/** True if the value is a legacy flat skills array (needs categorization). */
export function isLegacyFlatSkills(raw: any): boolean {
    return Array.isArray(raw);
}

// ---------------------------------------------------------------------------
// Map a natural-language question to the skill bucket(s) it targets.
// "what cloud tools do I know?" → ['cloud']; "AI/ML tools" → ['ml'];
// "programming languages" → ['languages']. Returns [] for a generic skills
// question ("what are my skills?"), which callers treat as "all buckets".
// ---------------------------------------------------------------------------
const SKILL_CATEGORY_QUERY_RULES: Array<{ cat: SkillCategory; patterns: RegExp[] }> = [
    { cat: 'languages', patterns: [/\blanguages?\b/, /programming languages?/, /coding languages?/, /\blangs?\b/] },
    { cat: 'ml', patterns: [/\bml\b/, /machine learning/, /\bai\b/, /artificial intelligence/, /deep learning/, /\bnlp\b/, /\bllms?\b/, /data science/] },
    { cat: 'cloud', patterns: [/\bcloud\b/, /\baws\b/, /\bgcp\b/, /\bazure\b/, /cloud platforms?/, /cloud services?/] },
    { cat: 'devops', patterns: [/\bdevops\b/, /\bci\/?cd\b/, /infrastructure/, /\bcontainers?\b/, /orchestration/, /\bk8s\b/, /kubernetes/, /\bdocker\b/, /deployment tools?/, /monitoring tools?/, /observability/] },
    { cat: 'databases', patterns: [/\bdatabases?\b/, /\bdbs?\b/, /\bsql\b/, /data ?stores?/, /\bdata storage\b/] },
    { cat: 'frameworks', patterns: [/\bframeworks?\b/, /\blibraries\b/, /\blibs?\b/, /tech stack/, /\bstack\b/] },
];

export function detectSkillCategories(question: string): SkillCategory[] {
    const q = question.toLowerCase();
    const hit: SkillCategory[] = [];
    for (const rule of SKILL_CATEGORY_QUERY_RULES) {
        if (rule.patterns.some(p => p.test(q))) hit.push(rule.cat);
    }
    return hit;
}
