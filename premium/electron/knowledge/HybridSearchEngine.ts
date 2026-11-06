import { ContextNode, ScoredNode, DocType, CompanyDossier } from './types';
import { isSemanticAdmissionGateEnabled, resolveSemanticFloor } from '../../../electron/llm/semanticAdmissionGate';

const RELEVANCE_THRESHOLD = 0.55;
const MAX_NODES = 8; // Support list-type queries that need multiple results

/**
 * Check if a node's end_date is recent (within 2 years of now).
 */
function isRecent(endDate: string | null): boolean {
    if (!endDate) return true; // Ongoing = recent
    try {
        const [year, month] = endDate.split('-').map(Number);
        const endMs = new Date(year, month - 1).getTime();
        const twoYearsAgo = Date.now() - (2 * 365.25 * 24 * 60 * 60 * 1000);
        return endMs >= twoYearsAgo;
    } catch {
        return false;
    }
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Extract keywords from a question for tag matching.
 */
function extractKeywords(question: string): string[] {
    return question.toLowerCase()
        .replace(/[^a-z0-9\s\-\.\/\+\#]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
}

/**
 * Map of query keywords to the resume node categories they should boost.
 */
const CATEGORY_KEYWORD_MAP: Record<string, string[]> = {
    'project': ['project'],
    'projects': ['project'],
    'built': ['project'],
    'build': ['project'],
    'education': ['education'],
    'degree': ['education'],
    'university': ['education'],
    'college': ['education'],
    'school': ['education'],
    'certification': ['certification'],
    'certifications': ['certification'],
    'certified': ['certification'],
    'achievement': ['achievement'],
    'achievements': ['achievement'],
    'award': ['achievement'],
    'awards': ['achievement'],
    'leadership': ['leadership'],
    'led': ['leadership', 'experience'],
    'managed': ['leadership', 'experience'],
    'skill': ['experience', 'project'],
    'skills': ['experience', 'project'],
    'experience': ['experience'],
    // Grounding-campaign2 fix (2026-07-17): "expertise" was missing from this
    // map entirely, so a question phrased with it ("deep Go or Java expertise
    // — how do you stack up there?") got ZERO category hints and
    // buildStructuredCategoryPack returned an empty node list — live-confirmed
    // on the real backend (test/harness-longsession script-a press A9):
    // candidateProfileChars:0 reached the prompt despite the question being a
    // clear experience-level lookup. "Expertise" and "experience" are
    // synonyms for this classifier's purpose; both map to the same category.
    'expertise': ['experience'],
    'worked': ['experience'],
    'role': ['experience'],
    'roles': ['experience'],
    'job': ['experience'],
    'jobs': ['experience'],
    'company': ['experience'],
    'companies': ['experience'],
};

/**
 * Detect which resume categories the question is asking about.
 */
export function detectCategoryHints(question: string): string[] {
    const qLower = question.toLowerCase();
    const boostedCategories = new Set<string>();
    for (const [keyword, categories] of Object.entries(CATEGORY_KEYWORD_MAP)) {
        if (qLower.includes(keyword)) {
            categories.forEach(c => boostedCategories.add(c));
        }
    }
    return Array.from(boostedCategories);
}

function scoreNode(
    node: ContextNode,
    cosine: number,
    keywords: string[],
    rawQuestion: string,
    jdRequiredSkills?: string[],
    categoryHintKeywords?: string[]
): number {
    let score = 0;

    // 60% — Semantic similarity (cosine precomputed ONCE by the caller so the
    // semantic-admission gate and this ranking score share the same value —
    // Phase 1 of the semantic-retrieval repair, 2026-08-13).
    score += cosine * 0.6;

    // 20% — Tag/keyword match
    if (keywords.some(k => node.tags.some(t => t.includes(k)))) {
        score += 0.2;
    }

    // 10% — Duration boost (if experience > 12 months)
    if (node.duration_months && node.duration_months > 12) {
        score += 0.1;
    }

    // 10% — Recency boost
    if (isRecent(node.end_date || null)) {
        score += 0.1;
    }

    // JD required skill boost: if this resume node matches a JD required skill, boost it
    if (jdRequiredSkills && jdRequiredSkills.length > 0 && node.source_type === DocType.RESUME) {
        const nodeText = node.text_content.toLowerCase();
        const nodeTags = node.tags.map(t => t.toLowerCase());
        for (const skill of jdRequiredSkills) {
            const skillLower = skill.toLowerCase();
            if (nodeText.includes(skillLower) || nodeTags.some(t => t.includes(skillLower))) {
                score += 0.15;
                break; // Only boost once per node
            }
        }
    }

    // Category boost: if the question targets a specific category (e.g. "projects"),
    // boost nodes of that category significantly
    if (categoryHintKeywords && categoryHintKeywords.length > 0 && node.source_type === DocType.RESUME) {
        if (categoryHintKeywords.includes(node.category)) {
            score += 0.25; // Strong boost for matching category
        }
    }

    // Title/name deep-dive boost: if the question mentions a specific project, role,
    // or organization name, strongly boost the matching node
    if (node.title && node.source_type === DocType.RESUME) {
        const questionLower = rawQuestion.toLowerCase();
        const titleLower = node.title.toLowerCase();
        const orgLower = (node.organization || '').toLowerCase();
        // Check if any meaningful part of the node title appears in the question
        // Split title into words and check for multi-word matches (>3 chars each)
        const titleWords = titleLower.split(/[\s,\-:@]+/).filter(w => w.length > 3);
        const matchingWords = titleWords.filter(w => questionLower.includes(w));
        if (matchingWords.length >= 2 || (titleWords.length === 1 && matchingWords.length === 1)) {
            score += 0.35; // Very strong boost for direct title mention
        }
        // Also check organization name
        if (orgLower.length > 3 && questionLower.includes(orgLower)) {
            score += 0.2;
        }
    }

    return score;
}

/**
 * Options for retrieval
 */
export interface SearchOptions {
    sourceTypes?: DocType[]; // Only retrieve nodes from these sources
    maxNodes?: number;
    threshold?: number;
    jdRequiredSkills?: string[]; // JD skills for boosting resume node relevance
    categoryHintKeywords?: string[]; // Resume categories to boost (e.g. ['project'] for project-related questions)
    /**
     * Composite embedding-space key of the corpus (`provider:model:dims`,
     * see electron/rag/embeddingSpace.ts). Consumed ONLY by the
     * semantic-admission gate (flag `semanticAdmissionGate`, default OFF) to
     * resolve the cosine admission floor for this space. When absent — or when
     * the space has no calibrated floor — admission falls back to the legacy
     * blended-score threshold even with the flag ON.
     */
    embeddingSpaceKey?: string | null;
}

/**
 * Get the most relevant nodes for a given question.
 */
export async function getRelevantNodes(
    question: string,
    allNodes: ContextNode[],
    embedFn: (text: string) => Promise<number[]>,
    options: SearchOptions = {}
): Promise<ScoredNode[]> {
    const threshold = options.threshold || RELEVANCE_THRESHOLD;
    const maxNodes = options.maxNodes || MAX_NODES;

    let targetNodes = allNodes;
    if (options.sourceTypes && options.sourceTypes.length > 0) {
        targetNodes = allNodes.filter(n => options.sourceTypes!.includes(n.source_type));
    }

    if (targetNodes.length === 0) {
        return [];
    }

    // Generate embedding for the question
    let questionEmbedding: number[] = [];
    try {
        questionEmbedding = await embedFn(question);
    } catch (error: any) {
        console.warn('[HybridSearchEngine] Failed to embed question, falling back to keyword-only:', error.message);
    }

    const keywords = extractKeywords(question);

    // ── Admission ≠ ranking (Phase 1, semantic-retrieval repair 2026-08-13) ──
    // Legacy admission is `blendedScore > threshold`, where the blend mixes
    // 0.6·cosine with up to 1.35 of metadata boosts — so boosts can ADMIT a
    // node with cosine 0, while a node at cosine 0.90 with no boosts is
    // rejected (verified: ScoreNodeAdmissionArithmetic2026_08_13.test.mjs).
    // Under the gate, a calibrated per-space cosine floor decides admission
    // and the blended score only ORDERS the admitted candidates.
    //
    // The gate enforces ONLY when all three hold; otherwise legacy admission
    // runs unchanged (flag OFF must be byte-for-byte legacy):
    //   1. flag `semanticAdmissionGate` is ON,
    //   2. the question actually embedded (a failed embed → keyword-only
    //      degraded mode, where a cosine floor would reject EVERYTHING),
    //   3. the caller threaded an embeddingSpaceKey with a calibrated floor
    //      (unknown space → null → an uncalibrated floor is never enforced).
    // Note: under the gate a node with NO embedding (cosine 0, e.g. mid
    // re-index) is not admissible — that is the intended semantics (boosts
    // don't admit), and the space-gating in _spaceGatedNodes already excludes
    // stale-space nodes on the answer path.
    const semanticFloor = (isSemanticAdmissionGateEnabled() && questionEmbedding.length > 0)
        ? resolveSemanticFloor(options.embeddingSpaceKey)
        : null;

    // Cosine is computed ONCE per node and shared by admission and ranking.
    const candidates = targetNodes.map(node => {
        const cosine = (node.embedding && questionEmbedding.length > 0)
            ? cosineSimilarity(node.embedding, questionEmbedding)
            : 0;
        return {
            node,
            cosine,
            score: scoreNode(node, cosine, keywords, question, options.jdRequiredSkills, options.categoryHintKeywords),
        };
    });

    const admitsCandidate = (c: { cosine: number; score: number }): boolean =>
        semanticFloor != null ? c.cosine >= semanticFloor : c.score > threshold;

    const scored: ScoredNode[] = candidates
        .filter(admitsCandidate)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxNodes)
        .map(({ node, score }) => ({ node, score }));

    // ── Observe-only telemetry (Phase 3, semantic-retrieval repair) ─────────
    // One compact line per retrieval so the per-space cosine/boost
    // distributions can be calibrated from real traffic BEFORE any floor is
    // enforced (the local-384 floor is deliberately absent until this data
    // exists). `admitted` reflects the admission PREDICATE — the maxNodes cap
    // is a separate concern. Capped at 50 candidates per line; never throws.
    try {
        console.log('[SemanticAdmission] ' + JSON.stringify({
            spaceKey: options.embeddingSpaceKey ?? null,
            floor: semanticFloor,
            enforced: semanticFloor != null,
            questionEmbedded: questionEmbedding.length > 0,
            legacyThreshold: threshold,
            candidateCount: candidates.length,
            candidates: candidates.slice(0, 50).map(c => ({
                cosine: Number(c.cosine.toFixed(4)),
                boostSum: Number((c.score - c.cosine * 0.6).toFixed(4)),
                admitted: admitsCandidate(c),
            })),
        }));
    } catch { /* telemetry must never break retrieval */ }

    if (scored.length > 0) {
        console.log(`[HybridSearchEngine] Found ${scored.length} relevant nodes (top score: ${scored[0].score.toFixed(3)})${semanticFloor != null ? ` [semantic-admission floor ${semanticFloor} @ ${options.embeddingSpaceKey}]` : ''}`);
    } else if (semanticFloor != null) {
        console.log(`[HybridSearchEngine] No nodes at or above the semantic-admission floor (${semanticFloor} @ ${options.embeddingSpaceKey}) — no injection`);
    } else {
        console.log(`[HybridSearchEngine] No nodes above relevance threshold (${threshold}) — no injection`);
    }

    return scored;
}

/**
 * Format relevant nodes into explicit context blocks, grouping resume nodes by category
 * so the LLM can distinguish between work experience, projects, education, and achievements.
 */
export function formatContextBlock(scoredNodes: ScoredNode[]): string {
    if (scoredNodes.length === 0) return '';

    const jdNodes = scoredNodes.filter(sn => sn.node.source_type === DocType.JD);

    // Group resume nodes by category
    const categoryGroups: Record<string, ScoredNode[]> = {};
    for (const sn of scoredNodes) {
        if (sn.node.source_type !== DocType.RESUME) continue;
        const cat = sn.node.category;
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(sn);
    }

    // Map categories to their XML tags and prefixes
    const categoryConfig: Record<string, { tag: string; prefix: (sn: ScoredNode) => string }> = {
        'experience': {
            tag: 'candidate_experience',
            prefix: (sn) => `[${sn.node.title} at ${sn.node.organization}]`
        },
        'star_story': {
            tag: 'candidate_experience',
            prefix: (sn) => `[STAR Story: ${sn.node.title}]`
        },
        'project': {
            tag: 'candidate_projects',
            prefix: (sn) => `[Project: ${sn.node.title}]`
        },
        'education': {
            tag: 'candidate_education',
            prefix: (sn) => `[Education: ${sn.node.title}]`
        },
        'achievement': {
            tag: 'candidate_achievements',
            prefix: (sn) => `[Achievement: ${sn.node.title}]`
        },
        'certification': {
            tag: 'candidate_certifications',
            prefix: (sn) => `[Certification: ${sn.node.title}]`
        },
        'leadership': {
            tag: 'candidate_leadership',
            prefix: (sn) => `[Leadership: ${sn.node.title}]`
        },
    };

    let blocks: string[] = [];

    // Merge categories that share the same XML tag
    const tagGroups: Record<string, { nodes: ScoredNode[]; getPrefix: (sn: ScoredNode) => string }[]> = {};
    for (const [cat, nodes] of Object.entries(categoryGroups)) {
        const config = categoryConfig[cat] || {
            tag: `candidate_${cat}`,
            prefix: (sn: ScoredNode) => `[${sn.node.category}: ${sn.node.title}]`
        };
        if (!tagGroups[config.tag]) tagGroups[config.tag] = [];
        tagGroups[config.tag].push({ nodes, getPrefix: config.prefix });
    }

    for (const [tag, groups] of Object.entries(tagGroups)) {
        const allNodes = groups.flatMap(g => g.nodes);
        const lines = allNodes.map((sn, i) => {
            const group = groups.find(g => g.nodes.includes(sn))!;
            return `${i + 1}. ${group.getPrefix(sn)} ${sn.node.text_content}`;
        });
        blocks.push(`<${tag}>\n${lines.join('\n')}\n</${tag}>`);
    }

    if (jdNodes.length > 0) {
        const jdLines = jdNodes.map((sn, i) => {
            return `${i + 1}. [${sn.node.category}] ${sn.node.text_content}`;
        });
        blocks.push(`<target_job_context>\n${jdLines.join('\n')}\n</target_job_context>`);
    }

    return blocks.join('\n\n');
}

/**
 * Format a company dossier into a context block for injection into LLM prompts.
 * All fields are included so the LLM can answer questions about culture, reviews,
 * complaints, benefits, salary, and interview prep.
 */
export function formatDossierBlock(dossier: CompanyDossier | null): string {
    if (!dossier) return '';

    const lines: string[] = [];
    lines.push(`Company: ${dossier.company}`);

    if (dossier.hiring_strategy) {
        lines.push(`Hiring Strategy: ${dossier.hiring_strategy}`);
    }
    if (dossier.interview_focus) {
        const diffTag = dossier.interview_difficulty ? ` [Difficulty: ${dossier.interview_difficulty.replace('_', ' ')}]` : '';
        lines.push(`Interview Focus${diffTag}: ${dossier.interview_focus}`);
    }
    if (dossier.salary_estimates && dossier.salary_estimates.length > 0) {
        const salaryLines = dossier.salary_estimates.map(s =>
            `  - ${s.title} in ${s.location}: ${s.currency} ${s.min.toLocaleString()}-${s.max.toLocaleString()} (confidence: ${s.confidence}, source: ${s.source || 'general knowledge'})`
        );
        lines.push(`Salary Estimates:\n${salaryLines.join('\n')}`);
    }
    if (dossier.culture_ratings) {
        const cr = dossier.culture_ratings;
        const sourcesTag = cr.data_sources?.length > 0 ? ` (${cr.data_sources.join(', ')})` : '';
        const reviewCountTag = cr.review_count ? `, ${cr.review_count}` : '';
        lines.push(`Work Culture — Overall: ${cr.overall.toFixed(1)}/5${sourcesTag}${reviewCountTag}`);
        const subs: string[] = [];
        if (cr.work_life_balance > 0) subs.push(`Work-Life Balance: ${cr.work_life_balance.toFixed(1)}`);
        if (cr.career_growth > 0) subs.push(`Career Growth: ${cr.career_growth.toFixed(1)}`);
        if (cr.compensation > 0) subs.push(`Compensation: ${cr.compensation.toFixed(1)}`);
        if (cr.management > 0) subs.push(`Management: ${cr.management.toFixed(1)}`);
        if (cr.diversity > 0) subs.push(`Diversity & Inclusion: ${cr.diversity.toFixed(1)}`);
        if (subs.length > 0) lines.push(`  ${subs.join(' | ')}`);
    }
    if (dossier.employee_reviews && dossier.employee_reviews.length > 0) {
        const reviewLines = dossier.employee_reviews.map(r => {
            const role = r.role ? ` (${r.role})` : '';
            return `  - [${r.sentiment.toUpperCase()}${role} via ${r.source}] "${r.quote}"`;
        });
        lines.push(`Employee Reviews:\n${reviewLines.join('\n')}`);
    }
    if (dossier.critics && dossier.critics.length > 0) {
        const criticLines = dossier.critics.map(c =>
            `  - [${c.frequency.toUpperCase()}] ${c.category}: ${c.complaint}`
        );
        lines.push(`Common Employee Complaints:\n${criticLines.join('\n')}`);
    }
    if (dossier.benefits && dossier.benefits.length > 0) {
        lines.push(`Benefits & Perks: ${dossier.benefits.join(', ')}`);
    }
    if (dossier.core_values && dossier.core_values.length > 0) {
        lines.push(`Core Values: ${dossier.core_values.join(', ')}`);
    }
    if (dossier.competitors && dossier.competitors.length > 0) {
        lines.push(`Competitors: ${dossier.competitors.join(', ')}`);
    }
    if (dossier.recent_news) {
        lines.push(`Recent News: ${dossier.recent_news}`);
    }
    if (dossier.sources && dossier.sources.length > 0) {
        lines.push(`Sources: ${dossier.sources.filter(Boolean).join(', ')}`);
    }

    return `<company_research>\n${lines.join('\n')}\n</company_research>`;
}

