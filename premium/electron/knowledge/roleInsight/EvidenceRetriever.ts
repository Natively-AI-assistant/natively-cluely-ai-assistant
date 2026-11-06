// premium/electron/knowledge/roleInsight/EvidenceRetriever.ts
//
// Builds the candidate-evidence pool and retrieves candidates per requirement.
//
// The pool is built from the CANONICAL Profile Intelligence data — the same
// structured_data and context_nodes the rest of the app answers from. Role
// Insight does not maintain a second résumé index; every evidence item resolves
// to either a structured field or a context_nodes row, which is what makes
// "Source: Aetherlab experience · Submitted résumé · Bullet 2" truthful rather
// than decorative.
//
// Retrieval is deliberately WIDER than the app's answer path. HybridSearchEngine
// defaults to threshold 0.55 / 8 nodes, tuned for "inject only what is clearly
// relevant into a live answer". Here a near-miss must still surface, because the
// alternative is classifying a requirement as unsupported when the supporting
// bullet simply scored 0.53. Under-retrieval here manufactures false gaps, which
// is the single worst failure this feature can have.

import { DocType, ContextNode, StructuredResume } from '../types';
import { getRelevantNodes } from '../HybridSearchEngine';
import { flattenSkills } from '../skillsUtil';
import { CandidateEvidence, RoleRequirement, EvidenceCategory } from './types';
import { canonicalize, extractCanonicalTerms, normalizeTerm } from './skillOntology';

/** Lower than the answer path's 0.55 — see the note above about false gaps. */
const RETRIEVAL_THRESHOLD = 0.42;
const MAX_NODES_PER_REQUIREMENT = 6;
/** Cap on evidence items handed to the LLM per requirement, after merging. */
const MAX_EVIDENCE_PER_REQUIREMENT = 8;

export interface EvidencePool {
    items: CandidateEvidence[];
    /** canonical term → evidence ids that demonstrate it. Deterministic index. */
    byTerm: Map<string, string[]>;
    byId: Map<string, CandidateEvidence>;
    /** node id → evidence id, so retrieved nodes map back into the pool. */
    byNodeId: Map<number, string>;
    /** Every canonical term the candidate demonstrates anywhere. */
    allTerms: Set<string>;
}

let evidenceCounter = 0;
function evidenceId(analysisId: string): string {
    evidenceCounter += 1;
    return `ev_${analysisId.slice(3, 11)}_${evidenceCounter.toString(36)}`;
}

function push(
    items: CandidateEvidence[],
    analysisId: string,
    claim: string,
    category: EvidenceCategory,
    sourceLocation: string,
    confidence: number,
    nodeId: number | null = null,
    sourceType: CandidateEvidence['sourceType'] = 'submitted_resume',
): void {
    const trimmed = String(claim ?? '').trim();
    if (trimmed.length < 3) return;
    items.push({
        id: evidenceId(analysisId),
        analysisId,
        claim: trimmed,
        category,
        sourceType,
        nodeId,
        sourceLocation,
        userConfirmed: sourceType === 'user_confirmation',
        confidence,
    });
}

/**
 * Build the evidence pool from the structured résumé and the embedded corpus.
 *
 * Structured fields come first and carry higher confidence: they were extracted
 * into a typed slot, so "PostgreSQL is a skill" is a stronger statement than
 * "the token postgresql appears in a chunk".
 */
