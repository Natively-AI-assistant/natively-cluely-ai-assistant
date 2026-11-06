// electron/knowledge/DocumentChunker.ts
// Converts structured data into atomic ContextNodes with optional embeddings

import { DocType, StructuredResume, StructuredJD, ContextNode, SKILL_CATEGORIES } from './types';
import { coerceSkills } from './skillsUtil';

const SKILL_CATEGORY_LABEL: Record<string, string> = {
    languages: 'Programming Languages', frameworks: 'Frameworks & Libraries',
    cloud: 'Cloud & Platforms', databases: 'Databases', ml: 'AI / ML',
    devops: 'DevOps & Infrastructure', tools: 'Tools',
};

/**
 * Calculate duration in months between two YYYY-MM dates.
 */
export function calculateDurationMonths(startDate: string | null, endDate: string | null): number {
    if (!startDate) return 0;
    try {
        const [startYear, startMonth] = startDate.split('-').map(Number);
        let endYear: number, endMonth: number;
        if (endDate) {
            [endYear, endMonth] = endDate.split('-').map(Number);
        } else {
            const now = new Date();
            endYear = now.getFullYear();
            endMonth = now.getMonth() + 1;
        }
        const months = (endYear - startYear) * 12 + (endMonth - startMonth);
        return Math.max(0, months);
    } catch {
        return 0;
    }
}

/**
 * Extract keyword tags from a text string.
 */
export function extractTags(text: string): string[] {
    const words = text.toLowerCase()
        .replace(/[^a-z0-9\s\-\.\/\+\#]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

    const bigrams: string[] = [];
    for (let i = 0; i < words.length - 1; i++) {
        bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
    return [...new Set([...words, ...bigrams])];
}

/**
 * Convert structured data into generic ContextNodes.
 */
export function createDocumentNodes(structuredData: any, type: DocType): Omit<ContextNode, 'embedding'>[] {
    const nodes: Omit<ContextNode, 'embedding'>[] = [];

    if (type === DocType.RESUME) {
        const resume = structuredData as StructuredResume;

        // Experience bullets
        if (resume.experience) {
            for (const exp of resume.experience) {
                const duration = calculateDurationMonths(exp.start_date, exp.end_date);
                const contextPrefix = `[${exp.role} @ ${exp.company}, ${exp.start_date}–${exp.end_date || 'Present'}]`;
                for (const bullet of exp.bullets || []) {
                    nodes.push({
                        source_type: DocType.RESUME,
                        category: 'experience',
                        title: exp.role,
                        organization: exp.company,
                        start_date: exp.start_date,
                        end_date: exp.end_date,
                        duration_months: duration,
                        text_content: `${contextPrefix} ${bullet}`,
                        tags: extractTags(`${exp.role} ${exp.company} ${bullet}`)
                    });
                }
            }
        }

        // Projects
        if (resume.projects) {
            for (const project of resume.projects) {
                const technologies = (project.technologies || []).filter(Boolean);
                const highlights = (project.highlights || []).filter(Boolean);
                const text = [
                    `${project.name}: ${project.description}`,
                    technologies.length ? `Technologies: ${technologies.join(', ')}` : '',
                    highlights.length ? `Highlights:\n${highlights.map(highlight => `- ${highlight}`).join('\n')}` : '',
                ].filter(Boolean).join('\n');
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'project',
                    title: project.name,
                    text_content: text,
                    tags: extractTags(`${project.name} ${project.description} ${technologies.join(' ')} ${highlights.join(' ')}`)
                });
            }
        }

        // Education
        if (resume.education) {
            for (const edu of resume.education) {
                const duration = calculateDurationMonths(edu.start_date, edu.end_date);
                const text = `${edu.degree} in ${edu.field} from ${edu.institution}${edu.gpa ? ` (GPA: ${edu.gpa})` : ''}`;
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'education',
                    title: `${edu.degree} in ${edu.field}`,
                    organization: edu.institution,
                    start_date: edu.start_date,
                    end_date: edu.end_date,
                    duration_months: duration,
                    text_content: text,
                    tags: extractTags(`${edu.degree} ${edu.field} ${edu.institution}`)
                });
            }
        }

        // Achievements and others...
        if (resume.achievements) {
            for (const achievement of resume.achievements) {
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'achievement',
                    title: achievement.title,
                    start_date: achievement.date || null,
                    text_content: `${achievement.title}: ${achievement.description}`,
                    tags: extractTags(`${achievement.title} ${achievement.description}`)
                });
            }
        }

        // RC-3: one node PER skill category, so a "cloud tools" query embeds near
        // the cloud node — not the whole skill list. Previously skills produced
        // zero nodes, so vector retrieval could never surface them by category.
        const skills = coerceSkills(resume.skills);
        for (const cat of SKILL_CATEGORIES) {
            const items = (skills as any)[cat] as string[];
            if (!items || items.length === 0) continue;
            const label = SKILL_CATEGORY_LABEL[cat] || cat;
            nodes.push({
                source_type: DocType.RESUME,
                category: `skills_${cat}`,
                title: label,
                text_content: `${label}: ${items.join(', ')}`,
                tags: items.map(s => s.toLowerCase())
            });
        }
    }
    else if (type === DocType.JD) {
        const jd = structuredData as StructuredJD;
        const levelTag = jd.level ? `level:${jd.level}` : '';

        // Requirements
        if (jd.requirements) {
            for (const req of jd.requirements) {
                nodes.push({
                    source_type: DocType.JD,
                    category: 'requirement',
                    title: 'Required Skill',
                    organization: jd.company,
                    text_content: req,
                    tags: [...extractTags(req), ...(levelTag ? [levelTag] : [])]
                });
            }
        }

        // Nice to haves
        if (jd.nice_to_haves) {
            for (const nice of jd.nice_to_haves) {
                nodes.push({
                    source_type: DocType.JD,
                    category: 'nice_to_have',
                    title: 'Nice to Have',
                    organization: jd.company,
                    text_content: nice,
                    tags: extractTags(nice)
                });
            }
        }

        // Responsibilities
        if (jd.responsibilities) {
            for (const resp of jd.responsibilities) {
                nodes.push({
                    source_type: DocType.JD,
                    category: 'responsibility',
                    title: 'Job Responsibility',
                    organization: jd.company,
                    text_content: resp,
                    tags: extractTags(resp)
                });
            }
        }

        // Keywords (new)
        if (jd.keywords) {
            for (const keyword of jd.keywords) {
                nodes.push({
                    source_type: DocType.JD,
                    category: 'keyword',
                    title: 'Job Keyword',
                    organization: jd.company,
                    text_content: keyword,
                    tags: [keyword.toLowerCase(), ...(levelTag ? [levelTag] : [])]
                });
            }
        }
    }

    console.log(`[DocumentChunker] Created ${nodes.length} atomic nodes for ${type}`);
    return nodes;
}