export function buildEvidencePool(
    analysisId: string,
    resume: StructuredResume | null,
    nodes: ContextNode[],
    userConfirmed: Array<{ claim: string; sourceLocation: string }> = [],
): EvidencePool {
    const items: CandidateEvidence[] = [];

    if (resume) {
        // Skills — typed slots, highest structural confidence.
        const skills = resume.skills_flat ?? flattenSkills(resume.skills);
        for (const skill of skills ?? []) {
            push(items, analysisId, skill, 'skill', 'Skills · Submitted résumé', 0.75);
        }

        // Experience — each bullet is separately citable, which is what lets the
        // UI say "Bullet 2" instead of gesturing at a whole role.
        for (const exp of resume.experience ?? []) {
            const where = `${exp.role} at ${exp.company}`;
            const period = exp.start_date
                ? ` (${exp.start_date} – ${exp.end_date ?? 'Present'})`
                : '';
            push(items, analysisId, `${where}${period}`, 'experience',
                `${exp.company} experience · Submitted résumé`, 0.8);
            (exp.bullets ?? []).forEach((bullet, i) => {
                push(items, analysisId, bullet, 'experience',
                    `${exp.company} experience · Submitted résumé · Bullet ${i + 1}`, 0.85);
            });
        }

        for (const proj of resume.projects ?? []) {
            const loc = `Project: ${proj.name} · Submitted résumé`;
            push(items, analysisId, `${proj.name} — ${proj.description}`, 'project', loc, 0.75);
            for (const tech of proj.technologies ?? []) {
                push(items, analysisId, `${tech} (used in ${proj.name})`, 'skill', loc, 0.7);
            }
            (proj.highlights ?? []).forEach((h, i) => {
                push(items, analysisId, h, 'project', `${loc} · Highlight ${i + 1}`, 0.8);
            });
        }

        for (const edu of resume.education ?? []) {
            push(items, analysisId,
                `${edu.degree}${edu.field ? ` in ${edu.field}` : ''}, ${edu.institution}`,
                'education', 'Education · Submitted résumé', 0.9);
        }

        for (const cert of resume.certifications ?? []) {
            push(items, analysisId, `${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}`,
                'certification', 'Certifications · Submitted résumé', 0.9);
        }

        for (const ach of resume.achievements ?? []) {
            push(items, analysisId, `${ach.title}${ach.description ? ` — ${ach.description}` : ''}`,
                'achievement', 'Achievements · Submitted résumé', 0.7);
        }

        for (const lead of resume.leadership ?? []) {
            push(items, analysisId,
                `${lead.role}${lead.organization ? ` at ${lead.organization}` : ''}${lead.description ? ` — ${lead.description}` : ''}`,
                'experience', 'Leadership · Submitted résumé', 0.8);
        }

        if (resume.identity?.location) {
            push(items, analysisId, `Location on résumé: ${resume.identity.location}`,
                'logistics', 'Identity · Submitted résumé', 0.6);
        }
    }

    // Embedded corpus — the semantic retrieval surface. Résumé-derived nodes are
    // marked profile_intelligence rather than submitted_resume because they may
    // include generated STAR-story nodes, which are derived, not quoted.
    const byNodeId = new Map<number, string>();
    for (const node of nodes) {
        if (node.source_type !== DocType.RESUME) continue;
        if (node.id == null) continue;
        const where = node.organization
            ? `${node.title} at ${node.organization} · Profile Intelligence`
            : `${node.title} · Profile Intelligence`;
        const before = items.length;
        push(items, analysisId, node.text_content, mapNodeCategory(node.category), where, 0.7, node.id, 'profile_intelligence');
        if (items.length > before) byNodeId.set(node.id, items[items.length - 1].id);
    }

    for (const c of userConfirmed) {
        push(items, analysisId, c.claim, 'experience', c.sourceLocation, 0.95, null, 'user_confirmation');
    }

    // ── Indexes ───────────────────────────────────────────────────────────────
    const byId = new Map<string, CandidateEvidence>();
    const byTerm = new Map<string, string[]>();
    const allTerms = new Set<string>();
    for (const item of items) {
        byId.set(item.id, item);
        for (const term of extractCanonicalTerms(item.claim)) {
            allTerms.add(term);
            const list = byTerm.get(term) ?? [];
            list.push(item.id);
            byTerm.set(term, list);
        }
    }

    return { items, byTerm, byId, byNodeId, allTerms };
}

function mapNodeCategory(category: string): EvidenceCategory {
    switch (category) {
        case 'project': return 'project';
        case 'education': return 'education';
        case 'certification': return 'certification';
        case 'achievement': return 'achievement';
        case 'skill': return 'skill';
        default: return 'experience';
    }
}

// ── Per-requirement retrieval ─────────────────────────────────────────────────

export interface RetrievedEvidence {
    requirementId: string;
    /** Evidence whose canonical terms literally match the requirement's. */
    directIds: string[];
    /** Evidence surfaced by semantic retrieval but not a literal term match. */
    semanticIds: string[];
    /** Ordered union, capped, as handed to the assessor. */
    orderedIds: string[];
}