/**
 * Embed a batch of node texts with ONE request when a batch embedder is wired.
 *
 * WHY (measured live 2026-09-19, a 15k-token résumé on the natively stack): the
 * ingest embedded its nodes as bursts of 10 CONCURRENT single-text requests. The
 * embed route answered 429 Too Many Requests, every failed call fell back to the
 * bundled model without a word, and all 238 knowledge nodes ended in the local
 * MiniLM space while natively embeddings were selected and working — which the
 * space gate then treats as a stale corpus. One request per batch is what the
 * provider's batch endpoint exists for. (History; the contract is on
 * embedTextsBatched below.)
 */

/** Pause before the single batch retry; long enough to clear a burst 429, short next to an ingest. */
const BATCH_EMBED_RETRY_DELAY_MS = 1500;

function validVectors(vectors: unknown, expected: number): Array<number[] | undefined> | null {
    if (!Array.isArray(vectors) || vectors.length !== expected) return null;
    let dim = 0;
    return vectors.map((v) => {
        if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return undefined;
        if (dim === 0) dim = v.length;
        return v.length === dim ? (v as number[]) : undefined;
    });
}

/**
 * Embed a batch in ONE request.
 *
 * Returns `null` ONLY when no batch embedder is wired (an older main process) —
 * the caller then uses its per-text path, as it always did.
 *
 * When a batch embedder IS wired and it fails, this must NOT hand the batch to
 * the per-text path (review finding, 2026-09-20, reproduced against the real
 * pipeline): the batch embedder deliberately refuses to promote the fallback
 * model on a single failure and throws; the per-text embedder has no such
 * hysteresis and promotes the bundled model on its FIRST failure. One transient
 * 429 therefore produced a document with 10 vectors in the hosted space and 21
 * in the local one, and demoted the whole session — the exact defect batching
 * was introduced to remove. So: retry the BATCH once, and if it still fails,
 * store these nodes WITHOUT embeddings (they stay lexically searchable, and the
 * index repair re-embeds them) rather than in the wrong space.
 */
export async function embedTextsBatched(
    texts: string[],
    embedBatchFn?: (texts: string[]) => Promise<number[][]>,
): Promise<Array<number[] | undefined> | null> {
    if (!embedBatchFn || texts.length === 0) return null;
    let reason = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const checked = validVectors(await embedBatchFn(texts), texts.length);
            if (checked) return checked;
            reason = 'the embedder returned a result of the wrong shape';
        } catch (err: any) {
            reason = String(err?.message ?? err);
        }
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, BATCH_EMBED_RETRY_DELAY_MS));
    }
    console.warn(`[DocumentChunker] batch embed of ${texts.length} failed twice (${reason}); storing these nodes without embeddings rather than in another embedding space`);
    // Annotated because TS 7 under the premium coverage gate infers `any` for a
    // bare `() => undefined` and fails TS7011. The element type is the one this
    // function already declares: number[] | undefined.
    return texts.map((): number[] | undefined => undefined);
}

/**
 * Generate embeddings for all nodes.
 */
export async function chunkAndEmbedDocument(
    structuredData: any,
    type: DocType,
    embedFn: (text: string) => Promise<number[]>,
    embedBatchFn?: (texts: string[]) => Promise<number[][]>,
): Promise<ContextNode[]> {
    const rawNodes = createDocumentNodes(structuredData, type);
    const nodesWithEmbeddings: ContextNode[] = [];

    console.log(`[DocumentChunker] Generating embeddings for ${rawNodes.length} nodes (batched)...`);

    const EMBED_BATCH_SIZE = 10;
    for (let i = 0; i < rawNodes.length; i += EMBED_BATCH_SIZE) {
        const batch = rawNodes.slice(i, i + EMBED_BATCH_SIZE);

        const batched = await embedTextsBatched(batch.map((node) => node.text_content), embedBatchFn);
        if (batched) {
            batch.forEach((node, j) => nodesWithEmbeddings.push({ ...node, embedding: batched[j] }));
            continue;
        }

        const results = await Promise.allSettled(
            batch.map(node => embedFn(node.text_content))
        );

        // Collect failed indices for retry
        const failedIndices: number[] = [];
        for (let j = 0; j < batch.length; j++) {
            const result = results[j];
            if (result.status === 'fulfilled') {
                nodesWithEmbeddings.push({ ...batch[j], embedding: result.value });
            } else {
                failedIndices.push(j);
            }
        }

        // Retry failed embeddings once after a short delay
        if (failedIndices.length > 0) {
            console.warn(`[DocumentChunker] ${failedIndices.length} embedding(s) failed in batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 500));

            const retryResults = await Promise.allSettled(
                failedIndices.map(j => embedFn(batch[j].text_content))
            );

            for (let k = 0; k < failedIndices.length; k++) {
                const j = failedIndices[k];
                const retryResult = retryResults[k];
                nodesWithEmbeddings.push({
                    ...batch[j],
                    embedding: retryResult.status === 'fulfilled' ? retryResult.value : undefined
                });
                if (retryResult.status === 'rejected') {
                    console.warn(`[DocumentChunker] Retry also failed for node ${i + j}: ${(retryResult.reason as Error)?.message}. Storing without embedding.`);
                }
            }
        }

        console.log(`[DocumentChunker] Embedded batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}/${Math.ceil(rawNodes.length / EMBED_BATCH_SIZE)} (${Math.min(i + EMBED_BATCH_SIZE, rawNodes.length)}/${rawNodes.length})`);

        // Small delay between batches to avoid rate limiting
        if (i + EMBED_BATCH_SIZE < rawNodes.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return nodesWithEmbeddings;
}