/** The query used for semantic retrieval. Requirement-shaped, not JD-shaped. */
function retrievalQuery(req: RoleRequirement): string {
    const terms = req.canonicalTerms.map(t => t.replace(/_/g, ' ')).join(' ');
    return `${req.normalizedText} ${terms}`.trim();
}

/** Substring-safe literal check: "go" must not match "django". */
function claimMentions(claim: string, canonicalTerm: string): boolean {
    const claimTerms = extractCanonicalTerms(claim);
    if (claimTerms.some(t => t === canonicalTerm)) return true;
    // Multi-word canonical forms ("high_availability") also match their spaced
    // form appearing literally in the claim.
    const spaced = canonicalTerm.replace(/_/g, ' ');
    if (spaced.includes(' ') && normalizeTerm(claim).includes(spaced)) return true;
    return false;
}

export async function retrieveForRequirement(
    req: RoleRequirement,
    pool: EvidencePool,
    nodes: ContextNode[],
    embedFn: ((text: string) => Promise<number[]>) | null,
    // Semantic-admission gate (Phase 1): the corpus's committed embedding-space
    // key, resolved per call by the deps provider. Optional — absent means the
    // gate falls back to legacy threshold admission even when its flag is ON.
    embeddingSpaceKey?: string | null,
): Promise<RetrievedEvidence> {
    // ── Deterministic pass: literal canonical-term hits. ──────────────────────
    const directIds: string[] = [];
    const seen = new Set<string>();
    for (const term of req.canonicalTerms) {
        const canonical = canonicalize(term);
        for (const id of pool.byTerm.get(canonical) ?? []) {
            const item = pool.byId.get(id);
            if (!item || seen.has(id)) continue;
            if (!claimMentions(item.claim, canonical)) continue;
            seen.add(id);
            directIds.push(id);
        }
    }

    // ── Semantic pass over the embedded corpus. ──────────────────────────────
    const semanticIds: string[] = [];
    if (embedFn && nodes.length > 0) {
        try {
            const scored = await getRelevantNodes(retrievalQuery(req), nodes, embedFn, {
                sourceTypes: [DocType.RESUME],
                threshold: RETRIEVAL_THRESHOLD,
                maxNodes: MAX_NODES_PER_REQUIREMENT,
                categoryHintKeywords: categoryHintsFor(req),
                embeddingSpaceKey,
            });
            for (const { node } of scored) {
                if (node.id == null) continue;
                const evId = pool.byNodeId.get(node.id);
                if (!evId || seen.has(evId)) continue;
                seen.add(evId);
                semanticIds.push(evId);
            }
        } catch (e: any) {
            // Retrieval failure must not become a gap. The direct pass still ran,
            // and the assessor will see fewer candidates — which lands the
            // requirement in needs_evidence, the honest outcome.
            console.warn(`[RoleInsight/Retrieval] Semantic pass failed for ${req.id}:`, e?.message);
        }
    }

    // Direct hits first — they are the strongest and the assessor reads in order.
    const orderedIds = [...directIds, ...semanticIds].slice(0, MAX_EVIDENCE_PER_REQUIREMENT);
    return { requirementId: req.id, directIds, semanticIds, orderedIds };
}

function categoryHintsFor(req: RoleRequirement): string[] {
    switch (req.category) {
        case 'education': return ['education'];
        case 'certification': return ['certification'];
        case 'leadership': return ['leadership', 'experience'];
        case 'core_responsibility': return ['experience', 'project'];
        case 'technical_skill': return ['experience', 'project'];
        case 'experience': return ['experience'];
        default: return [];
    }
}

/**
 * Canonical terms the candidate demonstrates that are RELATED to a requirement,
 * for transfer-edge lookup. Drawn from the retrieved evidence only — never from
 * the whole pool, or every requirement would "transfer" from everything the
 * candidate has ever done.
 */
export function evidenceTerms(pool: EvidencePool, evidenceIds: string[]): Set<string> {
    const terms = new Set<string>();
    for (const id of evidenceIds) {
        const item = pool.byId.get(id);
        if (!item) continue;
        for (const t of extractCanonicalTerms(item.claim)) terms.add(t);
    }
    return terms;
}
